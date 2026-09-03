import { FolderPlus, Send } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { getSession } from '@/server/auth/session'
import { getDashboardOverview } from '@/server/dashboard/overview'

/**
 * Home: two things you can do, four numbers that matter, and what happened
 * lately. Deliberately not a BI dashboard — every tile links into the screen
 * that can act on it.
 */

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Audit event names in the words the screen uses. */
const ACTIVITY_TEXT: Record<string, string> = {
  sent: 'נשלח',
  viewed: 'נצפה',
  completed: 'נחתם',
  canceled: 'בוטל',
  reminder_sent: 'נשלחה תזכורת',
}

function Counter({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link
      href={href}
      className="flex min-h-24 flex-col justify-between rounded-xl border border-line bg-surface p-4 transition hover:border-brand hover:shadow-sm"
    >
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className="mt-2 text-3xl font-bold tabular-nums leading-none text-fg">{value}</span>
    </Link>
  )
}

export default async function HomePage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const data = await getDashboardOverview(session)

  return (
    <AppShell>
      <h1 className="text-2xl font-bold tracking-tight text-fg">שלום, {session.name.split(' ')[0]}</h1>

      {/* The two things this system exists for. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link
          href="/documents/new"
          className="flex min-h-20 items-center justify-center gap-3 rounded-xl bg-brand px-6 text-lg font-semibold text-white transition hover:opacity-90"
        >
          <Send aria-hidden="true" className="size-5 -scale-x-100" />
          שלח מסמך לחתימה
        </Link>
        <Link
          href="/projects?new=1"
          className="flex min-h-20 items-center justify-center gap-3 rounded-xl border-2 border-line bg-surface px-6 text-lg font-semibold text-fg transition hover:border-brand"
        >
          <FolderPlus aria-hidden="true" className="size-5" />
          פרויקט חדש
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Counter href="/agreements?filter=pending" label="ממתינים לחתימה" value={data.counts.pending} />
        <Counter href="/projects" label="לידים חדשים" value={data.newLeads} />
        <Counter href="/agreements?filter=pending" label="עומדים לפוג" value={data.expiringSoon} />
        <Counter href="/agreements?filter=attention" label="דורשים טיפול" value={data.attentionCount} />
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4">
          <h2 className="text-sm font-semibold text-fg">פעילות אחרונה</h2>
          <Link href="/agreements" className="text-xs font-medium text-brand hover:underline">
            לכל ההסכמים
          </Link>
        </div>
        {data.recentActivity.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            עדיין אין פעילות. שליחת המסמך הראשון לחתימה תופיע כאן.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recentActivity.map((item, index) => (
              <li key={`${item.agreementId}-${index}`}>
                <Link
                  href={`/documents/${item.agreementId}`}
                  className="flex min-h-14 flex-col justify-center px-4 py-2.5 transition hover:bg-bg"
                >
                  <span className="truncate text-sm text-fg">
                    {ACTIVITY_TEXT[item.type] ?? item.type} — {item.title}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {[item.companyName, dateFormat.format(item.at)].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}
