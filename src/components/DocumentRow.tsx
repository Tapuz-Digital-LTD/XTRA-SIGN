import { StatusBadge } from '@/components/StatusBadge'
import type { DocumentListItem } from '@/server/documents/queries'

/** Dates render on the server in a fixed locale so the markup is stable. */
const formatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

export function DocumentRow({ document: doc }: { document: DocumentListItem }) {
  const recipient = [doc.recipientName, doc.recipientCompany].filter(Boolean).join(' · ')

  return (
    <div className="flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{doc.title}</p>
        <p className="truncate text-xs text-muted">
          {recipient || 'טרם נבחר חותם'}
        </p>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <StatusBadge status={doc.status} />
        <time
          dateTime={(doc.sentAt ?? doc.createdAt).toISOString()}
          className="whitespace-nowrap text-xs text-muted"
        >
          {formatter.format(doc.sentAt ?? doc.createdAt)}
        </time>
      </div>
    </div>
  )
}
