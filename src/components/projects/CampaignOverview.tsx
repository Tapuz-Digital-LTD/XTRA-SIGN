import Link from 'next/link'
import type { CampaignKind } from '@/lib/campaigns'
import type { TaskKindCounts } from '@/server/follow-up/tasks'
import { CopyButton } from '@/components/ui/CopyButton'

/**
 * "סקירה": only what matters — status, the page, the four numbers, a short
 * activity list — and two buttons. Twenty widgets is what a dashboard is
 * for; a campaign's overview is a glance.
 */

type Company = { id: string; name: string; lastSend: { agreementId: string | null; status: string; at: Date } | null }
type Lead = { id: string; status: string; data: { name?: string | null }; createdAt: Date; agreementId: string | null }

const dateTime = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
const number = new Intl.NumberFormat('he-IL')

export function CampaignOverview({
  project,
  companies,
  leads,
  setup = null,
  cards: workCards,
}: {
  project: { id: string; name: string; campaignKind: CampaignKind; publicUrl: string | null }
  companies: Company[]
  leads: Lead[]
  /** Follow-up tasks, one entry per task the campaign opens: how much of each is still waiting. */
  setup?: TaskKindCounts[] | null
  /** The work cards, each leading to the view that acts on it. */
  cards?: { label: string; value: number; href: string; tone?: 'warn' }[]
}) {
  const signed = companies.filter((c) => c.lastSend?.status === 'signed').length
  const pending = companies.filter((c) => c.lastSend && ['sent', 'viewed'].includes(c.lastSend.status)).length
  const registrations = leads.filter((l) => l.status !== 'pending').length
  const activity = [
    ...leads.map((l) => ({ at: l.createdAt, text: `${l.data.name ?? 'הרשמה'} נרשם/ה`, href: `/projects/${project.id}?tab=registrations` })),
    ...companies.filter((c) => c.lastSend).map((c) => ({
      at: c.lastSend!.at,
      text: `${c.name}: ${c.lastSend!.status === 'signed' ? 'חתם' : c.lastSend!.status === 'viewed' ? 'פתח את ההסכם, טרם חתם' : c.lastSend!.status === 'sent' ? 'ההסכם נשלח לחתימה' : c.lastSend!.status}`,
      href: c.lastSend!.agreementId ? `/documents/${c.lastSend!.agreementId}` : `/companies/${c.id}`,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8)

  const cards: { label: string; value: number; href?: string; tone?: 'warn' }[] = workCards ?? [
    { label: project.campaignKind === 'public' ? 'ספקים' : 'נמענים', value: companies.length },
    ...(project.campaignKind === 'public' ? [{ label: 'הרשמות', value: registrations }] : []),
    { label: 'חתמו', value: signed },
    { label: 'ממתינים לחתימה', value: pending },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${project.id}?tab=distributions&new=1`} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:opacity-90">
          הפצה חדשה
        </Link>
        {project.publicUrl ? (
          <>
            <a href={project.publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand">
              פתח עמוד
            </a>
            <CopyButton text={project.publicUrl} label="העתק קישור" />
          </>
        ) : null}
      </div>

      {project.publicUrl ? (
        <p className="break-all rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg" dir="ltr">
          {project.publicUrl}
        </p>
      ) : null}

      {setup && setup.length > 0 ? <SetupBanner projectId={project.id} tasks={setup} /> : null}

      {/* Each card is the door to the list that acts on it — a number nobody can open is just decoration. */}
      <div className="grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        {cards.map((c) => {
          const body = (
            <>
              <p className="text-xs text-muted">{c.label}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${c.tone === 'warn' && c.value > 0 ? 'text-amber-700' : 'text-fg'}`}>{number.format(c.value)}</p>
            </>
          )
          const box = `rounded-[var(--radius-card)] border p-4 ${c.tone === 'warn' && c.value > 0 ? 'border-amber-300 bg-amber-50' : 'border-line bg-surface'}`
          return c.href ? (
            <Link key={c.label} href={c.href} className={`${box} block transition hover:border-brand`}>
              {body}
            </Link>
          ) : (
            <div key={c.label} className={box}>
              {body}
            </div>
          )
        })}
      </div>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-fg">פעילות אחרונה</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-muted">עדיין אין פעילות. {project.campaignKind === 'public' ? 'שתפו את עמוד הקמפיין או צרו הפצה ראשונה.' : 'הוסיפו נמענים בלשונית "קהל" ושלחו הסכם או הפצה.'}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={a.href} className="min-w-0 truncate text-fg hover:underline">
                  {a.text}
                </Link>
                <span className="shrink-0 text-xs text-muted">{dateTime.format(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * The follow-up work waiting, one line per task.
 *
 * A campaign may open several tasks after a signature, and one summed line
 * ("13 ממתינות") hides which pile is behind. Each line names its task, says
 * where it stands, and is its own link into that task's list — so a number a
 * person reads is a number they can act on. With a single task the banner is
 * one line, because a heading over one line is furniture.
 */
function SetupBanner({ projectId, tasks }: { projectId: string; tasks: TaskKindCounts[] }) {
  const href = (kind: string | null, open: boolean) =>
    `/projects/${projectId}?tab=setup${open ? '&status=pending' : ''}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`
  const openWork = tasks.reduce((n, t) => n + t.counts.pending + t.counts.in_progress, 0)

  const line = (t: TaskKindCounts) => {
    const open = t.counts.pending + t.counts.in_progress
    if (open === 0) return `הכול בוצע (${t.counts.done})`
    const parts = [`${t.counts.pending} ממתינות`]
    if (t.counts.in_progress > 0) parts.push(`${t.counts.in_progress} בטיפול`)
    if (t.counts.done > 0) parts.push(`${t.counts.done} בוצעו`)
    return parts.join(' · ')
  }

  return (
    <section aria-labelledby="setup-banner-title" className={`rounded-xl border-2 px-5 py-4 ${openWork > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="setup-banner-title" className="text-base font-semibold text-fg">
          משימות המשך
        </h2>
        {openWork === 0 ? <span className="text-sm font-medium text-green-800">כל המשימות בוצעו</span> : null}
      </div>
      <ul className="mt-2 flex flex-col divide-y divide-amber-200/60">
        {tasks.map((t) => {
          const open = t.counts.pending + t.counts.in_progress
          return (
            <li key={t.kind} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{t.title}</span>
                <span className={`block text-sm ${open > 0 ? 'text-amber-900' : 'text-green-800'}`}>{line(t)}</span>
              </span>
              <Link
                href={href(t.kind, open > 0)}
                className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-fg transition hover:border-brand"
              >
                {open > 0 ? `לרשימה (${open})` : 'לרשימה'}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
