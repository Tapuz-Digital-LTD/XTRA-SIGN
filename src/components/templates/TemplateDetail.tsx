'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DeleteDialog } from '@/components/deletion/DeleteDialog'
import { PdfPage } from '@/components/PdfPage'
import { TemplateUploadWizard } from '@/components/templates/TemplateUploadWizard'
import { ROLE_LABELS, type AgreementRole } from '@/lib/agreement-roles'

/**
 * One template: its pages with the placed fields drawn on them, its name
 * (editable in place), and the four things a person does with a template
 * — a new document from it, editing its fields, replacing the PDF through
 * the guided flow, and removing it.
 */

type Field = { id: string; page: number; x: number; y: number; width: number; height: number; label: string; type: string; role?: AgreementRole | null }

const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'

export function TemplateDetail({ id, name: initialName, pages, fields, isAdmin, usedBy }: { id: string; name: string; pages: { pageNumber: number; widthPt: number; heightPt: number }[]; fields: Field[]; isAdmin: boolean; usedBy: { id: string; name: string }[] }) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialName)
  const [replacing, setReplacing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function rename() {
    const next = draft.trim()
    if (!next || next === name) return setEditing(false)
    const r = await fetch(`/api/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: next }) })
    const data = await r.json().catch(() => null)
    if (!r.ok) return setMsg({ tone: 'error', text: data?.error?.message ?? 'שינוי השם נכשל.' })
    setName(next)
    setEditing(false)
    setMsg({ tone: 'ok', text: 'השם עודכן.' })
    router.refresh()
  }

  const mapped = fields.filter((f) => f.role).length
  const signatures = fields.filter((f) => f.type === 'signature').length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void rename()
              }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label="שם התבנית" className="h-11 min-w-64 rounded-lg border border-line bg-bg px-3 text-lg font-semibold text-fg outline-none focus:border-brand" />
              <button type="submit" className={primary}>שמירה</button>
              <button type="button" onClick={() => { setEditing(false); setDraft(name) }} className={secondary}>ביטול</button>
            </form>
          ) : (
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-fg">
              <span className="min-w-0 break-words">{name}</span>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:border-brand hover:text-fg" aria-label="שינוי שם">שינוי שם</button>
            </h1>
          )}
          <p className="mt-1 text-sm text-muted">
            {pages.length} עמודים · {fields.length} שדות · {mapped} ממולאים אוטומטית · {signatures === 1 ? 'חתימה אחת' : signatures > 1 ? `${signatures} חתימות` : 'ללא חתימה'}
            {usedBy.length ? ` · בשימוש ב-${usedBy.length} קמפיינים` : ''}
          </p>
          {usedBy.length ? (
            <p className="mt-1 flex flex-wrap gap-1 text-xs">
              {usedBy.map((g) => (
                <Link key={g.id} href={`/projects/${g.id}`} className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg hover:border-brand">{g.name}</Link>
              ))}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/documents/new?template=${id}`} className={primary}>מסמך חדש מהתבנית</Link>
          <Link href={`/templates/${id}/fields`} className={secondary}>עריכת שדות</Link>
          <button type="button" onClick={() => setReplacing((v) => !v)} className={secondary} aria-expanded={replacing}>החלפת PDF</button>
          <button type="button" onClick={() => setRemoving(true)} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-red-700 transition hover:border-red-400">מחיקה</button>
        </div>
      </div>

      {msg ? <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</p> : null}

      {replacing ? (
        <section className="rounded-[var(--radius-card)] border border-brand bg-surface p-5">
          <h2 className="text-base font-semibold text-fg">החלפת ה-PDF</h2>
          <p className="mt-1 text-sm text-muted">גרסה חדשה של המסמך. הקמפיינים שמשתמשים בתבנית עוברים אליה; מסמכים שכבר נשלחו נשארים כפי שהם.</p>
          <div className="mt-4">
            <TemplateUploadWizard mode="replace" replaceId={id} defaultName={name} />
          </div>
        </section>
      ) : null}

      {fields.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          לתבנית הזו אין עדיין שדות. בלי שדות אי אפשר למלא פרטים או לחתום — <Link href={`/templates/${id}/fields`} className="font-medium underline">הציבו שדות בעורך</Link>.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {pages.map((p) => (
          <PdfPage key={p.pageNumber} url={`/api/templates/${id}/file`} pageNumber={p.pageNumber} widthPt={p.widthPt} heightPt={p.heightPt} className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-sm">
            {fields.filter((f) => f.page === p.pageNumber).map((f) => (
              <span key={f.id} title={f.label} className="absolute rounded border border-dashed border-brand bg-brand/10" style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.width}%`, height: `${f.height}%` }}>
                <span className="absolute -top-3.5 start-0 whitespace-nowrap rounded bg-white px-1 text-[10px] leading-none text-brand">{f.role ? ROLE_LABELS[f.role] : f.label}</span>
              </span>
            ))}
          </PdfPage>
        ))}
      </div>

      <DeleteDialog
        type="template"
        id={id}
        noun="תבנית"
        isAdmin={isAdmin}
        open={removing}
        onClose={() => setRemoving(false)}
        onDone={(result) => {
          setRemoving(false)
          if (result.action === 'request' || result.action === 'restore') return setMsg({ tone: 'ok', text: result.message })
          router.push('/templates')
          router.refresh()
        }}
      />
    </div>
  )
}
