// NOTE: page.$eval is Puppeteer DOM querying (querySelector + callback in the page), not JS eval().
import { mkdirSync } from 'node:fs'
import puppeteer, { type Page } from 'puppeteer-core'

/**
 * The product-polish round, photographed and checked at every width the
 * owner asked for: settings in sections, the share card, notifications
 * with their timing, message previews in device frames, the header search
 * (and its phone-menu twin), the four-step campaign wizard, the template
 * page and the new-template flow, the registrations tab. Every screen:
 * no sideways scroll, no text spilling out of its box, the key element
 * present.
 *
 *   SESSION=<token> PROJECT=<public campaign id> TEMPLATE=<template id> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/product-polish-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const PROJECT = process.env.PROJECT ?? ''
const TEMPLATE = process.env.TEMPLATE ?? ''
const OUT = process.env.OUT ?? '.design/qa/polish'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTHS = (process.env.WIDTHS ?? '375,390,430,768,1024,1440').split(',').map(Number)
if (!SESSION || !PROJECT || !TEMPLATE) throw new Error('SESSION, PROJECT and TEMPLATE are required')
mkdirSync(OUT, { recursive: true })

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
/** Any element whose text overflows its own box horizontally (a heading spilling out). */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const bad: string[] = []
    for (const el of Array.from(document.querySelectorAll('h1,h2,h3,p,button,a,span,td,th,label'))) {
      const s = getComputedStyle(el)
      if (s.overflow !== 'visible' || s.whiteSpace === 'nowrap' && s.textOverflow === 'ellipsis') continue
      if ((el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 2 && (el as HTMLElement).clientWidth > 0 && el.textContent && el.textContent.trim().length > 12) bad.push(el.tagName + ':' + el.textContent.trim().slice(0, 30))
    }
    return bad.slice(0, 5)
  })
const has = (page: Page, text: string) => page.evaluate((t) => document.body.textContent?.includes(t) ?? false, text)
const clickText = async (page: Page, scope: string, text: string) => {
  for (const b of await page.$$(`${scope} button, ${scope} a`)) {
    const t = await b.evaluate((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    if (t === text || t?.startsWith(text)) {
      await b.click()
      return true
    }
  }
  return false
}
/** Types into the first matching element that is actually visible (the header box hides on phones; the drawer box on desktops). */
async function typeVisible(page: Page, selector: string, text: string) {
  for (const el of await page.$$(selector)) {
    const box = await el.boundingBox()
    if (box && box.width > 0 && box.height > 0) {
      await el.click()
      await el.type(text)
      return
    }
  }
  throw new Error(`no visible ${selector}`)
}
async function shot(page: Page, name: string, width: number) {
  await page.screenshot({ path: `${OUT}/${name}-${width}.png` })
  check(`${name} ${width}: no sideways scroll`, await noScroll(page))
  const spill = await overflowing(page)
  check(`${name} ${width}: no text spilling out of its box`, spill.length === 0, spill.join(' | '))
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      const go = (path: string) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 90000 })

      // Home after login is the home page
      await go('/')
      check(`home ${width}: lands on /`, new URL(page.url()).pathname === '/')
      await shot(page, 'home', width)

      // Global search: header (desktop) or drawer (phone)
      if (width >= 1024) {
        await typeVisible(page, 'input[role="combobox"]', 'תיירות')
        await page.waitForSelector('[role="listbox"]', { timeout: 15000 })
        check(`search ${width}: results grouped`, await has(page, 'קמפיינים'))
        await shot(page, 'search', width)
        await page.keyboard.press('Escape')
      } else {
        await page.click('button[aria-label="פתיחת התפריט"]')
        await page.waitForSelector('input[role="combobox"]', { timeout: 10000 })
        await typeVisible(page, 'input[role="combobox"]', 'תיירות')
        await page.waitForSelector('[role="listbox"]', { timeout: 15000 })
        check(`search ${width}: drawer search shows results`, await has(page, 'קמפיינים'))
        await shot(page, 'search-drawer', width)
        await page.keyboard.press('Escape')
      }

      // Settings sections
      for (const section of ['general', 'page', 'messages', 'notifications', 'advanced']) {
        await go(`/projects/${PROJECT}?tab=settings&section=${section}`)
        await page.waitForSelector('nav[aria-label="חלקי ההגדרות"]', { timeout: 30000 })
        if (section === 'notifications') check(`notifications ${width}: says when the daily summary goes out`, await has(page, 'הסיכום היומי יוצא') && await has(page, 'שעון ישראל'))
        if (section === 'page') {
          await page.waitForFunction(() => document.body.textContent?.includes('כך זה ייראה'), { timeout: 30000 }).catch(() => null)
          check(`share ${width}: card preview present`, await has(page, 'תצוגה מקדימה לשיתוף'))
        }
        if (section === 'messages') {
          await page.waitForFunction(() => document.body.textContent?.includes('ברירת מחדל'), { timeout: 30000 })
          await clickText(page, 'main', 'הזמנה לחתימה')
          await page.waitForSelector('iframe[title="תצוגה מקדימה"]', { timeout: 30000 })
          const h = await page.$eval('iframe[title="תצוגה מקדימה"]', (el) => (el as HTMLIFrameElement).getBoundingClientRect().height)
          check(`messages ${width}: preview frame sized to the mail`, h > 300, `h=${Math.round(h)}`)
        }
        await shot(page, `settings-${section}`, width)
      }

      // Registrations: all at once, business language
      await go(`/projects/${PROJECT}?tab=registrations`)
      check(`registrations ${width}: no lead accordions`, !(await has(page, 'לידים חדשים')) && !(await has(page, 'לידים שטופלו')))
      await shot(page, 'registrations', width)

      // Campaign wizard, four steps
      await go('/projects')
      await clickText(page, 'main', '+ קמפיין חדש')
      await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
      check(`wizard ${width}: first question is who`, await has(page, 'למי הקמפיין?'))
      await shot(page, 'wizard-1', width)
      const cards = await page.$$('[role="dialog"] button[aria-pressed]')
      await cards[0].click()
      await clickText(page, '[role="dialog"]', 'המשך')
      check(`wizard ${width}: second question is where from`, await has(page, 'XTRA Sign') && await has(page, 'שני המקורות'))
      await shot(page, 'wizard-2', width)
      for (const b of await page.$$('[role="dialog"] button[aria-pressed]')) {
        if ((await b.evaluate((el) => el.textContent ?? '')).includes('XTRA Sign')) {
          // A DOM click: on a phone the card centre can sit under the dialog's own footer.
          await b.evaluate((el) => (el as HTMLButtonElement).click())
          break
        }
      }
      await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] button[aria-pressed="true"]')).some((b) => b.textContent?.includes('XTRA Sign')), { timeout: 5000 })
      await clickText(page, '[role="dialog"]', 'המשך')
      check(`wizard ${width}: third question is what`, await has(page, 'קמפיין ציבורי') && await has(page, 'קמפיין חתימות'))
      await shot(page, 'wizard-3', width)
      await page.keyboard.press('Escape')

      // Templates: list → page → new
      await go('/templates')
      check(`templates ${width}: new-from-PDF entry`, await has(page, 'תבנית חדשה מ-PDF'))
      await shot(page, 'templates', width)
      await go(`/templates/${TEMPLATE}`)
      await page.waitForSelector('canvas', { timeout: 60000 }).catch(() => null)
      check(`template ${width}: page renders with actions`, await has(page, 'עריכת שדות') && await has(page, 'החלפת PDF'))
      await shot(page, 'template', width)
      await go('/templates/new')
      check(`template-new ${width}: four steps named`, await has(page, 'העלאת PDF') && await has(page, 'זיהוי שדות ומיפוי') && await has(page, 'אישור והפעלה'))
      await shot(page, 'template-new', width)

      // Email previews in device frames
      await go('/settings/emails')
      await page.waitForSelector('iframe[title="תצוגה מקדימה של המייל"]', { timeout: 30000 })
      await shot(page, 'emails', width)

      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'POLISH SHOTS OK' : `${failures} checks failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
