'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { GroupCompany } from '@/server/groups/groups'
import { BulkSendDialog } from './BulkSendDialog'
import { AddCompaniesDialog } from './AddCompaniesDialog'
import { ExcelImportDialog } from './ExcelImportDialog'

/**
 * A project as a place to work: pick suppliers, then act on the picked ones.
 *
 * Selection state is deliberate about "select all" — it selects exactly the
 * rows currently visible after searching, and says so, because a checkbox that
 * silently includes rows you cannot see is how the wrong 500 companies get an
 * agreement.
 */

/** The last word on each supplier, in the user's language. */
const SEND_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: 'טיוטה', className: 'bg-slate-100 text-slate-700' },
  pending: { label: 'בשליחה', className: 'bg-slate-100 text-slate-700' },
  sent: { label: 'ממתין לחתימה', className: 'bg-amber-100 text-amber-900' },
  viewed: { label: 'נצפה', className: 'bg-blue-100 text-blue-800' },
  signed: { label: 'נחתם', className: 'bg-green-100 text-green-800' },
  declined: { label: 'נדחה', className: 'bg-red-100 text-red-800' },
  expired: { label: 'פג תוקף', className: 'bg-red-100 text-red-800' },
  canceled: { label: 'בוטל', className: 'bg-slate-100 text-slate-700' },
  failed: { label: 'נכשל', className: 'bg-red-100 text-red-800' },
  skipped: { label: 'לא נשלח', className: 'bg-slate-100 text-slate-700' },
}

function StatusChip({ company }: { company: GroupCompany }) {
  if (!company.lastSend) {
    return company.readyToSend ? (
      <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
        טרם נשלח
      </span>
    ) : (
      <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        חסרים פרטי נמען
      </span>
    )
  }
  const spec = SEND_STATUS[company.lastSend.status] ?? {
    label: company.lastSend.status,
    className: 'bg-slate-100 text-slate-700',
  }
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${spec.className}`}>
      {spec.label}
    </span>
  )
}

export function GroupWorkspace({
  groupId,
  groupName,
  companies,
  templates,
  search,
}: {
  groupId: string
  groupName: string
  companies: GroupCompany[]
  templates: { id: string; name: string; signatureCount: number }[]
  search: string
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState(search)
  const [busy, setBusy] = useState(false)

  const allVisibleSelected = companies.length > 0 && companies.every((c) => selected.has(c.id))
  const selectedList = useMemo(() => [...selected], [selected])

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current)
      if (allVisibleSelected) for (const c of companies) next.delete(c.id)
      else for (const c of companies) next.add(c.id)
      return next
    })
  }

  async function removeSelected() {
    if (!window.confirm(`להוציא ${selected.size} ספקים מהפרויקט? החברות עצמן לא יימחקו.`)) return
    setBusy(true)
    try {
      await fetch(`/api/groups/${groupId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', companyIds: selectedList }),
      })
      setSelected(new Set())
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  /** The one right action for a row: watch the agreement, or send one. */
  function rowAction(company: GroupCompany) {
    if (company.lastSend?.agreementId) {
      return (
        <Link
          href={`/documents/${company.lastSend.agreementId}`}
          className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand"
        >
          צפייה בהסכם
        </Link>
      )
    }
    return (
      <BulkSendDialog
        groupId={groupId}
        groupName={groupName}
        templates={templates}
        restrictTo={[company.id]}
        label="שליחת הסכם"
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <AddCompaniesDialog groupId={groupId} />
        <ExcelImportDialog groupId={groupId} groupName={groupName} />
        <a
          href={`/api/companies/export?group=${groupId}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
        >
          ייצוא ל-Excel
        </a>
        <BulkSendDialog groupId={groupId} groupName={groupName} templates={templates} variant="primary" />

        <form
          onSubmit={(e) => {
            e.preventDefault()
            router.push(`/projects/${groupId}${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
          }}
          className="ms-auto flex min-w-0 flex-1 gap-2 sm:max-w-xs"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש בפרויקט"
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </form>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-blue-50 px-4 py-3">
          <span className="text-sm font-semibold text-fg">נבחרו {selected.size}</span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-brand underline-offset-4 hover:underline"
          >
            ניקוי הבחירה
          </button>
          <span className="ms-auto flex flex-wrap gap-2">
            {/* Sending to the ticked rows — one supplier or forty — rather than
                to the whole project. The project is a way to organise, not a
                commitment to write to everyone in it. */}
            <BulkSendDialog
              key={selectedList.join(',')}
              groupId={groupId}
              groupName={groupName}
              templates={templates}
              restrictTo={selectedList}
              variant="primary"
              label={selected.size === 1 ? 'שליחה לנבחר' : `שליחה ל-${selected.size} הנבחרים`}
            />
            <a
              href={`/api/companies/export?ids=${selectedList.join(',')}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-fg transition hover:border-brand"
            >
              ייצוא הנבחרים
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void removeSelected()}
              className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-red-700 transition hover:border-red-400 disabled:opacity-50"
            >
              הוצאה מהפרויקט
            </button>
          </span>
        </div>
      ) : null}

      {companies.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-fg">{search ? 'לא נמצאו ספקים מתאימים' : 'אין ספקים בפרויקט עדיין'}</p>
          <p className="mt-1 text-sm text-muted">
            {search
              ? 'נסו חיפוש אחר.'
              : 'מוסיפים ספקים קיימים, מייבאים רשימה מ-Excel, או מפעילים טופס הצטרפות בלשונית ההגדרות.'}
          </p>
        </div>
      ) : (
        <>
          {/* Phones get cards; a seven-column table on 375px is not a screen. */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {companies.map((company) => (
              <li key={company.id} className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={selected.has(company.id)}
                      onChange={() => toggle(company.id)}
                      aria-label={`בחירת ${company.name}`}
                    />
                    <span className="min-w-0">
                      <Link href={`/companies/${company.id}`} className="block truncate font-medium text-fg hover:underline">
                        {company.name}
                      </Link>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {[company.contactName, company.contactPhone].filter(Boolean).join(' · ') || 'אין פרטי איש קשר'}
                      </span>
                    </span>
                  </label>
                  <StatusChip company={company} />
                </div>
                <div className="mt-3 flex justify-end">{rowAction(company)}</div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface sm:block">
            <table className="w-full min-w-[52rem] table-fixed text-start text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="w-px px-3 py-3">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label={search ? 'בחירת כל התוצאות המוצגות' : 'בחירת כל הספקים'}
                    />
                  </th>
                  <th className="w-[24%] px-4 py-3 text-start font-medium">ספק</th>
                  <th className="w-[15%] px-4 py-3 text-start font-medium">איש קשר</th>
                  <th className="w-[13%] px-4 py-3 text-start font-medium">טלפון</th>
                  <th className="w-[20%] px-4 py-3 text-start font-medium">אימייל</th>
                  <th className="w-[14%] px-4 py-3 text-start font-medium">סטטוס הסכם</th>
                  <th className="w-[14%] px-4 py-3 text-start font-medium">פעולה</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id} className="border-b border-line last:border-0 hover:bg-bg">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={selected.has(company.id)}
                        onChange={() => toggle(company.id)}
                        aria-label={`בחירת ${company.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/companies/${company.id}`} className="block truncate font-medium text-fg hover:underline">
                        {company.name}
                      </Link>
                      <span className="block truncate text-xs text-muted">{company.fromCrm ? 'CRM' : 'XTRA Sign'}</span>
                    </td>
                    <td className="px-4 py-3"><span className="block truncate">{company.contactName ?? '—'}</span></td>
                    <td className="truncate px-4 py-3" dir="ltr">{company.contactPhone ?? '—'}</td>
                    <td className="px-4 py-3" dir="ltr"><span className="block truncate">{company.contactEmail ?? '—'}</span></td>
                    <td className="px-4 py-3">
                      <StatusChip company={company} />
                    </td>
                    <td className="px-4 py-3">{rowAction(company)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
