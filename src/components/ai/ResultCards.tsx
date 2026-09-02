'use client'

import Link from 'next/link'

/**
 * Tool results as rows you can act on, not as a paragraph about them.
 *
 * A list of companies the assistant found is only useful if you can open one,
 * so every result that names a record renders as a link rather than as prose.
 */

type Row = Record<string, unknown>

const STATUS_TEXT: Record<string, string> = {
  draft: 'טיוטה',
  sent: 'נשלח',
  viewed: 'נצפה',
  signed: 'נחתם',
  declined: 'נדחה',
  expired: 'פג תוקף',
  cancelled: 'בוטל',
}

function Card({ href, title, meta }: { href?: string; title: string; meta: string[] }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{title}</span>
        {meta.length ? (
          <span className="block truncate text-xs text-muted">{meta.filter(Boolean).join(' · ')}</span>
        ) : null}
      </span>
      {href ? <span aria-hidden="true" className="shrink-0 text-muted">←</span> : null}
    </>
  )

  const className =
    'flex min-h-12 items-center gap-2 rounded-lg border border-line bg-surface px-3 transition hover:border-brand'

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function ResultCards({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null
  const payload = data as { kind?: string; rows?: Row[]; href?: string; label?: string }

  if (payload.kind === 'link' && payload.href) {
    return (
      <Link
        href={payload.href}
        className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90"
      >
        {payload.label ?? 'פתח'}
      </Link>
    )
  }

  const rows = payload.rows ?? []
  if (rows.length === 0) return null

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {rows.slice(0, 12).map((row, index) => {
        const href = typeof row.href === 'string' ? row.href : undefined

        if (payload.kind === 'companies') {
          return (
            <Card
              key={index}
              href={href}
              title={String(row.name ?? '')}
              meta={[
                row.companyKind === 'supplier' ? 'ספק' : 'לקוח',
                row.fromCrm ? 'CRM' : 'XTRA Sign',
                row.contactName ? String(row.contactName) : '',
                typeof row.pendingCount === 'number' && row.pendingCount > 0
                  ? `${row.pendingCount} ממתינים`
                  : '',
                row.readyToSend === false ? 'חסרים פרטים' : '',
              ]}
            />
          )
        }

        if (payload.kind === 'documents') {
          return (
            <Card
              key={index}
              href={href}
              title={String(row.title ?? '')}
              meta={[
                STATUS_TEXT[String(row.status)] ?? String(row.status ?? ''),
                row.companyName ? String(row.companyName) : '',
                row.recipientName ? String(row.recipientName) : '',
              ]}
            />
          )
        }

        if (payload.kind === 'groups') {
          return (
            <Card
              key={index}
              href={href}
              title={String(row.name ?? '')}
              meta={[`${row.companyCount ?? 0} חברות`]}
            />
          )
        }

        if (payload.kind === 'templates') {
          return (
            <Card
              key={index}
              href={href}
              title={String(row.name ?? '')}
              meta={[
                row.signatureCount === 1 ? 'חתימה אחת' : `${row.signatureCount ?? 0} חתימות`,
              ]}
            />
          )
        }

        return <Card key={index} href={href} title={String(row.name ?? row.title ?? '')} meta={[]} />
      })}

      {rows.length > 12 ? (
        <p className="text-xs text-muted">ועוד {rows.length - 12} תוצאות…</p>
      ) : null}
    </div>
  )
}
