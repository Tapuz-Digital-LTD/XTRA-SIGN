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

      <Summary report={report} reduced={reduced} />

      {report.invitations ? (
        <section className={`${card} p-5`} aria-labelledby="rp-invitations">
          <h2 id="rp-invitations" className="text-sm font-semibold text-fg">הזמנות אישיות</h2>
          <p className="mt-1 text-xs text-muted">
            כל הזמנה נספרת פעם אחת, גם אם נשלחה שוב. המכנה לכל האחוזים הוא ההזמנות שנשלחו בפועל
            ({report.invitations.stages[0].count.toLocaleString('he-IL')} מתוך {report.invitations.created.toLocaleString('he-IL')} שנוצרו).
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <Funnel stages={report.invitations.stages} reduced={reduced} />
            </div>
            <dl className="grid grid-cols-2 gap-3 self-start text-sm lg:col-span-2">
              {report.invitations.stages.slice(1).map((stage, i) => {
                const base = report.invitations!.stages[0].count
                return (
                  <div key={stage.key} className={`rounded-lg bg-bg p-3 ${i === 2 ? 'ring-1 ring-brand' : ''}`}>
                    <dt className="text-xs text-muted">נשלחו ← {stage.label}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">
                      {base > 0 ? pct(Math.round((stage.count / base) * 1000) / 10) : '—'}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        {report.funnel.length > 2 ? (
          <section className={`${card} min-w-0 p-5 lg:col-span-2`} aria-labelledby="rp-funnel">
            <h2 id="rp-funnel" className="text-sm font-semibold text-fg">המשפך</h2>
            <Funnel stages={report.funnel} reduced={reduced} />
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-bg p-3">
                <dt className="text-xs text-muted">כניסה ← הרשמה</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{pct(report.conversion.visitToRegistration)}</dd>
              </div>
              <div className="rounded-lg bg-bg p-3">
                <dt className="text-xs text-muted">הרשמה ← חתימה</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{pct(report.conversion.registrationToSignature)}</dd>
              </div>
            </dl>
          </section>
        ) : null}
        <section className={`${card} min-w-0 p-5 ${report.funnel.length > 2 ? 'lg:col-span-3' : 'lg:col-span-5'}`} aria-labelledby="rp-timeline">
          <h2 id="rp-timeline" className="text-sm font-semibold text-fg">
            פעילות לאורך זמן <span className="font-normal text-muted">· לפי {report.timeline.granularity === 'day' ? 'יום' : 'שבוע'}</span>
          </h2>
          <Timeline projectId={projectId} points={report.timeline.points} showVisits={report.hasCampaignPage} reduced={reduced} />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${card} min-w-0 p-5`} aria-labelledby="rp-status">
          <h2 id="rp-status" className="text-sm font-semibold text-fg">סטטוס ההסכמים</h2>
          <Donut projectId={projectId} slices={report.statuses} reduced={reduced} />
        </section>
        {report.hasCampaignPage ? (
          <section className={`${card} min-w-0 p-5`} aria-labelledby="rp-sources">
            <h2 id="rp-sources" className="text-sm font-semibold text-fg">מקורות מובילים</h2>
            <Sources projectId={projectId} sources={report.sources} reduced={reduced} />
          </section>
        ) : null}
      </div>

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

function Summary({ report, reduced }: { report: ProjectReportData; reduced: boolean }) {
  const k = report.kpis
  const cards: { label: string; kpi: { value: number; previous: number | null } | null; text?: string; hint?: string }[] = [
    ...(report.hasCampaignPage ? [{ label: 'כניסות לדף', kpi: k.visits, hint: 'מבקרים ייחודיים' }] : []),
    { label: 'נרשמו', kpi: k.registrations },
    { label: 'הסכמים שנוצרו', kpi: k.agreements },
    { label: 'חתמו', kpi: k.signed },
    { label: 'ממתינים לחתימה', kpi: k.pending },
    { label: 'אחוז השלמה', kpi: null, text: pct(k.completionRate), hint: 'חתמו מתוך הנרשמים' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className={`${card} p-4`}>
          <p className="text-xs text-muted">{c.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-fg">
            {c.kpi ? <CountUp value={c.kpi.value} reduced={reduced} /> : c.text}
          </p>
          {c.kpi && c.kpi.previous !== null ? <Delta value={c.kpi.value} previous={c.kpi.previous} /> : c.hint ? <p className="mt-1 text-[11px] text-muted">{c.hint}</p> : null}
        </div>
      ))}
    </div>
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

// ── funnel ────────────────────────────────────────────────────────────────

function Funnel({ stages, reduced }: { stages: ProjectReportData['funnel']; reduced: boolean }) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  const grown = useGrow(reduced)
  return (
    <ol className="mt-4 flex flex-col gap-2">
      {stages.map((s, i) => {
        const prev = stages[i - 1]
        const raw = prev && prev.count > 0 ? Math.round((s.count / prev.count) * 100) : null
        // More than the stage before it means the earlier stage was not measured
        // for everyone (registrations through the API, traffic counted only
        // since a date) — not a conversion, so no number is shown.
        const step = raw !== null && raw <= 100 ? raw : null
        return (
          <li key={s.key}>
            {i > 0 ? (
              <p className="mb-1 text-[11px] text-muted" aria-hidden="true" title={raw !== null && raw > 100 ? 'השלב הקודם לא נמדד עבור כולם' : undefined}>
                ↓ {step === null ? '—' : `${step}%`}
              </p>
            ) : null}
            <div className="relative h-10 overflow-hidden rounded-lg bg-bg">
              <div
                className="absolute inset-y-0 end-0 rounded-lg bg-brand/15 transition-[width] duration-700 ease-out"
                style={{ width: grown ? `${Math.max(4, (s.count / max) * 100)}%` : '0%' }}
              />
              <div className="relative flex h-full items-center justify-between px-3 text-sm">
                <span className="text-fg">
                  {s.label}
                  {i > 0 && step !== null ? <span className="sr-only"> — {step}% מהשלב הקודם</span> : null}
                </span>
                <span className="font-semibold tabular-nums text-fg">{number.format(s.count)}</span>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── timeline (area chart) ─────────────────────────────────────────────────

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
