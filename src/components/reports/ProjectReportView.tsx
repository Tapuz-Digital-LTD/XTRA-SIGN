'use client'

import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ProjectReport, RegistrationRow } from '@/server/reports/project-report'
import { RegistrationsTable } from './RegistrationsTable'

/**
 * The project's report, top to bottom: the numbers, the funnel, three
 * charts, where people came from, and every registration with its story.
 *
 * Server-aggregated, client-drawn. The charts are plain SVG — three shapes,
 * no library — and the animation is one short pass on first paint: counters
 * settle, bars grow, the line draws itself. After that everything is
 * static. `prefers-reduced-motion` skips the pass entirely.
 */

export type ProjectReportData = Omit<ProjectReport, 'trafficSince' | 'registrations'> & {
  trafficSince: string | null
  registrations: (Omit<RegistrationRow, 'createdAt' | 'agreement'> & {
    createdAt: string
    agreement: { id: string; status: string; sentAt: string | null; completedAt: string | null } | null
  })[]
}

type Values = { from?: string; to?: string; status?: string; source?: string; range?: string }

const dateOnly = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'Asia/Jerusalem' })
const longDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' })
const number = new Intl.NumberFormat('he-IL')

const card = 'rounded-[var(--radius-card)] border border-line bg-surface'

export function ProjectReportView({
  projectId,
  report,
  values,
  exportHref,
}: {
  projectId: string
  report: ProjectReportData
  values: Values
  exportHref: string
}) {
  const reduced = useReducedMotion()
  const sourceOptions = report.sources.map((s) => ({ key: s.key, label: s.medium ? `${s.label} / ${s.medium}` : s.label }))
  const dedupedSources = [...new Map(sourceOptions.map((s) => [s.key, s])).values()]

  return (
    <div className="flex flex-col gap-5">
      <Filters projectId={projectId} values={values} sources={dedupedSources} exportHref={exportHref} />

      {report.hasCampaignPage ? (
        <p className="text-xs text-muted">
          {report.trafficSince
            ? `נתוני התנועה זמינים החל מ-${longDate.format(new Date(report.trafficSince))}.`
            : 'נתוני תנועה לעמוד הקמפיין יתחילו להיאסף מהכניסה הראשונה לעמוד.'}
        </p>
      ) : null}

      <Kpis report={report} reduced={reduced} />

      <Routes report={report} />

      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelCard
          id="rp-invitations"
          title="הזמנות אישיות"
          blurb="אנשים שהצוות פנה אליהם בעצמו. כל מוזמן נספר פעם אחת, גם אם נשלחה לו הזמנה שוב."
          steps={report.funnels.invitations}
          empty="עדיין לא נשלחו הזמנות אישיות בקמפיין הזה."
          ofLabel="מכלל המוזמנים"
          reduced={reduced}
        />
        <FunnelCard
          id="rp-site"
          title="הגעה עצמאית מהאתר"
          blurb="אנשים שהגיעו לעמוד בלי הזמנה אישית. ״מבקר״ הוא דפדפן ייחודי, לא צפייה בדף."
          steps={report.funnels.site}
          empty="עדיין אין תנועה עצמאית לעמוד הקמפיין."
          ofLabel="מכלל המבקרים"
          reduced={reduced}
        />
      </div>

      <Reminders reminders={report.funnels.reminders} />

      {report.funnels.stuck.length > 0 ? (
        <section className={`${card} p-5`} aria-labelledby="rp-stuck">
          <h2 id="rp-stuck" className="text-sm font-semibold text-fg">איפה אנשים נתקעים</h2>
          <p className="mt-1 text-xs text-muted">כל מספר הוא רשימה — לחיצה פותחת בדיוק את האנשים האלה.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {report.funnels.stuck.map((s) => (
              <Link key={s.key} href={s.href} className="rounded-lg border border-line bg-bg p-3 transition hover:border-brand" title={s.hint}>
                <span className="block text-2xl font-bold tabular-nums text-fg">{number.format(s.count)}</span>
                <span className="mt-1 block text-xs text-fg">{s.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        {report.hasCampaignPage ? (
          <section className={`${card} min-w-0 p-5 lg:col-span-2`} aria-labelledby="rp-sources">
            <h2 id="rp-sources" className="text-sm font-semibold text-fg">
              מקורות התנועה <span className="font-normal text-muted">· בתוך ההגעה העצמאית</span>
            </h2>
            <p className="mt-1 text-xs text-muted">רק מי שהגיע בלי הזמנה אישית. ״ישירות״ הוא ביקור בלי מקור מזוהה — לא הזמנה. מעבר בין הדפים שלנו אינו מקור חיצוני.</p>
            <Sources projectId={projectId} sources={report.sources} reduced={reduced} />
          </section>
        ) : null}
        <section className={`${card} min-w-0 p-5 ${report.hasCampaignPage ? 'lg:col-span-3' : 'lg:col-span-5'}`} aria-labelledby="rp-timeline">
          <h2 id="rp-timeline" className="text-sm font-semibold text-fg">
            פעילות לאורך זמן <span className="font-normal text-muted">· לפי {report.timeline.granularity === 'day' ? 'יום' : 'שבוע'}</span>
          </h2>
          <Timeline projectId={projectId} points={report.timeline.points} showVisits={report.hasCampaignPage} reduced={reduced} />
        </section>
      </div>

      <section className={`${card} p-5`} aria-labelledby="rp-status">
        <h2 id="rp-status" className="text-sm font-semibold text-fg">סטטוס ההסכמים</h2>
        <Donut projectId={projectId} slices={report.statuses} reduced={reduced} />
      </section>

      <RegistrationsTable rows={report.registrations} total={report.registrationTotal} projectId={projectId} />
    </div>
  )
}

/** An empty chart says what has not happened yet, and offers a real way forward. */
function NoData({ projectId, text, share = false }: { projectId: string; text: string; share?: boolean }) {
  const link = 'inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand'
  return (
    <div className="mt-6 text-center">
      <p className="text-sm text-muted">{text}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {share ? (
          <Link href={`/projects/${projectId}?tab=settings&section=page`} className={link}>שיתוף הקישור</Link>
        ) : (
          <>
            <Link href={`/projects/${projectId}?tab=reports`} className={link}>כל התקופה</Link>
            <Link href={`/projects/${projectId}?tab=invitations`} className={link}>שליחת הזמנה</Link>
          </>
        )}
      </div>
    </div>
  )
}

// ── filters ───────────────────────────────────────────────────────────────

function Filters({ projectId, values, sources, exportHref }: { projectId: string; values: Values; sources: { key: string; label: string }[]; exportHref: string }) {
  const field = 'mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand'
  const quick = (range: string, label: string) => {
    const active = (values.range ?? (values.from || values.to ? 'custom' : 'all')) === range
    const params = new URLSearchParams({ tab: 'reports' })
    if (range !== 'all') params.set('range', range)
    if (values.status) params.set('status', values.status)
    if (values.source) params.set('source', values.source)
    return (
      <Link
        key={range}
        href={`/projects/${projectId}?${params}`}
        className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition ${
          active ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg hover:border-brand'
        }`}
        aria-current={active ? 'page' : undefined}
      >
        {label}
      </Link>
    )
  }
  return (
    <form method="get" action={`/projects/${projectId}`} className={`${card} p-4`}>
      <input type="hidden" name="tab" value="reports" />
      <div className="flex flex-wrap gap-2">
        {quick('today', 'היום')}
        {quick('7d', '7 ימים')}
        {quick('30d', '30 ימים')}
        {quick('all', 'כל התקופה')}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">
          <span className="block text-xs text-muted">מתאריך</span>
          <input type="date" name="from" defaultValue={values.from ?? ''} className={field} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">עד תאריך</span>
          <input type="date" name="to" defaultValue={values.to ?? ''} className={field} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">סטטוס</span>
          <select name="status" defaultValue={values.status ?? ''} className={field}>
            <option value="">הכול</option>
            <option value="signed">נחתמו</option>
            <option value="pending">ממתינים לחתימה</option>
            <option value="expired">פג תוקף</option>
            <option value="failed">נכשלו / בוטלו</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">מקור הגעה</span>
          <select name="source" defaultValue={values.source ?? ''} className={field}>
            <option value="">הכול</option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:opacity-90">
            הצגה
          </button>
          <a
            href={exportHref}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand"
          >
            ייצוא ל-Excel
          </a>
        </div>
      </div>
    </form>
  )
}

// ── summary cards ─────────────────────────────────────────────────────────

/**
 * The numbers a campaign manager opens the screen for, and the two conversion
 * rates that matter — one per route, never blended: an invitation that turned
 * into a signature, and a visit that turned into one. Each rate's denominator
 * is written under it, and the block below shows the same two routes as a
 * split of the signatures themselves.
 */
function Kpis({ report, reduced }: { report: ProjectReportData; reduced: boolean }) {
  const h = report.funnels.headline
  const cards: { label: string; value: number | null; text?: string; hint?: string }[] = [
    { label: 'הזמנות אישיות', value: h.invited, hint: 'אנשים ייחודיים שהוזמנו' },
    ...(report.hasCampaignPage ? [{ label: 'מבקרי אתר', value: h.visitors, hint: `${number.format(h.sessions)} ביקורים` }] : []),
    { label: 'הרשמות', value: report.kpis.registrations.value, hint: 'טפסים שהוגשו' },
    { label: 'חתימות', value: h.signedTotal, hint: `${number.format(h.invitedSigned)} מהזמנה · ${number.format(h.siteSigned)} מהאתר` },
    { label: 'ממתינים לחתימה', value: report.kpis.pending.value, hint: 'הסכם נשלח, טרם נחתם' },
    { label: 'המרת הזמנות', value: null, text: pct(h.invitedConversion), hint: 'חתמו מתוך המוזמנים' },
    ...(report.hasCampaignPage ? [{ label: 'המרת האתר', value: null, text: pct(h.siteConversion), hint: 'חתמו מתוך המבקרים' }] : []),
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {cards.map((c) => (
        <div key={c.label} className={`${card} p-4`}>
          <p className="text-xs text-muted">{c.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{c.value === null ? c.text : <CountUp value={c.value} reduced={reduced} />}</p>
          {c.hint ? <p className="mt-1 text-[11px] text-muted">{c.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}

/**
 * Where the signatures came from — the first question the screen answers.
 *
 * Two routes, each with its own count, its own share of the total and its
 * own conversion measured against its own denominator: an invitation against
 * the people invited, a visit against the browsers that came. The bar is the
 * split of the signatures themselves, so "most of our results come from
 * outreach" is readable without doing arithmetic.
 *
 * Traffic sources (Google, UTM, referral, direct) are a breakdown *inside*
 * the second route, further down the screen — never a peer of "הזמנה אישית".
 */
function Routes({ report }: { report: ProjectReportData }) {
  const h = report.funnels.headline
  const total = h.signedTotal
  const share = (value: number) => (total > 0 ? (value / total) * 100 : 0)
  const routes = [
    {
      key: 'invited',
      label: 'הזמנה אישית',
      blurb: 'הצוות פנה אליהם',
      signed: h.invitedSigned,
      tone: 'bg-brand',
      rates: [{ text: pct(h.invitedConversion), of: `מתוך ${number.format(h.invited)} מוזמנים` }],
    },
    {
      key: 'site',
      label: 'הגעה עצמאית מהאתר',
      blurb: 'הגיעו לעמוד בעצמם',
      signed: h.siteSigned,
      tone: 'bg-green-600',
      rates: [
        { text: pct(h.siteConversion), of: `מתוך ${number.format(h.visitors)} מבקרים` },
        { text: pct(h.siteSubmittedToSigned), of: `מתוך ${number.format(h.siteRegistrations)} שהגישו טופס` },
      ],
    },
  ]
  return (
    <section className={`${card} p-5`} aria-labelledby="rp-routes">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rp-routes" className="text-sm font-semibold text-fg">
          מאיפה הגיעו החתימות
        </h2>
        <p className="text-sm text-muted">
          סה״כ <span className="font-semibold tabular-nums text-fg">{number.format(total)}</span> חתימות
        </p>
      </div>
      {total === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-bg px-4 py-6 text-center text-sm text-muted">עדיין אין חתימות בקמפיין.</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded bg-bg" role="img" aria-label={`${number.format(h.invitedSigned)} מהזמנה אישית, ${number.format(h.siteSigned)} מהאתר`}>
            {routes.map((r) => (r.signed > 0 ? <div key={r.key} className={r.tone} style={{ width: `${share(r.signed)}%` }} /> : null))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {routes.map((r) => (
              <div key={r.key} className="rounded-lg bg-bg p-4">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 shrink-0 rounded-full ${r.tone}`} aria-hidden="true" />
                  <span className="text-sm font-semibold text-fg">{r.label}</span>
                  <span className="text-xs text-muted">{r.blurb}</span>
                </div>
                {/* A gap that survives RTL: a margin on an inline span next to
                    tabular digits reads as no gap at all. */}
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums text-fg">{number.format(r.signed)}</span>
                  <span className="text-sm text-muted">{pct(Math.round(share(r.signed) * 10) / 10)} מהחתימות</span>
                </p>
                <dl className="mt-2 flex flex-col gap-0.5 text-xs">
                  {r.rates.map((rate) => (
                    <div key={rate.of} className="flex items-baseline gap-2">
                      <dt className="text-muted">המרה</dt>
                      <dd className="flex items-baseline gap-1.5 text-fg">
                        <span className="font-semibold tabular-nums">{rate.text}</span>
                        <span className="text-muted">{rate.of}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * One route, step by step.
 *
 * Each step carries three numbers a person actually asks for: how many, how
 * many of the step before, and how many of everyone who entered. The bar is
 * the share of the first step, so two funnels side by side are comparable at
 * a glance. The hint on each row says where the number is counted from —
 * an percentage nobody can explain is worse than no percentage.
 */
function FunnelCard({ id, title, blurb, steps, empty, ofLabel, reduced }: { id: string; title: string; blurb: string; steps: ProjectReportData['funnels']['invitations']; empty: string; ofLabel: string; reduced: boolean }) {
  const grown = useGrow(reduced)
  const start = steps[0]?.people ?? 0
  return (
    <section className={`${card} min-w-0 p-5`} aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold text-fg">
        {title}
      </h2>
      <p className="mt-1 text-xs text-muted">{blurb}</p>
      {start === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-bg px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {steps.map((s, i) => {
            const width = start > 0 ? Math.min(100, Math.max(2, (s.people / start) * 100)) : 0
            const last = i === steps.length - 1
            return (
              <li key={s.key} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-fg" title={s.source}>
                    {s.href ? (
                      <Link href={s.href} className="hover:underline">
                        {s.label}
                      </Link>
                    ) : (
                      s.label
                    )}
                  </span>
                  <span className="shrink-0 text-base font-semibold tabular-nums text-fg">{number.format(s.people)}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded bg-bg">
                  <div
                    className={`h-full rounded transition-[width] duration-700 ease-out ${last ? 'bg-green-600' : 'bg-brand'}`}
                    style={{ width: grown ? `${width}%` : 0 }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {i === 0
                    ? s.source
                    : s.exceedsPrevious
                      ? 'יותר מהשלב הקודם — חלק מהאנשים האלה לא נמדדו בשלב הקודם'
                      : [s.fromPrevious === null ? null : `${pct(s.fromPrevious)} מהשלב הקודם`, s.fromStart === null ? null : `${pct(s.fromStart)} ${ofLabel}`]
                          .filter(Boolean)
                          .join(' · ') || s.source}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/**
 * Reminders, without claiming a cause.
 *
 * Nobody can prove a person signed *because* of a reminder, so the screen
 * says "חתמו לאחר תזכורת" and defines it: a reminder went out before the
 * signature. The stronger reading — the reminder was the last thing that
 * reached them — is shown beside it when the message ledger can prove it.
 */
function Reminders({ reminders }: { reminders: ProjectReportData['funnels']['reminders'] }) {
  const r = reminders
  const cards: { label: string; text: string; hint?: string }[] = [
    { label: 'תזכורות שנשלחו', text: number.format(r.sent), hint: r.perPerson ? `${number.format(r.perPerson)} בממוצע לאדם` : undefined },
    { label: 'אנשים שקיבלו תזכורת', text: number.format(r.people) },
    { label: 'חתמו לאחר תזכורת', text: number.format(r.signedAfter), hint: r.people > 0 ? `${pct(Math.round((r.signedAfter / r.people) * 1000) / 10)} מהמקבלים` : undefined },
    { label: 'קיבלו ועדיין לא חתמו', text: number.format(r.remindedNotSigned) },
    ...(r.lastTouch !== null ? [{ label: 'התזכורת הייתה המגע האחרון', text: number.format(r.lastTouch), hint: 'ההודעה האחרונה לפני החתימה' }] : []),
  ]
  return (
    <section className={`${card} p-5`} aria-labelledby="rp-reminders">
      <h2 id="rp-reminders" className="text-sm font-semibold text-fg">השפעת תזכורות</h2>
      <p className="mt-1 text-xs text-muted">
        {r.sent === 0
          ? 'עדיין לא נשלחו תזכורות בקמפיין הזה.'
          : '״חתמו לאחר תזכורת״ = נשלחה להם תזכורת לפני החתימה. אי אפשר לדעת שהם חתמו בגללה, ולכן לא נטען כך.'}
      </p>
      {r.sent > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg bg-bg p-3">
              <p className="text-xs text-muted">{c.label}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-fg">{c.text}</p>
              {c.hint ? <p className="mt-1 text-[11px] text-muted">{c.hint}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Delta({ value, previous }: { value: number; previous: number }) {
  if (previous === 0 && value === 0) return <p className="mt-1 text-[11px] text-muted">ללא שינוי</p>
  const change = previous === 0 ? null : Math.round(((value - previous) / previous) * 100)
  const up = value >= previous
  return (
    <p className={`mt-1 text-[11px] ${up ? 'text-green-700' : 'text-red-700'}`}>
      {change === null ? `+${number.format(value)}` : `${up ? '▲' : '▼'} ${Math.abs(change)}%`} <span className="text-muted">לעומת התקופה הקודמת</span>
    </p>
  )
}

/** A number that settles on its value in under a second. */
function CountUp({ value, reduced }: { value: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? value : 0)
  useEffect(() => {
    if (reduced) {
      const frame = requestAnimationFrame(() => setShown(value))
      return () => cancelAnimationFrame(frame)
    }
    const start = performance.now()
    const duration = 700
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(value * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, reduced])
  return <>{number.format(shown)}</>
}

function Timeline({ projectId, points, showVisits, reduced }: { projectId: string; points: ProjectReportData['timeline']['points']; showVisits: boolean; reduced: boolean }) {
  const W = 600
  const H = 200
  const padX = 8
  const padTop = 12
  const padBottom = 28
  const series = [
    ...(showVisits ? [{ key: 'visits' as const, label: 'כניסות', color: '#94a3b8' }] : []),
    { key: 'registrations' as const, label: 'הרשמות', color: 'var(--color-accent, #2563eb)' },
    { key: 'signatures' as const, label: 'חתימות', color: '#16a34a' },
  ]
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key])))
  const n = Math.max(1, points.length - 1)
  const x = (i: number) => padX + (i / n) * (W - padX * 2)
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom)
  const path = (key: (typeof series)[number]['key']) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const grown = useGrow(reduced)
  const empty = points.every((p) => series.every((s) => p[s.key] === 0))
  const labelEvery = Math.max(1, Math.ceil(points.length / 6))

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
      {empty ? <NoData projectId={projectId} text="עדיין אין פעילות בטווח שנבחר — הרחיבו את הטווח או שלחו הזמנה." /> : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label="פעילות לאורך זמן" style={{ direction: 'ltr' }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padX} x2={W - padX} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" strokeOpacity={0.08} />
        ))}
        {series.map((s, si) => (
          <g key={s.key}>
            <path
              d={`${path(s.key)} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`}
              fill={s.color}
              fillOpacity={si === series.length - 1 ? 0.12 : 0.06}
              style={{ opacity: grown ? 1 : 0, transition: 'opacity 600ms ease-out' }}
            />
            <path
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              pathLength={1}
              style={{ strokeDasharray: 1, strokeDashoffset: grown ? 0 : 1, transition: 'stroke-dashoffset 900ms ease-out' }}
            />
          </g>
        ))}
        {points.map((p, i) =>
          (points.length - 1 - i) % labelEvery === 0 ? (
            <text key={p.bucket} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
              {dateOnly.format(new Date(`${p.bucket}T00:00:00Z`))}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  )
}

// ── donut ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  signed: '#16a34a',
  sent: '#f59e0b',
  viewed: '#3b82f6',
  expired: '#94a3b8',
  canceled: '#cbd5e1',
  failed: '#ef4444',
}

function Donut({ projectId, slices, reduced }: { projectId: string; slices: ProjectReportData['statuses']; reduced: boolean }) {
  const total = slices.reduce((a, s) => a + s.count, 0)
  const grown = useGrow(reduced)
  const R = 42
  const C = 2 * Math.PI * R
  // Where each slice starts along the ring, computed once rather than mutated while drawing.
  const starts = slices.reduce<number[]>((acc, s, i) => [...acc, (acc[i - 1] ?? 0) + (i > 0 ? (slices[i - 1].count / Math.max(1, total)) * C : 0)], [])
  if (total === 0) return <NoData projectId={projectId} text="עדיין אין הסכמים בטווח שנבחר — הרחיבו את הטווח או שלחו הזמנה." />
  return (
    <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
      <svg viewBox="0 0 120 120" className="size-40 shrink-0" role="img" aria-label="סטטוס ההסכמים">
        <circle cx={60} cy={60} r={R} fill="none" stroke="currentColor" strokeOpacity={0.06} strokeWidth={16} />
        {slices.map((s, i) => {
          const frac = s.count / total
          const dash = grown ? frac * C : 0
          return (
            <circle
              key={s.key}
              cx={60}
              cy={60}
              r={R}
              fill="none"
              stroke={STATUS_COLORS[s.key] ?? '#94a3b8'}
              strokeWidth={16}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-(starts[i] ?? 0)}
              transform="rotate(-90 60 60)"
              style={{ transition: 'stroke-dasharray 800ms ease-out' }}
            />
          )
        })}
        <text x={60} y={56} textAnchor="middle" fontSize={20} fontWeight={700} fill="currentColor">
          {number.format(total)}
        </text>
        <text x={60} y={72} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
          הסכמים
        </text>
      </svg>
      <ul className="w-full space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-fg">
              <span className="inline-block size-2.5 rounded-full" style={{ background: STATUS_COLORS[s.key] ?? '#94a3b8' }} aria-hidden="true" />
              {s.label}
            </span>
            <span className="tabular-nums text-muted">
              {number.format(s.count)} · {Math.round((s.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── sources ───────────────────────────────────────────────────────────────

function Sources({ projectId, sources, reduced }: { projectId: string; sources: ProjectReportData['sources']; reduced: boolean }) {
  const grown = useGrow(reduced)
  const max = Math.max(1, ...sources.map((s) => Math.max(s.visits, s.registrations)))
  if (sources.length === 0) return <NoData projectId={projectId} share text="עדיין אין כניסות לעמוד הקמפיין — כשתשתפו את הקישור, המקורות יופיעו כאן." />
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1.5 text-start font-medium">מקור</th>
            <th className="py-1.5 text-end font-medium">כניסות</th>
            <th className="py-1.5 text-end font-medium">הרשמות</th>
            <th className="py-1.5 text-end font-medium">חתימות</th>
            <th className="py-1.5 text-end font-medium">המרה</th>
          </tr>
        </thead>
        <tbody>
          {sources.slice(0, 8).map((s) => (
            <tr key={`${s.key}|${s.medium ?? ''}`} className="border-t border-line">
              <td className="py-2 pe-3">
                <span className="text-fg">{s.label}</span>
                {s.medium ? <span className="ms-1 text-xs text-muted">/ {s.medium}</span> : null}
                <div className="mt-1 h-1 w-full max-w-40 overflow-hidden rounded bg-bg">
                  <div className="h-full rounded bg-brand/60 transition-[width] duration-700 ease-out" style={{ width: grown ? `${(Math.max(s.visits, s.registrations) / max) * 100}%` : 0 }} />
                </div>
              </td>
              <td className="py-2 text-end tabular-nums text-fg">{s.visits ? number.format(s.visits) : '—'}</td>
              <td className="py-2 text-end tabular-nums text-fg">{number.format(s.registrations)}</td>
              <td className="py-2 text-end tabular-nums text-fg">{number.format(s.signatures)}</td>
              <td className="py-2 text-end tabular-nums text-muted">{pct(s.conversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────

function pct(value: number | null): string {
  return value === null || value > 100 ? '—' : `${number.format(value)}%`
}

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
function subscribeMotion(onChange: () => void) {
  const mq = window.matchMedia(MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION_QUERY).matches, () => false)
}

/** False on first paint, true a frame later — so a CSS transition has somewhere to go. */
function useGrow(reduced: boolean): boolean {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    if (grown) return
    // One frame later either way: a transition needs a "before" to leave from.
    const frame = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(frame)
  }, [reduced, grown])
  return grown || reduced
}
