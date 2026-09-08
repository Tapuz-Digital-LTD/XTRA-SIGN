'use client'

import { useState } from 'react'
import type { SavedReport } from '@/server/reports/engine/types'
import { Dialog } from './Dialog'
import { api, btnLink, btnPrimary, btnSecondary, fieldClass } from './shared'

const updatedAt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The reports people kept: mine, and the ones shared with the team. Open,
 * rename, duplicate, delete — the owner's ones can change, anyone can copy.
 */
export function SavedReportsList({ reports, currentId, onOpen, onChanged }: { reports: SavedReport[]; currentId: string | null; onOpen: (report: SavedReport) => void; onChanged: () => void }) {
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<SavedReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הפעולה נכשלה.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return
    if (await run(() => api(`/api/reports/saved/${renaming.id}`, { name: renaming.name.trim() }, 'PATCH'))) setRenaming(null)
  }
  const duplicate = (report: SavedReport) => run(() => api('/api/reports/saved', { name: `עותק של ${report.name}`.slice(0, 120), definition: report.definition, shared: false }))
  const remove = async () => {
    if (!deleting) return
    if (await run(() => api(`/api/reports/saved/${deleting.id}`, undefined, 'DELETE'))) setDeleting(null)
  }

  const sections: [string, SavedReport[]][] = [
    ['הדוחות שלי', reports.filter((r) => r.mine)],
    ['משותפים לצוות', reports.filter((r) => !r.mine)],
  ]

  if (reports.length === 0) return <p className="text-sm text-muted">עדיין לא נשמרו דוחות. אחרי ״הצג דוח״ לחצו ״שמור דוח״.</p>

  return (
    <div className="flex flex-col gap-4">
      {sections
        .filter(([, list]) => list.length > 0)
        .map(([title, list]) => (
          <div key={title}>
            <h3 className="text-xs font-semibold text-muted">{title}</h3>
            <ul className="mt-1 divide-y divide-line rounded-xl border border-line bg-surface">
              {list.map((report) => (
                <li key={report.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 ${report.id === currentId ? 'bg-blue-50/60' : ''}`}>
                  {renaming?.id === report.id ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <label htmlFor={`rename-${report.id}`} className="sr-only">
                        שם חדש
                      </label>
                      <input
                        id={`rename-${report.id}`}
                        type="text"
                        value={renaming.name}
                        autoFocus
                        maxLength={120}
                        onChange={(e) => setRenaming({ id: report.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className={fieldClass}
                      />
                      <button type="button" onClick={() => void rename()} disabled={busy} className={btnSecondary}>
                        שמירה
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} className={btnLink}>
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => onOpen(report)} className="min-w-0 flex-1 py-1 text-start">
                      <span className="block truncate text-sm font-medium text-fg">{report.name}</span>
                      <span className="block text-xs text-muted">
                        {report.ownerName ?? 'ללא שם'} · עודכן {updatedAt.format(new Date(report.updatedAt))}
                        {report.shared ? ' · משותף' : ''}
                      </span>
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    {report.mine ? (
                      <button type="button" onClick={() => setRenaming({ id: report.id, name: report.name })} className={btnLink}>
                        שינוי שם
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void duplicate(report)} disabled={busy} className={btnLink}>
                      שכפול
                    </button>
                    {report.mine ? (
                      <button type="button" onClick={() => setDeleting(report)} className={`${btnLink} text-danger`}>
                        מחיקה
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="מחיקת דוח שמור"
        footer={
          <>
            <button type="button" onClick={() => setDeleting(null)} className={btnSecondary}>
              ביטול
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy} className={`${btnPrimary} bg-danger`}>
              {busy ? 'מוחק…' : 'מחק'}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg">למחוק את ״{deleting?.name}״? הנתונים עצמם לא נמחקים — רק ההגדרה השמורה.</p>
      </Dialog>
    </div>
  )
}
