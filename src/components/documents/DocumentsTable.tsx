'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { StatusBadge } from '@/components/StatusBadge'
import { describeActivity } from '@/lib/relative-time'
import type { DocumentListItem } from '@/server/documents/queries'
import { AttentionAction, AttentionDrawer, SEVERITY_CLASS } from './AttentionDrawer'
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
 *
 * A row that needs a person says what happened under its status, in words,
 * with the one button that fixes it. The status itself never changes for a
 * failed message: "נחתם" stays "נחתם".
 */
export function DocumentsTable({
  documents,
  now,
  isAdmin = false,
  selectable = false,
}: {
  documents: DocumentListItem[]
  now: number
  isAdmin?: boolean
  /** The attention tab: checkboxes and the bulk resend bar. */
  selectable?: boolean
}) {
  const router = useRouter()
  const open = (id: string) => router.push(`/documents/${id}`)
  const at = new Date(now)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const drawerDoc = documents.find((d) => d.id === drawerId) ?? null

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allSelected = documents.length > 0 && documents.every((d) => selected.has(d.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(documents.map((d) => d.id)))
  const rowClick = (doc: DocumentListItem) => (doc.attention ? setDrawerId(doc.id) : open(doc.id))

  const checkbox = (doc: DocumentListItem) => (
    <input
      type="checkbox"
      aria-label={`בחירת ${doc.title}`}
      checked={selected.has(doc.id)}
      onChange={() => toggle(doc.id)}
      onClick={(e) => e.stopPropagation()}
      className="size-5 shrink-0 accent-[var(--color-brand)]"
    />
  )

  return (
    <>
      {selectable ? <BulkResendBar documents={documents} selected={selected} onToggleAll={toggleAll} allSelected={allSelected} /> : null}

      {/* Phone: one card per document, everything that matters visible at once. */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {documents.map((doc) => (
          <li key={doc.id} className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-start gap-2 p-3">
              {selectable ? <span className="pt-1">{checkbox(doc)}</span> : null}
              <div className="min-w-0 flex-1">
                <Link href={`/documents/${doc.id}`} className="block text-start">
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
                {doc.attention ? (
                  <div className="mt-2 flex flex-col items-start gap-2">
                    <button type="button" onClick={() => setDrawerId(doc.id)} className={`text-start text-xs font-semibold underline-offset-2 hover:underline ${SEVERITY_CLASS[doc.attention.severity]}`}>
                      {doc.attention.title}
                    </button>
                    <AttentionAction doc={doc} reason={doc.attention} minHeight="min-h-11" />
                  </div>
                ) : null}
              </div>
              <RowActions
                isAdmin={isAdmin}
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
        {/* `table-fixed` plus explicit widths is what makes `truncate` work.
            Under the default auto layout a long name grows its column instead
            of being clipped, and pushes the next one over its neighbour. */}
        <table className="w-full table-fixed text-start text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              {selectable ? (
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" aria-label="בחירת הכול" checked={allSelected} onChange={toggleAll} className="size-5 accent-[var(--color-brand)]" />
                </th>
              ) : null}
              <th className="w-[20%] px-4 py-3 text-start font-medium">מסמך</th>
              <th className="w-[18%] px-4 py-3 text-start font-medium">חברה</th>
              <th className="w-[16%] px-4 py-3 text-start font-medium">נמען</th>
              <th className="w-[24%] px-4 py-3 text-start font-medium">סטטוס</th>
              <th className="w-[13%] px-4 py-3 text-start font-medium">פעילות אחרונה</th>
              <th className="w-[9%] px-4 py-3 text-start font-medium">יוצר</th>
              <th className="sticky end-0 w-14 bg-surface px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr
                key={doc.id}
                onClick={() => rowClick(doc)}
                className="cursor-pointer border-b border-line last:border-0 transition hover:bg-bg"
              >
                {selectable ? (
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    {checkbox(doc)}
                  </td>
                ) : null}
                <td className="px-4 py-3 align-top">
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
                <td className="px-4 py-3 align-top">
                  <CompanyChip doc={doc} />
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="block truncate text-fg">{doc.recipientName ?? '—'}</span>
                  <span className="block truncate text-xs text-muted">
                    {doc.recipientPhone ?? doc.recipientEmail ?? ''}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <StatusBadge status={doc.status} />
                  {doc.attention ? (
                    <div className="mt-1.5 flex flex-col items-start gap-1.5">
                      <span className={`block text-xs font-semibold ${SEVERITY_CLASS[doc.attention.severity]}`}>{doc.attention.title}</span>
                      <AttentionAction doc={doc} reason={doc.attention} />
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 align-top text-muted">
                  <span className="block truncate">
                    {describeActivity(doc.lastActivityAt, doc.lastActivityType, at)}
                  </span>
                </td>
                <td className="px-4 py-3 align-top">
                  <span className="block truncate text-muted">{doc.createdByName ?? '—'}</span>
                </td>
                <td className="sticky end-0 bg-surface px-2 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    isAdmin={isAdmin}
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

      <AttentionDrawer key={drawerId ?? 'closed'} doc={drawerDoc} open={drawerDoc !== null} onClose={() => setDrawerId(null)} />
    </>
  )
}

/**
 * "שלח שוב הודעות שנכשלו": preview first — how many of the chosen rows can
 * actually go out as they are — then the sends, then the tally.
 */
function BulkResendBar({ documents, selected, allSelected, onToggleAll }: { documents: DocumentListItem[]; selected: Set<string>; allSelected: boolean; onToggleAll: () => void }) {
  const router = useRouter()
  const [stage, setStage] = useState<'idle' | 'previewing' | 'confirm' | 'sending' | 'done'>('idle')
  const [preview, setPreview] = useState<{ eligible: number; skipped: { agreementId: string; why: string }[] } | null>(null)
  const [result, setResult] = useState<{ sent: number; failed: number; skipped: { agreementId: string; why: string }[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = [...selected]
  const titleOf = (id: string) => documents.find((d) => d.id === id)?.title ?? id

  async function call(previewOnly: boolean) {
    const response = await fetch('/api/documents/bulk/resend-failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agreementIds: ids, preview: previewOnly }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.error?.message ?? 'הפעולה נכשלה.')
    return data
  }

  async function previewNow() {
    setStage('previewing')
    setError(null)
    try {
      setPreview(await call(true))
      setStage('confirm')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה.')
      setStage('idle')
    }
  }

  async function apply() {
    setStage('sending')
    setError(null)
    try {
      setResult(await call(false))
      setStage('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה.')
      setStage('confirm')
    }
  }

  const reset = () => {
    setStage('idle')
    setPreview(null)
    setResult(null)
  }

  const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
  const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm text-fg transition hover:bg-bg disabled:opacity-50'

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
      <label className="flex items-center gap-2 text-sm text-fg lg:hidden">
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="size-5 accent-[var(--color-brand)]" />
        בחירת הכול
      </label>
      <span className="text-sm text-muted">נבחרו {ids.length} מתוך {documents.length}</span>

      {stage === 'idle' || stage === 'previewing' ? (
        <button type="button" disabled={ids.length === 0 || stage === 'previewing'} onClick={() => void previewNow()} className={primary}>
          {stage === 'previewing' ? 'בודק…' : `שלח שוב הודעות שנכשלו (${ids.length})`}
        </button>
      ) : null}

      {(stage === 'confirm' || stage === 'sending') && preview ? (
        <>
          <span className="text-sm font-medium text-fg">
            ניתן לשלוח שוב ל-{preview.eligible} מתוך {ids.length}
          </span>
          <button type="button" disabled={stage === 'sending' || preview.eligible === 0} onClick={() => void apply()} className={primary}>
            {stage === 'sending' ? 'שולח…' : 'אישור ושליחה'}
          </button>
          <button type="button" disabled={stage === 'sending'} onClick={reset} className={secondary}>
            ביטול
          </button>
          {preview.skipped.length > 0 ? (
            <details className="basis-full text-xs text-muted">
              <summary className="cursor-pointer">למה לא כולם? ({preview.skipped.length})</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {preview.skipped.map((s) => (
                  <li key={s.agreementId}>
                    <span className="text-fg">{titleOf(s.agreementId)}</span> — {s.why}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {stage === 'done' && result ? (
        <>
          <span role="status" className="text-sm font-medium text-fg">
            נשלחו {result.sent} · נכשלו {result.failed} · דולגו {result.skipped.length}
          </span>
          <button type="button" onClick={reset} className={secondary}>
            סגירה
          </button>
        </>
      ) : null}

      {error ? (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  )
}

/** The company, its kind, and where it came from — or an honest gap. */
function CompanyChip({ doc }: { doc: DocumentListItem }) {
  if (!doc.company) {
    return (
      <span className="inline-flex max-w-full items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        ללא שיוך
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-fg">{doc.company.name}</span>
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
