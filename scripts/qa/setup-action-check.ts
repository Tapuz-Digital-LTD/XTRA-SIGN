import { mkdirSync } from 'node:fs'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import puppeteer, { type Page } from 'puppeteer-core'
import { getDb, schema } from '@/server/db'

/**
 * A worker must see at once what to press to say "this supplier's product is
 * up on the site". On every screen that shows the task (setup tab, הרשמות,
 * ספקים/לקוחות rows, company card), at 1440 and 390:
 *   - the only control is a real button reading "סמן כהוקם באתר", ≥44px tall
 *   - nothing reading just "הוקם" / "הוקם באתר" is a button or link
 *   - a finished row shows "הוקם באתר" as text plus "פתח את המוצר" when linked
 * Then the real flow, once: press the button → dialog → link → save → the row
 * shows the mark. The task is put back to pending afterwards (local DB only).
 *
 *   SESSION=<token> npx dotenv -e .env.local -- npx tsx scripts/qa/setup-action-check.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const SESSION = process.env.SESSION ?? ''
const OUT = process.env.OUT_DIR ?? '.design/qa/setup-action'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const results: string[] = []
let failed = 0
const check = (ok: boolean, label: string, detail?: string) => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** What the page offers for the task: real buttons vs things that only look like one. */
/** What the page offers for the task: real buttons vs things that only look like one. */
async function audit(page: Page) {
  // No local helpers inside evaluate: the bundler renames them and the page breaks.
  return page.evaluate(() => {
    const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    const markButtons = controls.filter((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim() === 'סמן כהוקם באתר')
    const badgeLike = controls
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => /^✓?\s*הוקם( באתר)?$/.test(t) || t === 'סמן כהוקם')
    const marks = [...document.querySelectorAll('[data-setup-done]')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    return {
      markButtons: markButtons.map((el) => ({ h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width), tag: el.tagName })),
      badgeLike,
      marks: marks.map((m) => (m.textContent ?? '').replace(/\s+/g, ' ').trim()),
      markInsideControl: marks.filter((m) => m.closest('button, a, [role="button"]')).length,
    }
  })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const db = getDb()
  const [g] = await db.select({ id: schema.groups.id }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), eq(schema.groups.entryMethod, 'custom'))).orderBy(desc(schema.groups.createdAt)).limit(1)
  if (!g) throw new Error('no campaign')
  const [company] = await db.execute(sql`select c.id from follow_up_tasks t join companies c on c.id = t.company_id where t.group_id = ${g.id} and c.deleted_at is null and t.status in ('pending','in_progress') order by t.created_at desc limit 1`).then((r) => r.rows as { id: string }[])
  const started = new Date()

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--lang=he-IL'] })
  try {
    const page = await browser.newPage()
    await page.setCookie({ name: 'xtra_sign_session', value: SESSION, url: BASE })

    const screens: { label: string; url: string; expectButton: boolean }[] = [
      { label: 'setup tab', url: `/projects/${g.id}?tab=setup&status=pending`, expectButton: true },
      { label: 'הרשמות', url: `/projects/${g.id}?tab=joining&view=registrations`, expectButton: true },
      { label: 'כל התהליכים', url: `/projects/${g.id}?tab=joining&view=all`, expectButton: true },
      ...(company ? [{ label: 'company card', url: `/companies/${company.id}`, expectButton: true }] : []),
    ]
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width < 600 ? 844 : 900 })
      for (const s of screens) {
        await page.goto(`${BASE}${s.url}`, { waitUntil: 'networkidle0', timeout: 90000 })
        const a = await audit(page)
        check(a.badgeLike.length === 0, `${s.label} @${width}: nothing badge-like is clickable`, a.badgeLike.join(', '))
        check(a.markInsideControl === 0, `${s.label} @${width}: "הוקם באתר" mark is never inside a control`)
        if (s.expectButton) {
          check(a.markButtons.length > 0, `${s.label} @${width}: has a real "סמן כהוקם באתר" button`, `${a.markButtons.length}`)
          check(a.markButtons.every((b) => b.h >= 44 && b.tag === 'BUTTON'), `${s.label} @${width}: every mark button is a <button> ≥44px`, JSON.stringify(a.markButtons.slice(0, 3)))
          if (width === 390 && s.label === 'setup tab') check(a.markButtons.some((b) => b.w >= 300), 'setup tab @390: the card button spans the card', JSON.stringify(a.markButtons[0]))
        }
        await page.screenshot({ path: `${OUT}/${s.label.replace(/\s+/g, '-')}-${width}.png` })
      }
    }

    // The real flow, on the desktop table: press → dialog → link → save → mark.
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${BASE}/projects/${g.id}?tab=setup&status=pending`, { waitUntil: 'networkidle0', timeout: 90000 })
    const rowName = await page.$eval('[data-setup-table] tbody tr td:nth-child(2)', (td) => (td.textContent ?? '').trim())
    const [button] = await page.$$('xpath/.//*[@data-setup-table]//tbody//button[normalize-space(.)="סמן כהוקם באתר"]')
    check(Boolean(button), 'flow: first pending row has the button', rowName)
    await button!.evaluate((b) => (b as HTMLElement).click())
    await page.waitForSelector('[role="dialog"] input[type="url"]', { timeout: 5000 })
    const title = await page.$eval('[role="dialog"] h2', (h) => (h.textContent ?? '').trim())
    check(title === 'סמן כהוקם באתר', 'flow: dialog opens with the same words as the button', title)
    await page.screenshot({ path: `${OUT}/flow-1-dialog.png` })
    await page.type('[role="dialog"] input[type="url"]', 'https://www.xtra.co.il/product/qa-123')
    await page.click('[role="dialog"] button[type="submit"]')
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 10000 })
    await wait(600)
    // The row left the "pending" list; show it under "הכול".
    await page.goto(`${BASE}/projects/${g.id}?tab=setup&status=done`, { waitUntil: 'networkidle0', timeout: 90000 })
    const after = await audit(page)
    const doneRow = await page.$$eval('[data-setup-table] tbody tr', (trs, name) => {
      const tr = trs.filter((t) => (t.querySelector('td:nth-child(2)')?.textContent ?? '').trim() === name)[0]
      if (!tr) return null
      const cell = tr.querySelector('td:last-child')
      const buttons = cell ? [...cell.querySelectorAll('button')] : []
      return { text: (cell?.textContent ?? '').replace(/\s+/g, ' ').trim(), hasButton: buttons.filter((b) => (b.textContent ?? '').includes('סמן')).length > 0, link: cell?.querySelector('a')?.getAttribute('href') ?? null }
    }, rowName)
    check(Boolean(doneRow && doneRow.text.includes('הוקם באתר') && doneRow.link === 'https://www.xtra.co.il/product/qa-123'), 'flow: the finished row shows "הוקם באתר" + the product link', JSON.stringify(doneRow))
    check(Boolean(doneRow && !doneRow.hasButton), 'flow: the finished row offers no "סמן" button any more', JSON.stringify(doneRow))
    check(after.badgeLike.length === 0 && after.markInsideControl === 0, 'flow: done list has no clickable badge')
    await page.screenshot({ path: `${OUT}/flow-2-done.png` })
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(`${BASE}/projects/${g.id}?tab=setup&status=done`, { waitUntil: 'networkidle0', timeout: 90000 })
    await page.screenshot({ path: `${OUT}/flow-2-done-390.png` })
  } finally {
    await browser.close()
    // Put the task back exactly as it was (the check marks one task done).
    const touched = await db.select({ id: schema.followUpTasks.id }).from(schema.followUpTasks).where(and(eq(schema.followUpTasks.groupId, g.id), eq(schema.followUpTasks.status, 'done'), gt(schema.followUpTasks.completedAt, started)))
    for (const t of touched) await db.update(schema.followUpTasks).set({ status: 'pending', link: null, completedAt: null, completedBy: null }).where(eq(schema.followUpTasks.id, t.id))
    results.push(`restored ${touched.length} task(s) to pending`)
  }
  console.log(results.join('\n'))
  if (failed) {
    console.error(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`SETUP ACTION OK → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  console.log(results.join('\n'))
  process.exit(1)
})
