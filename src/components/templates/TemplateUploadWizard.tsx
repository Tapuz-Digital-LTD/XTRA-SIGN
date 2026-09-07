'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { AGREEMENT_ROLES, ROLE_LABELS, missingRoles, type AgreementRole } from '@/lib/agreement-roles'
import { PdfPage } from '@/components/PdfPage'

/**
 * A PDF becomes a template in four plain steps: upload, tell the system
 * which detail goes in each field it found, look at the pages, and switch
 * it on. In "replace" mode the last step also moves every campaign that
 * used the old template onto the new one; documents already sent keep
 * their own copy. When the PDF has no fillable fields, the wizard says so
 * and hands over to the field editor instead of leaving a blank page.
 */

type Detected = { id: string; name: string; type: string; page: number; suggestion: string | null }
type Layout = { pages: { pageNumber: number; widthPt: number; heightPt: number }[]; fields: { id: string; page: number; x: number; y: number; width: number; height: number; label: string; type: string }[] }

const STEPS = [
  { key: 'upload', label: 'העלאת PDF' },
  { key: 'map', label: 'זיהוי שדות ומיפוי' },
  { key: 'preview', label: 'תצוגה מקדימה' },
  { key: 'activate', label: 'אישור והפעלה' },
] as const
type Step = (typeof STEPS)[number]['key']

const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'

export function TemplateUploadWizard({ mode, replaceId, defaultName = '' }: { mode: 'new' | 'replace'; replaceId?: string; defaultName?: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [detected, setDetected] = useState<Detected[]>([])
  const [roles, setRoles] = useState<Record<string, AgreementRole | ''>>({})
  const [layout, setLayout] = useState<Layout | null>(null)
  const [rebound, setRebound] = useState<number | null>(null)

  async function upload() {
    if (!file || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('name', name.trim())
      const r = await fetch('/api/templates/from-pdf', { method: 'POST', body: form })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setError(data?.error?.message ?? 'ההעלאה נכשלה.')
        return
      }
      setTemplateId(data.templateId)
      const fields: Detected[] = data.fields ?? []
      setDetected(fields)
      setRoles(Object.fromEntries(fields.map((f) => [f.id, (f.suggestion as AgreementRole | null) ?? ''])))
      setStep('map')
    } catch {
      setError('ההעלאה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  async function saveRoles() {
    if (!templateId) return
    setBusy(true)
    setError(null)
    try {
      if (detected.length > 0) {
        const r = await fetch(`/api/templates/${templateId}/roles`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v || null])) }) })
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          setError(data?.error?.message ?? 'השמירה נכשלה.')
          return
        }
      }
      const l = await fetch(`/api/templates/${templateId}/layout`)
      const ld = await l.json().catch(() => null)
      if (!l.ok) {
        setError(ld?.error?.message ?? 'לא הצלחנו להכין תצוגה מקדימה.')
        return
      }
      setLayout({ pages: ld.pages, fields: ld.fields })
      setStep('preview')
    } catch {
      setError('השמירה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  async function activate() {
    if (!templateId) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'replace' && replaceId) {
        const r = await fetch(`/api/templates/${replaceId}/replace`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newTemplateId: templateId }) })
        const data = await r.json().catch(() => null)
        if (!r.ok) {
          setError(data?.error?.message ?? 'ההחלפה נכשלה.')
          return
        }
        setRebound(data.rebound ?? 0)
      }
      router.push(`/templates/${templateId}`)
      router.refresh()
    } catch {
      setError('הפעולה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  const missing = missingRoles(Object.values(roles).map((r) => r || null)).filter((m) => m.required)
  const stepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="שלבים">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === stepIndex ? 'font-semibold text-brand' : i < stepIndex ? 'text-fg' : 'text-muted'} aria-current={i === stepIndex ? 'step' : undefined}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">בוחרים את קובץ ה-PDF ונותנים לתבנית שם.</p>
          <label className="block text-sm">
            <span className="text-muted">שם התבנית</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: הסכם ספק 2027" className={input} />
          </label>
          <div
            className={`rounded-xl border-2 border-dashed p-6 text-center ${file ? 'border-brand bg-blue-50' : 'border-line bg-bg'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f && f.type === 'application/pdf') setFile(f)
              else setError('יש לבחור קובץ PDF.')
            }}
          >
            <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" aria-label="בחירת קובץ PDF" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-sm text-fg">{file ? file.name : 'גררו לכאן קובץ PDF, או'}</p>
            <button type="button" onClick={() => fileRef.current?.click()} className={`${secondary} mt-3`}>{file ? 'החלפת קובץ' : 'בחירת קובץ'}</button>
            <p className="mt-2 text-xs text-muted">PDF עד 25MB; שדות מילוי שקיימים בקובץ מזוהים אוטומטית, ואם אין — מציבים אותם בעורך אחרי ההעלאה.</p>
          </div>
          {mode === 'replace' ? <p className="text-xs text-muted">ההחלפה שומרת גרסאות: מסמכים שכבר נשלחו או נחתמו שומרים את הגרסה שלהם. רק מסמכים חדשים ייעשו מהתבנית החדשה.</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={!file || !name.trim() || busy} onClick={() => void upload()} className={primary}>{busy ? 'מעלה ומזהה שדות…' : 'העלאה וזיהוי שדות'}</button>
          </div>
        </div>
      ) : null}

      {step === 'map' && templateId ? (
        <div className="flex flex-col gap-3">
          {detected.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">בקובץ לא זוהו שדות מילוי.</p>
              <p className="mt-1">זה קורה כשה-PDF הוא סריקה או מסמך ״שטוח״ בלי שדות טופס. אפשר להמשיך בשתי דרכים:</p>
              <ul className="mt-2 list-disc ps-5">
                <li>לפתוח את עורך השדות ולהציב את השדות (שם העסק, ח.פ., חתימה, תאריך…) ידנית על העמודים.</li>
                <li>או להעלות קובץ אחר שבו שדות המילוי מוגדרים.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/templates/${templateId}/fields`} className={primary}>לפתיחת עורך השדות</Link>
                <button type="button" onClick={() => { setStep('upload'); setFile(null) }} className={secondary}>העלאת קובץ אחר</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-fg">זוהו {detected.length} שדות. לכל שדה, בחרו איזה פרט ימולא בו אוטומטית:</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {detected.map((f) => (
                  <li key={f.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_1fr] sm:items-center">
                    <span className="min-w-0 text-sm text-fg">
                      <span className="block truncate font-medium" dir="auto">{f.name}</span>
                      <span className="text-xs text-muted">עמוד {f.page} · {f.type}</span>
                    </span>
                    <select value={roles[f.id] ?? ''} onChange={(e) => setRoles({ ...roles, [f.id]: e.target.value as AgreementRole | '' })} className="h-10 w-full rounded-lg border border-line bg-bg px-2 text-sm text-fg" aria-label={`פרט לשדה ${f.name}`}>
                      <option value="">— לא ממולא אוטומטית —</option>
                      {AGREEMENT_ROLES.filter((r) => r.type === f.type).map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              {missing.length ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">עדיין לא מופו: {missing.map((m) => m.label).join(', ')}. אפשר להמשיך ולהשלים בעורך השדות.</p> : null}
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void saveRoles()} className={primary}>{busy ? 'שומר…' : 'המשך לתצוגה מקדימה'}</button>
                <Link href={`/templates/${templateId}/fields`} className={secondary}>לעורך השדות</Link>
              </div>
            </>
          )}
        </div>
      ) : null}

      {step === 'preview' && templateId && layout ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">כך ייראה המסמך: השדות המסומנים ימולאו אוטומטית מהפרטים, וחתימה ותאריך — בעת החתימה.</p>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-slate-100 p-3">
            {layout.pages.map((p) => (
              <PdfPage key={p.pageNumber} url={`/api/templates/${templateId}/file`} pageNumber={p.pageNumber} widthPt={p.widthPt} heightPt={p.heightPt} className="relative w-full overflow-hidden rounded-lg border border-line bg-white shadow-sm">
                {layout.fields.filter((f) => f.page === p.pageNumber).map((f) => (
                  <span key={f.id} title={f.label} className="absolute rounded border border-dashed border-brand bg-brand/10 text-[10px] leading-none text-brand" style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.width}%`, height: `${f.height}%` }}>
                    <span className="absolute -top-3 start-0 whitespace-nowrap rounded bg-white px-1">{ROLE_LABELS[(f as { role?: AgreementRole }).role as AgreementRole] ?? f.label}</span>
                  </span>
                ))}
              </PdfPage>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep('activate')} className={primary}>הכול תקין, להמשך</button>
            <button type="button" onClick={() => setStep('map')} className={secondary}>חזרה למיפוי</button>
          </div>
        </div>
      ) : null}

      {step === 'activate' && templateId ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-bg p-4 text-sm text-fg">
            <p className="font-semibold">{mode === 'replace' ? 'החלפת התבנית' : 'הפעלת התבנית'}</p>
            <p className="mt-1 text-muted">
              {mode === 'replace'
                ? 'התבנית החדשה תחליף את הקודמת בכל קמפיין שהשתמש בה (הסכם ברירת המחדל וההסכם של עמוד ההרשמה). התבנית הקודמת יורדת מהרשימה; מסמכים שכבר נשלחו או נחתמו לא משתנים.'
                : 'התבנית תופיע ברשימת התבניות ותהיה זמינה לקמפיינים ולמסמכים חדשים.'}
            </p>
          </div>
          {rebound !== null ? <p className="text-sm text-green-700">{rebound} קמפיינים הועברו לתבנית החדשה.</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void activate()} className={primary}>{busy ? 'מפעיל…' : mode === 'replace' ? 'אישור והחלפה' : 'אישור והפעלה'}</button>
            <button type="button" onClick={() => setStep('preview')} className={secondary}>חזרה</button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
    </div>
  )
}
