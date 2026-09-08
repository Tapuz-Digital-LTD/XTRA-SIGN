import Link from 'next/link'
import type { CampaignKind } from '@/lib/campaigns'
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
  /** Site-product setup, when the campaign creates that task: how many signed suppliers still wait. */
  setup?: { pending: number; inProgress: number; done: number } | null
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
      text: `${c.name}: ${c.lastSend!.status === 'signed' ? 'חתם' : c.lastSend!.status === 'viewed' ? 'צפה בהסכם' : c.lastSend!.status === 'sent' ? 'נשלח הסכם' : c.lastSend!.status}`,
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

      {setup ? (
        <Link href={`/projects/${project.id}?tab=setup&status=pending`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-5 py-4 transition hover:border-amber-400">
          <span>
            <span className="block text-base font-semibold text-fg">הקמת מוצרים באתר</span>
            <span className="block text-sm text-amber-900">
              {setup.pending + setup.inProgress === 0 ? `כל הספקים שחתמו הוקמו באתר (${setup.done}).` : `${setup.pending} ממתינים להקמה · ${setup.inProgress} בטיפול · ${setup.done} הוקמו`}
            </span>
          </span>
          <span className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white">לרשימה</span>
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="text-xs text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{number.format(c.value)}</p>
          </div>
        ))}
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
