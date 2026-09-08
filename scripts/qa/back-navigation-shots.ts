import { mkdirSync } from 'node:fs'
import puppeteer, { type Page } from 'puppeteer-core'

/**
 * Back navigation, in a real browser at 1440 and 390:
 *   (a) campaign → קהל → company card → "חזרה" lands on the same campaign URL (tab, view, search)
 *   (b) suppliers list with source + search → card → "חזרה" lands on the same list URL
 *   (c) a card opened directly (no returnTo) falls back to its own list
 *   (d) the browser's back from a card returns to the list URL with the scroll position restored
 *   (e) a crafted returnTo (absolute URL, protocol-relative, backslash) falls back
 *
 *   SESSION=<token> E2E_BASE=http://localhost:3057 npx tsx scripts/qa/back-navigation-shots.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT ?? '.design/qa/back-navigation'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// page.evaluate / page.$eval below are puppeteer's run-in-page helpers, not eval().
const BACK = 'a[data-back-link]'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Same page, same query — whatever the encoding or the order of the params. */
function canon(url: string): string {
  const u = new URL(url, BASE)
  return `${u.pathname}?${[...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join('&')}`
}
const same = (a: string, b: string) => canon(a) === canon(b)

async function goto(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 90000 })
}

async function waitForPath(page: Page, prefix: string) {
  await page.waitForFunction((p: string) => location.pathname.startsWith(p), { timeout: 30000 }, prefix)
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {})
}

/** Clicks the first visible match, through the DOM, so Next's Link and React's onClick handle it. */
async function clickVisible(page: Page, selectors: string[]): Promise<boolean> {
  return page.evaluate((list: string[]) => {
    for (const selector of list) {
      const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.offsetParent !== null)
      if (el) {
        el.click()
        return true
      }
    }
    return false
  }, selectors)
}

const backHref = (page: Page) => page.$eval(BACK, (a) => a.getAttribute('href') ?? '').catch(() => '')
const backText = (page: Page) => page.$eval(BACK, (a) => a.textContent?.trim() ?? '').catch(() => '')
const clickBack = (page: Page) => page.evaluate((sel: string) => (document.querySelector(sel) as HTMLElement).click(), BACK)

type Found = { projectId: string | null; company: { id: string; name: string; kind: 'supplier' | 'customer' } }

async function discover(page: Page): Promise<Found> {
  // A campaign that has audience rows: the tracking screen's filter lists exactly those.
  await goto(page, '/tracking')
  const projectId = await page.evaluate(
    () => Array.from(document.querySelectorAll<HTMLOptionElement>('select[name=campaign] option')).map((o) => o.value).find((v) => /^[0-9a-f-]{36}$/i.test(v)) ?? null,
  )
  for (const kind of ['supplier', 'customer'] as const) {
    await goto(page, `/${kind}s?source=xtra`)
    const found = await page.evaluate(() => {
      const a = document.querySelector<HTMLAnchorElement>('a[href*="/companies/"]')
      const id = a?.getAttribute('href')?.match(/\/companies\/([^/?]+)/)?.[1]
      return id ? { id, name: a?.textContent?.trim() ?? '' } : null
    })
    if (found) return { projectId, company: { ...found, kind } }
  }
  throw new Error('no company on the XTRA Sign side to open')
}

async function run(page: Page, width: number, height: number, found: Found) {
  const tag = String(width)
  await page.setViewport({ width, height })
  const { projectId, company } = found
  const list = `/${company.kind}s`

  // (a) campaign → קהל → company → back
  if (projectId) {
    const audience = `/projects/${projectId}?tab=joining&view=waiting`
    await goto(page, audience)
    let opened = false
    for (const button of (await page.$$('button[aria-label="פעולות"]')).slice(0, 8)) {
      if (!(await button.evaluate((e) => (e as HTMLElement).offsetParent !== null))) continue
      await button.evaluate((e) => (e as HTMLElement).click())
      if (!(await page.waitForSelector('[role="menuitem"]', { timeout: 3000 }).catch(() => null))) continue
      const hit = await page.evaluate(() => {
        const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((e) => e.textContent?.trim() === 'פתח ספק/לקוח')
        if (!item) return false
        item.click()
        return true
      })
      if (hit) {
        opened = true
        break
      }
      await page.mouse.click(2, 2)
    }
    if (opened) {
      await waitForPath(page, '/companies/')
      const href = await backHref(page)
      check(`[${tag}] a1 audience row menu → card carries the campaign URL`, same(href, audience), href || 'no back link')
      await page.screenshot({ path: `${OUT}/${tag}-a1-card.png` })
      await clickBack(page)
      await waitForPath(page, '/projects/')
      check(`[${tag}] a1 "חזרה" → the campaign's audience tab`, same(page.url(), audience), page.url())
    } else console.log(`SKIP [${tag}] a1 — no audience row with a company among the first rows`)

    const campaign = `/projects/${projectId}?tab=joining&view=waiting&q=x`
    await goto(page, campaign)
    await goto(page, `/companies/${company.id}?returnTo=${encodeURIComponent(campaign)}`)
    check(`[${tag}] a2 card label names the campaign`, (await backText(page)).includes('חזרה לקמפיין'), await backText(page))
    const tabKeeps = await page.$eval('a[href*="tab=details"]', (a) => (a.getAttribute('href') ?? '').includes('returnTo=')).catch(() => false)
    check(`[${tag}] a2 card tabs keep returnTo`, tabKeeps)
    await clickBack(page)
    await waitForPath(page, '/projects/')
    check(`[${tag}] a2 "חזרה" → same campaign, tab, view and search`, same(page.url(), campaign), page.url())
    await page.screenshot({ path: `${OUT}/${tag}-a2-campaign.png` })
  } else console.log(`SKIP [${tag}] a — no campaign with audience rows`)

  // (b) filtered list → card → back
  const filtered = `${list}?source=xtra&q=${encodeURIComponent(company.name.split(/\s+/)[0])}`
  await goto(page, filtered)
  if (await clickVisible(page, ['a[href*="/companies/"]', 'tbody tr'])) {
    await waitForPath(page, '/companies/')
    const href = await backHref(page)
    check(`[${tag}] b card back link = the filtered list`, same(href, filtered), href || 'no back link')
    await page.screenshot({ path: `${OUT}/${tag}-b-card.png` })
    await clickBack(page)
    await waitForPath(page, list)
    check(`[${tag}] b "חזרה" → same list URL (source + search)`, same(page.url(), filtered), page.url())
  } else check(`[${tag}] b filtered list has a row to open`, false, filtered)

  // (c) direct open: no returnTo → the list on the company's side
  await goto(page, `/companies/${company.id}`)
  const fallback = await backHref(page)
  check(`[${tag}] c direct open falls back to ${list}`, fallback.startsWith(list), `${fallback} · ${await backText(page)}`)
  await page.screenshot({ path: `${OUT}/${tag}-c-direct.png` })

  // (d) browser back from a card: same list URL, scroll restored
  const plain = `${list}?source=xtra`
  await goto(page, plain)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(400)
  const y0 = await page.evaluate(() => window.scrollY)
  if (await clickVisible(page, ['a[href*="/companies/"]', 'tbody tr'])) {
    await waitForPath(page, '/companies/')
    await page.goBack().catch(() => null)
    await waitForPath(page, list)
    await sleep(600)
    const y1 = await page.evaluate(() => window.scrollY)
    check(`[${tag}] d browser back → same list URL`, same(page.url(), plain), page.url())
    check(`[${tag}] d scroll restored (${y0} → ${y1})`, Math.abs(y1 - y0) <= 50, y0 === 0 ? 'list too short to scroll — trivially restored' : '')
    await page.screenshot({ path: `${OUT}/${tag}-d-back.png` })
  } else check(`[${tag}] d list has a row to open`, false, plain)

  // (e) crafted returnTo never leaves the origin
  for (const bad of ['https://evil.example', '//evil', '/\\evil.example', 'javascript:alert(1)']) {
    await goto(page, `/companies/${company.id}?returnTo=${encodeURIComponent(bad)}`)
    const href = await backHref(page)
    check(`[${tag}] e returnTo=${bad} falls back`, href.startsWith(list), href || 'no back link')
  }
}

async function main() {
  if (!SESSION) throw new Error('SESSION is required (npx dotenv -e .env.local -- npx tsx scripts/dev-session.ts)')
  mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })
    await page.setViewport({ width: 1440, height: 900 })
    const found = await discover(page)
    console.log(`campaign: ${found.projectId ?? 'none'} · ${found.company.kind}: ${found.company.name} (${found.company.id})`)
    await run(page, 1440, 600, found)
    await run(page, 390, 700, found)
  } finally {
    await browser.close()
  }
  console.log(failures ? `${failures} FAILED` : 'all checks passed')
  if (failures) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
