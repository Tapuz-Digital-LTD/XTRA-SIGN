'use client'

import { useState } from 'react'
import type { ReportDefinition, SavedReport } from '@/server/reports/engine/types'
import { Dialog } from './Dialog'
import { api, btnPrimary, btnSecondary, fieldClass } from './shared'

/**
 * Keep the report under a name — for me, or for the whole team. Editing a
 * saved report offers both "עדכן" and "שמור כחדש".
 */
export function SaveReportDialog({ open, onClose, definition, existing, onSaved }: { open: boolean; onClose: () => void; definition: ReportDefinition; existing: SavedReport | null; onSaved: (report: SavedReport) => void }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [shared, setShared] = useState(existing?.shared ?? false)
  const [busy, setBusy] = useState<'update' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(mode: 'update' | 'create') {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('תנו לדוח שם.')
      return
    }
    setBusy(mode)
    setError(null)
    try {
      const { report } =
        mode === 'update' && existing
          ? await api<{ report: SavedReport }>(`/api/reports/saved/${existing.id}`, { name: trimmed, definition, shared }, 'PATCH')
          : await api<{ report: SavedReport }>('/api/reports/saved', { name: trimmed, definition, shared })
      onSaved(report)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'השמירה נכשלה.')
    } finally {
      setBusy(null)
    }
  }

  const canUpdate = Boolean(existing?.mine)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="שמירת הדוח"
      footer={
        <>
          <button type="button" onClick={onClose} className={btnSecondary}>
            ביטול
          </button>
          {canUpdate ? (
            <>
              <button type="button" onClick={() => void save('create')} disabled={busy !== null} className={btnSecondary} data-testid="save-as-new">
                {busy === 'create' ? 'שומר…' : 'שמור כחדש'}
              </button>
              <button type="button" onClick={() => void save('update')} disabled={busy !== null} className={btnPrimary}>
                {busy === 'update' ? 'מעדכן…' : 'עדכן'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void save('create')} disabled={busy !== null} className={btnPrimary}>
              {busy === 'create' ? 'שומר…' : 'שמירה'}
            </button>
          )}
        </>
      }
    >
      <p className="text-sm text-muted">הדוח יופיע ברשימת הדוחות ויפתח עם אותם תנאים ועמודות.</p>
      <label htmlFor="save-report-name" className="mt-3 block text-sm font-semibold text-fg">
        שם הדוח
      </label>
      <input
        id="save-report-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save(canUpdate ? 'update' : 'create')
          }
        }}
        maxLength={120}
        placeholder="למשל: ספקי תיירות שחתמו וטרם הוקמו"
        className={`${fieldClass} mt-1`}
      />
      <fieldset className="mt-3 flex flex-col gap-1">
        <legend className="text-sm font-semibold text-fg">מי רואה את הדוח</legend>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-bg">
          <input type="radio" name="save-report-shared" checked={!shared} onChange={() => setShared(false)} className="size-4" />
          אישי — רק אני
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-fg hover:bg-bg">
          <input type="radio" name="save-report-shared" checked={shared} onChange={() => setShared(true)} className="size-4" />
          משותף לצוות — יופיע גם במעקב
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
