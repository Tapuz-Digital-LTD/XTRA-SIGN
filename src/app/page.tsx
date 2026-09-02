import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { getSession } from '@/server/auth/session'
import { getDashboardOverview, type AttentionItem } from '@/server/dashboard/overview'

/**
 * The home screen: what is waiting on me, what just closed, and where to go
 * next. Deliberately read-only — every tile is a link into the screen that can
 * actually act on it, so nothing here can leave the system in a half state.
 */

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

function Kpi({ href, label, value, hint }: { href: string; label: string; value: number; hint: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 flex-col justify-between rounded-xl border border-line bg-surface p-4 transition hover:border-brand hover:shadow-sm"
    >
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className="mt-2 text-3xl font-bold tabular-nums leading-none text-fg">{value}</span>
      <span className="mt-1 text-xs text-muted">{hint}</span>
    </Link>
  )
}

/** The expiry wording, which is the whole point of this row. */
function expiryNote(item: AttentionItem): { text: string; urgent: boolean } {
  if (item.expired) return { text: 'הקישור פג תוקף', urgent: true }
  if (item.daysLeft == null) return { text: 'ללא תפוגה', urgent: false }
  if (item.daysLeft <= 0) return { text: 'פג היום', urgent: true }
  if (item.daysLeft === 1) return { text: 'פג מחר', urgent: true }
  return { text: `פג בעוד ${item.daysLeft} ימים`, urgent: item.daysLeft <= 3 }
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const data = await getDashboardOverview(session)
  const hidden = Math.max(0, data.attentionTotal - data.attention.length)

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">לוח בקרה</h1>
          <p className="mt-1 text-sm text-muted">
            {session.isAdmin ? 'תמונת מצב של כל המסמכים בארגון.' : 'תמונת מצב של המסמכים שלך.'}
          </p>
        </div>
        <Link
          href="/documents/new"
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
        >
          מסמך חדש
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi href="/documents?filter=pending" label="ממתינים לחתימה" value={data.counts.pending} hint="נשלחו וטרם נחתמו" />
        <Kpi href="/documents?filter=signed" label="נחתמו" value={data.counts.signed} hint="הסתיימו בהצלחה" />
        <Kpi href="/documents?filter=drafts" label="טיוטות" value={data.counts.drafts} hint="עוד לא נשלחו" />
        <Kpi
          href="/suppliers"
          label="ספקים ולקוחות"
          value={data.companies.suppliers + data.companies.customers}
          hint={`${data.companies.suppliers} ספקים · ${data.companies.customers} לקוחות`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="דורש טיפול"
            action={
              data.attentionTotal > 0 ? (
                <Link href="/documents?filter=pending" className="text-xs font-medium text-brand hover:underline">
                  לכל הממתינים
                </Link>
              ) : null
            }
          >
            {data.attention.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                אין מסמכים שממתינים לחתימה. הכול סגור.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.attention.map((item) => {
                  const note = expiryNote(item)
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/documents/${item.id}`}
                        className="flex min-h-16 flex-col gap-1 px-4 py-3 transition hover:bg-bg sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                          <span className="block truncate text-xs text-muted">
                            {[item.recipientName, item.companyName].filter(Boolean).join(' · ') || 'ללא נמען'}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                            note.urgent ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {/* Wording, not just colour, carries the urgency. */}
                          {note.text}
                        </span>
                      </Link>
                    </li>
                  )
                })}
                {hidden > 0 ? (
                  <li className="px-4 py-2 text-xs text-muted">ועוד {hidden} ממתינים</li>
                ) : null}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="נחתמו לאחרונה">
            {data.recentlySigned.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">עדיין אין מסמכים חתומים.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentlySigned.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/documents/${item.id}`}
                      className="flex min-h-14 flex-col justify-center px-4 py-2.5 transition hover:bg-bg"
                    >
                      <span className="truncate text-sm font-medium text-fg">{item.title}</span>
                      <span className="truncate text-xs text-muted">
                        {[item.companyName, item.completedAt ? dateFormat.format(item.completedAt) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="מרחבי עבודה">
            <ul className="divide-y divide-line">
              <li>
                <Link href="/suppliers" className="flex min-h-14 items-center justify-between px-4 transition hover:bg-bg">
                  <span className="text-sm font-medium text-fg">ספקים</span>
                  <span className="text-sm tabular-nums text-muted">{data.companies.suppliers}</span>
                </Link>
              </li>
              <li>
                <Link href="/customers" className="flex min-h-14 items-center justify-between px-4 transition hover:bg-bg">
                  <span className="text-sm font-medium text-fg">לקוחות</span>
                  <span className="text-sm tabular-nums text-muted">{data.companies.customers}</span>
                </Link>
              </li>
              <li>
                <Link href="/templates" className="flex min-h-14 items-center justify-between px-4 transition hover:bg-bg">
                  <span className="text-sm font-medium text-fg">תבניות</span>
                  <span className="text-xs text-muted">מסמכים לשימוש חוזר</span>
                </Link>
              </li>
              {data.crmLastSyncedAt ? (
                <li className="px-4 py-3 text-xs text-muted">
                  סנכרון אחרון מ-Fireberry: {dateFormat.format(data.crmLastSyncedAt)}
                </li>
              ) : null}
            </ul>
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}
