import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { ScrollRestore } from '@/components/nav/ScrollRestore'
import { AudienceTable } from '@/components/projects/AudienceTable'
import { getSession } from '@/server/auth/session'
import { listAudienceAll, type AudienceView } from '@/server/invitations/invitations'
import { listUsers } from '@/server/users/users'

/**
 * מעקב — everyone the organisation reached, from every campaign and every
 * direct send, in one table: who is waiting, who registered and did not
 * sign, who signed. Every row opens the same drawer as inside a campaign.
 */
export const dynamic = 'force-dynamic'

const VIEWS: AudienceView[] = ['all', 'invited', 'waiting', 'registered', 'signed']
const field = 'min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand'

export default async function TrackingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const query = await searchParams
  const view: AudienceView = VIEWS.includes(query.view as AudienceView) ? (query.view as AudienceView) : 'all'
  const groupId = query.campaign === 'direct' ? 'direct' : query.campaign && /^[0-9a-f-]{36}$/i.test(query.campaign) ? query.campaign : undefined
  const [result, users] = await Promise.all([
    listAudienceAll(session, { view, q: query.q, rep: query.rep, channel: query.channel, followUpDue: query.due === '1', groupId }),
    session.isAdmin ? listUsers(session).catch(() => []) : Promise.resolve([]),
  ])
  const extra: Record<string, string> = {}
  for (const key of ['campaign', 'rep', 'channel'] as const) if (query[key]) extra[key] = query[key]!

  return (
    <AppShell>
      <ScrollRestore />
      <h1 className="text-2xl font-bold tracking-tight text-fg">מעקב</h1>
      <p className="mt-1 text-sm text-muted">מצאו מי דורש טיפול, סננו את הנתונים ובצעו פעולות ישירות.</p>

      <form method="get" action="/tracking" className="mt-4 flex flex-wrap items-end gap-2">
        {view !== 'all' ? <input type="hidden" name="view" value={view} /> : null}
        {query.q ? <input type="hidden" name="q" value={query.q} /> : null}
        <label className="text-xs text-muted">
          קמפיין
          <select name="campaign" defaultValue={query.campaign ?? ''} className={`${field} mt-1 block`}>
            <option value="">הכול</option>
            <option value="direct">חתימה ישירה</option>
            {result.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {users.length > 0 ? (
          <label className="text-xs text-muted">
            נציג
            <select name="rep" defaultValue={query.rep ?? ''} className={`${field} mt-1 block`}>
              <option value="">כולם</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-xs text-muted">
          ערוץ
          <select name="channel" defaultValue={query.channel ?? ''} className={`${field} mt-1 block`}>
            <option value="">הכול</option>
            <option value="sms">SMS</option>
            <option value="email">אימייל</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-fg hover:border-brand">
          סינון
        </button>
      </form>
      <details className="mt-2 text-xs text-muted">
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-brand underline-offset-4 hover:underline">מה זה ״חתימה ישירה״?</summary>
        <p className="mt-1">מסמכים שנשלחו לחתימה מחוץ לקמפיין, כולל נמענים שעדיין אינם במאגר.</p>
      </details>

      <div className="mt-4">
        <AudienceTable projectId="" rows={result.rows} counts={result.counts} view={view} q={query.q ?? ''} askKind={false} dueToday={0} global basePath="/tracking" extraParams={extra} />
      </div>
    </AppShell>
  )
}
