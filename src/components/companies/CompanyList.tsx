'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CompanyForm } from '@/components/companies/CompanyForm'
import { AddToGroupButton } from '@/components/groups/AddToGroupButton'
import { NewGroupButton } from '@/components/groups/NewGroupButton'
import type { CompanyListItem } from '@/server/companies/companies'

const formatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

type LinkFilter = 'all' | 'crm' | 'local'

/**
 * One space (suppliers or customers): a searchable, dense table.
 *
 * Search is live — it filters name, ח.פ and contact as you type, no button or
 * Enter — over the rows already loaded. A filter separates CRM-linked records
 * (those with a Fireberry id) from ones that live only here, and a badge on
 * every row says which it is.
 */
export function CompanyList({
  companies,
  kind,
  noun,
  search,
  groups,
  activeGroup,
  crmEnabled,
}: {
  companies: CompanyListItem[]
  kind: 'supplier' | 'customer'
  noun: string
  /** The active server-side search term (from the URL). */
  search: string
  /** The groups for this kind, shown as filter chips. */
  groups: { id: string; name: string; companyCount: number }[]
  /** The group currently filtered on, from the URL. */
  activeGroup: string | null
  crmEnabled: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState(search)
  const [link, setLink] = useState<LinkFilter>('all')
  const [syncing, setSyncing] = useState(false)
  const [confirmSync, setConfirmSync] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const pluralNoun = noun === 'ספק' ? 'ספקים' : 'לקוחות'
  const basePath = kind === 'supplier' ? '/suppliers' : '/customers'

  // Debounced server-side search: the dataset is far larger than one page, so
  // filtering must happen in the query, not over the loaded rows. As-you-type,
  // no button, no Enter — the URL is pushed 300ms after the last keystroke.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const t = setTimeout(() => {
      const q = query.trim()
      router.push(q ? `${basePath}?q=${encodeURIComponent(q)}` : basePath)
    }, 300)
    return () => clearTimeout(t)
  }, [query, basePath, router])

  const filtered = useMemo(
    () =>
      companies.filter((c) => {
        if (link === 'crm' && !c.crmRecordId) return false
        if (link === 'local' && c.crmRecordId) return false
        return true
      }),
    [companies, link],
  )

  const crmCount = companies.filter((c) => c.crmRecordId).length

  async function sync() {
    setConfirmSync(false)
    setSyncing(true)
    setSyncMsg(null)
    setSyncError(null)
    try {
      const response = await fetch('/api/crm/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setSyncError(data?.error?.message ?? 'הסנכרון נכשל.')
        return
      }
      const c = data.counts
      let msg = `נוספו ${c.added} · עודכנו ${c.updated} · ללא שינוי ${c.unchanged}`
      if (c.failed > 0) msg += ` · נכשלו ${c.failed}`
      if (Array.isArray(data.errors) && data.errors.length > 0) msg += ` — ${data.errors.join(' ')}`
      setSyncMsg(msg)
      router.refresh()
    } catch {
      setSyncError('הסנכרון נכשל. בדקו את החיבור לאינטרנט.')
    } finally {
      setSyncing(false)
    }
  }

  const filters: { key: LinkFilter; label: string }[] = [
    { key: 'all', label: 'הכול' },
    { key: 'crm', label: 'CRM' },
    { key: 'local', label: 'XTRA Sign בלבד' },
  ]

  const allVisibleSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id))
  const selectedList = [...selected]

  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Selects exactly what is on screen after filtering — never rows the user
  // cannot see, which is how the wrong companies end up in a bulk action.
  const toggleAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current)
      if (allVisibleSelected) for (const c of filtered) next.delete(c.id)
      else for (const c of filtered) next.add(c.id)
      return next
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          <span aria-hidden="true" className="me-1">+</span>
          {`הוספת ${noun}`}
        </button>

        {crmEnabled ? (
          <button
            type="button"
            onClick={() => setConfirmSync(true)}
            disabled={syncing}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? 'מסנכרן…' : '↻ סנכרון מ-Fireberry'}
          </button>
        ) : null}

        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">⌕</span>
          <label htmlFor="company-search" className="sr-only">{`חיפוש ${pluralNoun}`}</label>
          <input
            id="company-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם, ח.פ או איש קשר"
            className="min-h-11 w-full rounded-lg border border-line bg-surface pe-9 ps-3 text-sm"
          />
        </div>
      </div>

      {confirmSync ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmSync(false)}>
          <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-fg">להתחיל סנכרון מ-Fireberry?</h2>
            <p className="mt-2 text-sm text-muted">
              ייובאו {pluralNoun} חדשים ומעודכנים מה-CRM. הפעולה מייבאת רק את מה שהשתנה מאז הסנכרון האחרון.
            </p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={sync} className="min-h-11 flex-1 rounded-lg bg-brand text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]">
                כן, התחל סנכרון
              </button>
              <button type="button" onClick={() => setConfirmSync(false)} className="min-h-11 flex-1 rounded-lg border border-line bg-white text-sm text-fg hover:bg-slate-50">
                לא
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {syncMsg ? (
        <p role="status" className="rounded-lg border border-line bg-surface p-3 text-sm text-fg">{syncMsg}</p>
      ) : null}
      {syncError ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-red-50 p-3 text-sm text-danger">{syncError}</p>
      ) : null}

      {adding ? (
        <CompanyForm kind={kind} noun={noun} crmAvailable={crmEnabled} onCancel={() => setAdding(false)} onDone={() => setAdding(false)} />
      ) : null}

      {groups.length > 0 ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="סינון לפי קבוצה">
          {/* Horizontal and scrollable: a long list of groups must not push the
              table off the screen, and on a phone this is a natural swipe. */}
          <Link
            href={`/${kind === 'supplier' ? 'suppliers' : 'customers'}${search ? `?q=${encodeURIComponent(search)}` : ''}`}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm transition-colors ${
              activeGroup ? 'bg-surface text-muted hover:text-fg' : 'bg-brand text-white'
            }`}
          >
            הכול
          </Link>
          {groups.map((group) => {
            const params = new URLSearchParams()
            if (search) params.set('q', search)
            params.set('group', group.id)
            return (
              <Link
                key={group.id}
                href={`/${kind === 'supplier' ? 'suppliers' : 'customers'}?${params}`}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm transition-colors ${
                  activeGroup === group.id ? 'bg-brand text-white' : 'bg-surface text-muted hover:text-fg'
                }`}
              >
                <span className="max-w-40 truncate">{group.name}</span>
                <span className={`text-xs tabular-nums ${activeGroup === group.id ? 'text-white/80' : 'text-muted'}`}>
                  {group.companyCount}
                </span>
              </Link>
            )
          })}
        </div>
      ) : null}

      {crmCount > 0 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="סינון לפי מקור">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={link === f.key}
              onClick={() => setLink(f.key)}
              className={`inline-flex min-h-9 items-center rounded-lg px-3 text-sm transition-colors ${
                link === f.key ? 'bg-brand text-white' : 'text-muted hover:bg-slate-100 hover:text-fg'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-brand bg-blue-50 px-4 py-3">
          <span className="text-sm font-semibold text-fg">נבחרו {selected.size}</span>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-brand underline-offset-4 hover:underline">
            ניקוי הבחירה
          </button>
          <span className="ms-auto flex flex-wrap gap-2">
            <AddToGroupButton companyIds={selectedList} onDone={() => setSelected(new Set())} />
            <NewGroupButton companyIds={selectedList} label="צור קבוצה מהבחירה" defaultKind={kind} />
            <a
              href={`/api/companies/export?ids=${selectedList.join(',')}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-fg transition hover:border-brand"
            >
              ייצוא ל-Excel
            </a>
          </span>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-fg">
            {search.trim() || link !== 'all' ? `לא נמצאו ${pluralNoun} מתאימים` : `עדיין אין ${pluralNoun}`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {search.trim()
              ? 'נסו חיפוש אחר, או נקו את הסינון.'
              : link !== 'all'
                ? 'שנו את הסינון למעלה.'
                : `הוסיפו ${noun} ראשון${crmEnabled ? ', או סנכרנו מ-Fireberry' : ''}, ואז צרו עבורו מסמך.`}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
          <table className="w-full min-w-[44rem] table-fixed text-start text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="w-px px-3 py-3">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label={`בחירת כל ${filtered.length} השורות המוצגות`}
                  />
                </th>
                <th className="w-[26%] px-4 py-3 text-start font-medium">{noun === 'ספק' ? 'ספק' : 'לקוח'}</th>
                <th className="w-[13%] px-4 py-3 text-start font-medium">ח.פ / ע.מ</th>
                <th className="w-[20%] px-4 py-3 text-start font-medium">איש קשר</th>
                <th className="w-[9%] px-3 py-3 text-center font-medium">מסמכים</th>
                <th className="w-[9%] px-3 py-3 text-center font-medium">ממתינים</th>
                <th className="w-[10%] px-4 py-3 text-start font-medium">מקור</th>
                <th className="w-[13%] px-4 py-3 text-start font-medium">פעילות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => router.push(`/companies/${company.id}`)}
                  className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-bg"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.has(company.id)}
                      onChange={() => toggleOne(company.id)}
                      aria-label={`בחירת ${company.name}`}
                    />
                  </td>
                  {/* Each cell clips its own text: in a fixed-layout table an
                      unclipped long name spills over the next column. */}
                  <td className="truncate px-4 py-3 font-medium text-fg" title={company.name}>{company.name}</td>
                  <td className="truncate px-4 py-3 text-muted" dir="ltr">{company.taxId ?? '—'}</td>
                  <td className="truncate px-4 py-3 text-muted">{company.contactName ?? '—'}</td>
                  <td className="px-3 py-3 text-center text-fg">{company.documentCount}</td>
                  <td className="px-3 py-3 text-center">
                    {company.pendingCount > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{company.pendingCount}</span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {company.crmRecordId ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">CRM</span>
                    ) : (
                      <span className="inline-block max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">XTRA Sign</span>
                    )}
                  </td>
                  <td className="truncate px-4 py-3 text-xs text-muted">
                    {company.lastActivityAt ? formatter.format(company.lastActivityAt) : '—'}
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
