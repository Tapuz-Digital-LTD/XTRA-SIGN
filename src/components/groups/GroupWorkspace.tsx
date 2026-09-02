'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { GroupCompany } from '@/server/groups/groups'
import { BulkSendDialog } from './BulkSendDialog'
import { AddCompaniesDialog } from './AddCompaniesDialog'
import { ExcelImportDialog } from './ExcelImportDialog'

/**
 * A group as a place to work: pick companies, then act on the picked ones.
 *
 * Selection state is deliberate about "select all" — it selects exactly the
 * rows currently visible after searching, and says so, because a checkbox that
 * silently includes rows you cannot see is how the wrong 500 companies get an
 * agreement.
 */
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
    if (!window.confirm(`להוציא ${selected.size} חברות מהקבוצה? החברות עצמן לא יימחקו.`)) return
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
        <BulkSendDialog groupId={groupId} groupName={groupName} templates={templates} />

        <form
          onSubmit={(e) => {
            e.preventDefault()
            router.push(`/groups/${groupId}${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
          }}
          className="ms-auto flex min-w-0 flex-1 gap-2 sm:max-w-xs"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש בקבוצה"
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
            {/* Sending to the ticked rows — one company or forty — rather than
                to the whole group. The group is a way to organise, not a
                commitment to write to everyone in it. */}
            <BulkSendDialog
              key={selectedList.join(',')}
              groupId={groupId}
              groupName={groupName}
              templates={templates}
              restrictTo={selectedList}
              variant="primary"
              label={selected.size === 1 ? 'שליחה לנבחרת' : `שליחה ל-${selected.size} הנבחרות`}
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
              הוצאה מהקבוצה
            </button>
          </span>
        </div>
      ) : null}

      {companies.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-fg">{search ? 'לא נמצאו חברות מתאימות' : 'הקבוצה ריקה'}</p>
          <p className="mt-1 text-sm text-muted">
            {search ? 'נסו חיפוש אחר.' : 'הוסיפו חברות קיימות, או ייבאו רשימה מ-Excel.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[48rem] table-fixed text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="w-px px-3 py-3">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label={search ? 'בחירת כל התוצאות המוצגות' : 'בחירת כל החברות'}
                  />
                </th>
                <th className="w-[26%] px-4 py-3 text-start font-medium">חברה</th>
                <th className="w-[8%] px-4 py-3 text-start font-medium">סוג</th>
                <th className="w-[16%] px-4 py-3 text-start font-medium">איש קשר</th>
                <th className="w-[16%] px-4 py-3 text-start font-medium">טלפון</th>
                <th className="w-[22%] px-4 py-3 text-start font-medium">אימייל</th>
                <th className="w-[12%] px-4 py-3 text-start font-medium">מוכנה לשליחה</th>
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
                  <td className="truncate px-4 py-3 text-muted">{company.kind === 'supplier' ? 'ספק' : 'לקוח'}</td>
                  <td className="px-4 py-3"><span className="block truncate">{company.contactName ?? '—'}</span></td>
                  <td className="truncate px-4 py-3" dir="ltr">{company.contactPhone ?? '—'}</td>
                  <td className="px-4 py-3" dir="ltr"><span className="block truncate">{company.contactEmail ?? '—'}</span></td>
                  <td className="px-4 py-3">
                    {company.readyToSend ? (
                      <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">מוכנה</span>
                    ) : (
                      <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">חסר נמען</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
