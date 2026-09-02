'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/StatusBadge'
import { describeActivity } from '@/lib/relative-time'
import type { DocumentListItem } from '@/server/documents/queries'
import { RowActions } from './RowActions'

/** How the document came to exist, in the user's words. */
const SOURCE_TEXT: Record<string, string> = {
  composed: 'נכתב במערכת',
  uploaded: 'קובץ PDF',
  xtra_template: 'תבנית',
  crm_document: 'Fireberry',
}

/**
 * The document list.
 *
 * A table on a wide screen and a stack of cards on a narrow one — the same
 * rows, not a table squeezed into a horizontal scroller, because a phone
 * scrolling sideways to reveal the status column is how a document gets lost.
 */
export function DocumentsTable({ documents, now }: { documents: DocumentListItem[]; now: number }) {
  const router = useRouter()
  const open = (id: string) => router.push(`/documents/${id}`)
  const at = new Date(now)

  return (
    <>
      {/* Phone: one card per document, everything that matters visible at once. */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {documents.map((doc) => (
          <li key={doc.id} className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-start gap-2 p-3">
              <Link href={`/documents/${doc.id}`} className="min-w-0 flex-1 text-start">
                <span className="block truncate text-sm font-medium text-fg">{doc.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <CompanyChip doc={doc} />
                </span>
                <span className="mt-1 block truncate text-xs text-muted">
                  {doc.recipientName ? `נמען: ${doc.recipientName}` : 'טרם נבחר נמען'}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={doc.status} />
                  <span className="text-xs text-muted">{describeActivity(doc.lastActivityAt, doc.lastActivityType, at)}</span>
                </span>
              </Link>
              <RowActions
                documentId={doc.id}
                status={doc.status}
                companyId={doc.company?.id ?? null}
                hasCompany={Boolean(doc.company)}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface lg:block">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 text-start font-medium">מסמך</th>
              <th className="px-4 py-3 text-start font-medium">חברה</th>
              <th className="px-4 py-3 text-start font-medium">נמען</th>
              <th className="px-4 py-3 text-start font-medium">סטטוס</th>
              <th className="px-4 py-3 text-start font-medium">פעילות אחרונה</th>
              <th className="px-4 py-3 text-start font-medium">יוצר</th>
              <th className="w-px px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr
                key={doc.id}
                onClick={() => open(doc.id)}
                className="cursor-pointer border-b border-line last:border-0 transition hover:bg-bg"
              >
                <td className="max-w-[18rem] px-4 py-3">
                  {/* A real link, so the row can be focused, opened in a new
                      tab, and reached without a mouse. */}
                  <Link
                    href={`/documents/${doc.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium text-fg hover:underline"
                  >
                    {doc.title}
                  </Link>
                  <span className="block text-xs text-muted">
                    {[
                      doc.sourceKind ? SOURCE_TEXT[doc.sourceKind] : null,
                      doc.versionCount > 1 ? `גרסה ${doc.versionCount}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </td>
                <td className="max-w-[14rem] px-4 py-3">
                  <CompanyChip doc={doc} />
                </td>
                <td className="max-w-[12rem] px-4 py-3">
                  <span className="block truncate text-fg">{doc.recipientName ?? '—'}</span>
                  <span className="block truncate text-xs text-muted">
                    {doc.recipientPhone ?? doc.recipientEmail ?? ''}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={doc.status} />
                  {doc.hasSendFailure ? (
                    <span className="mt-1 block text-xs text-red-700">שליחה נכשלה</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {describeActivity(doc.lastActivityAt, doc.lastActivityType, at)}
                </td>
                <td className="max-w-[8rem] px-4 py-3">
                  <span className="block truncate text-muted">{doc.createdByName ?? '—'}</span>
                </td>
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    documentId={doc.id}
                    status={doc.status}
                    companyId={doc.company?.id ?? null}
                    hasCompany={Boolean(doc.company)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** The company, its kind, and where it came from — or an honest gap. */
function CompanyChip({ doc }: { doc: DocumentListItem }) {
  if (!doc.company) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        ללא שיוך
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate text-fg">{doc.company.name}</span>
      <span className="shrink-0 text-xs text-muted">{doc.company.kind === 'supplier' ? 'ספק' : 'לקוח'}</span>
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
          doc.company.fromCrm ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
        }`}
      >
        {doc.company.fromCrm ? 'CRM' : 'XTRA'}
      </span>
    </span>
  )
}
