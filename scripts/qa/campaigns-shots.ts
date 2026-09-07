// NOTE: page.$$eval is Puppeteer DOM querying (querySelectorAll + callback in the page), not JS eval().
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import puppeteer, { type Page } from 'puppeteer-core'

/**
 * The campaigns screen and the four-step "קמפיין חדש" wizard — goal (with
 * the comparison open), audience (with the "both" note), entry, details —
 * for both goals, at a phone width and on a desktop. Every shot: no
 * sideways scroll, no text spilling out of its box.
 *
 * Creates nothing unless CREATE=1, which creates one signing campaign named
 * "בדיקה — אשף" and prints its id.
 *
 *   npx tsx scripts/qa/campaigns-shots.ts
 *   SESSION=<token> CREATE=1 npx tsx scripts/qa/campaigns-shots.ts
 *
 * Without SESSION a dev session is minted with scripts/dev-session.ts.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
// A fixed command, nothing interpolated: minting a dev session is safe to shell out for.
const SESSION = process.env.SESSION || execSync('npx dotenv -e .env.local -- npx tsx scripts/dev-session.ts', { encoding: 'utf8' }).trim().split('\n').pop()!
const CREATE = process.env.CREATE === '1'
const OUT = process.env.OUT ?? '.design/qa/campaigns'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTHS = (process.env.WIDTHS ?? '390,1440').split(',').map(Number)
const DIALOG = '[role="dialog"]'
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
      if (el.querySelector('[role="menu"], [role="dialog"]')) continue
      if ((el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 2 && (el as HTMLElement).clientWidth > 0 && el.textContent && el.textContent.trim().length > 12) bad.push(el.tagName + ':' + el.textContent.trim().slice(0, 30))
    }
    return bad.slice(0, 5)
  })
const inDialog = (page: Page, text: string) => page.$eval(DIALOG, (el, t) => el.textContent?.includes(t) ?? false, text)
const waitDialog = (page: Page, text: string) => page.waitForFunction((t) => document.querySelector('[role="dialog"]')?.textContent?.includes(t) ?? false, { timeout: 10000 }, text)
const clickText = async (page: Page, text: string) => {
  for (const b of await page.$$(`${DIALOG} button`)) {
    const t = await b.evaluate((el) => el.textContent?.replace(/\s+/g, ' ').trim())
    if (t === text || t?.startsWith(text)) {
      await b.click()
      return
    }
  }
  throw new Error(`no button "${text}"`)
}
const checkedRadios = (page: Page) => page.$$eval(`${DIALOG} [role="radio"][aria-checked="true"]`, (els) => els.map((el) => el.textContent ?? ''))
async function shot(page: Page, name: string, width: number) {
  await page.screenshot({ path: `${OUT}/${name}-${width}.png` })
  check(`${name} ${width}: no sideways scroll`, await noScroll(page))
  const spill = await overflowing(page)
  check(`${name} ${width}: no text spilling out of its box`, spill.length === 0, spill.join(' | '))
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  let createdId: string | null = null
  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage()
      await page.setViewport({ width, height: 900 })
      await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
      const go = (path: string) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 90000 })

      await go('/projects')
      await shot(page, 'list', width)

      for (const goal of ['inquiries', 'signing'] as const) {
        const first = goal === 'inquiries'
        await go('/projects?new=1')
        await page.waitForSelector(DIALOG, { timeout: 10000 })

        // 1. the goal, and the comparison under the cards
        check(`wizard ${width} ${goal}: first question is what you want to do`, await inDialog(page, 'מה תרצו לעשות?') && await inDialog(page, 'לאסוף פרטים מאנשים') && await inDialog(page, 'להחתים אנשים על מסמכים'))
        if (first) {
          await shot(page, 'wizard-1', width)
          await page.click(`${DIALOG} summary`)
          await waitDialog(page, 'מה קורה אחרי הטופס')
          check(`wizard ${width}: comparison names both goals and all seven rows`, await inDialog(page, 'איסוף פניות') && await inDialog(page, 'החתמה על מסמכים') && await inDialog(page, 'דוחות') && await inDialog(page, 'הזמנה אישית'))
          await shot(page, 'wizard-1-compare', width)
        }
        await clickText(page, first ? 'לאסוף פרטים מאנשים' : 'להחתים אנשים על מסמכים')

        // 2. the audience — nothing preselected, "both" explains itself
        await waitDialog(page, 'למי הקמפיין מיועד?')
        check(`wizard ${width} ${goal}: no audience preselected`, (await checkedRadios(page)).length === 0)
        if (first) await shot(page, 'wizard-2', width)
        await clickText(page, 'שניהם')
        await waitDialog(page, 'בכל הזמנה או הרשמה תבחרו אם זה ספק או לקוח')
        if (first) await shot(page, 'wizard-2-both', width)
        await clickText(page, 'המשך')

        // 3. the entry — only what fits the goal, the usual one preselected
        await waitDialog(page, 'איך אנשים ייכנסו לקמפיין?')
        const checked = await checkedRadios(page)
        check(`wizard ${width} ${goal}: the usual entry is preselected`, checked.length === 1 && checked[0].includes(first ? 'טופס ציבורי' : 'קיימים'), checked.join(' | ').slice(0, 60))
        check(`wizard ${width} ${goal}: only the entries that fit the goal`, (await inDialog(page, 'קיימים')) === !first)
        await shot(page, `wizard-3-${goal}`, width)
        await clickText(page, 'המשך')

        // 4. details — a name, and for signing the document
        await waitDialog(page, 'איך נקרא לקמפיין?')
        check(`wizard ${width} ${goal}: asks for the document only when signing`, (await inDialog(page, 'איזה מסמך חותמים?')) === !first)
        await page.type(`${DIALOG} input`, 'בדיקה — אשף')
        await shot(page, `wizard-4-${goal}`, width)

        if (CREATE && !createdId && !first) {
          await clickText(page, 'יצירת הקמפיין')
          await page.waitForFunction(() => /^\/projects\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 30000 })
          createdId = new URL(page.url()).pathname.split('/')[2]
          console.log(`created campaign "בדיקה — אשף": ${createdId}`)
        }
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log(failures === 0 ? 'CAMPAIGNS SHOTS OK' : `${failures} checks failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
