'use client'

import { useRef, useState } from 'react'
import { AGREEMENT_ROLES, missingRoles, ROLE_LABELS, type AgreementRole } from '@/lib/agreement-roles'

/**
 * The agreement a self-service project's registrants sign.
 *
 * One card: which agreement is active and how many of its boxes fill
 * themselves. Replacing it is a short guided walk — upload, see what was
 * found, say which box answers which question, look at the result, switch —
 * because a legal document's boxes are not something to guess at. Nothing
 * is activated by the upload alone, and the previous agreement keeps serving
 * until "שמור והפעל". Only Hebrew names here: no field ids, no geometry.
 */

export type ActiveAgreement = {
  id: string
  name: string
  fieldCount: number
  /** Boxes with a role, i.e. filled from the registration automatically. */
  readyCount: number
  missing: { key: AgreementRole; label: string; required: boolean }[]
}

type Detected = { id: string; name: string; type: string; page: number; suggestion: AgreementRole | null }

type Step = 'upload' | 'map' | 'preview'

const buttonClass =
  'inline-flex min-h-10 items-center justify-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
const primaryClass =
  'inline-flex min-h-10 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'

const TYPE_LABELS: Record<string, string> = {
  signature: 'חתימה',
  full_name: 'שם מלא',
  text: 'טקסט',
  number: 'מספר',
  date: 'תאריך',
  checkbox: 'תיבת סימון',
  select: 'בחירה',
  email: 'אימייל',
  phone: 'טלפון',
  file: 'קובץ',
}

export function AgreementPanel({
  agreement,
  projectId,
  onActivate,
}: {
  agreement: ActiveAgreement | null
  projectId: string
  /** Binds the template to the project and saves; resolves false when the save failed. */
  onActivate: (templateId: string) => Promise<boolean>
}) {
  const [replacing, setReplacing] = useState(agreement === null)

  return (
    <div className="mt-4 rounded-lg border border-line bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">ההסכם לחתימה</h3>
        {agreement && !replacing ? (
          <span className="text-xs text-muted">
            {agreement.readyCount} שדות מוכנים למילוי אוטומטי
          </span>
        ) : null}
      </div>

      {agreement && !replacing ? (
        <>
          <p className="mt-2 text-sm text-fg">{agreement.name}</p>
          {agreement.missing.some((m) => m.required) ? (
            <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              חסר מיפוי לשדות חובה: {agreement.missing.filter((m) => m.required).map((m) => m.label).join(', ')}. יש
              להגדיר אותם לפני השימוש.
            </p>
          ) : agreement.fieldCount === 0 ? (
            <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              לא זוהו שדות למילוי במסמך. יש להגדיר אותם לפני השימוש.
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/templates/${agreement.id}/file`} target="_blank" rel="noreferrer" className={buttonClass}>
              צפייה בהסכם
            </a>
            <a href={`/templates/${agreement.id}/fields?back=${encodeURIComponent(`/projects/${projectId}?tab=settings`)}`} className={buttonClass}>
              הגדרת שדות
            </a>
            <button type="button" onClick={() => setReplacing(true)} className={buttonClass}>
              החלפת הסכם
            </button>
          </div>
        </>
      ) : (
        <ReplaceWizard
          projectId={projectId}
          hasCurrent={agreement !== null}
          onCancel={() => setReplacing(false)}
          onActivate={async (id) => {
            const ok = await onActivate(id)
            if (ok) setReplacing(false)
            return ok
          }}
        />
      )}
    </div>
  )
}

function ReplaceWizard({
  projectId,
  hasCurrent,
  onCancel,
  onActivate,
}: {
  projectId: string
  hasCurrent: boolean
  onCancel: () => void
  onActivate: (templateId: string) => Promise<boolean>
}) {
  const [step, setStep] = useState<Step>('upload')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [detected, setDetected] = useState<Detected[]>([])
  const [roles, setRoles] = useState<Record<string, AgreementRole | null>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const chosen = Object.values(roles)
  const missing = missingRoles(chosen)
  const missingRequired = missing.filter((m) => m.required)
  const duplicates = AGREEMENT_ROLES.filter((r) => chosen.filter((c) => c === r.key).length > 1).map((r) => r.label)

  // ── 1. upload, 2. detect ────────────────────────────────────────────────
  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('יש לבחור קובץ PDF.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('name', name.trim() || file.name.replace(/\.pdf$/i, ''))
      const response = await fetch('/api/templates/from-pdf', { method: 'POST', body: form })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'ההעלאה נכשלה.')
        return
      }
      const found: Detected[] = Array.isArray(data?.fields) ? data.fields : []
      setTemplateId(data.templateId)
      setDetected(found)
      // Suggestions are shown pre-selected and must be confirmed; nothing is saved yet.
      setRoles(Object.fromEntries(found.map((f) => [f.id, f.suggestion ?? null])))
      setStep('map')
    } catch {
      setError('ההעלאה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  // ── 3. mapping → 4. preview ─────────────────────────────────────────────
  async function confirmMapping() {
    if (!templateId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/templates/${templateId}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'שמירת המיפוי נכשלה.')
        return
      }
      setStep('preview')
    } catch {
      setError('שמירת המיפוי נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  // ── 5. save & activate ──────────────────────────────────────────────────
  async function activate() {
    if (!templateId) return
    setBusy(true)
    setError(null)
    try {
      const ok = await onActivate(templateId)
      if (!ok) setError('ההפעלה נכשלה. בדקו את ההודעה למעלה.')
    } finally {
      setBusy(false)
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: 'העלאת PDF' },
    { key: 'map', label: 'מיפוי שדות' },
    { key: 'preview', label: 'בדיקה והפעלה' },
  ]

  return (
    <div className="mt-3">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={s.key} className={s.key === step ? 'font-semibold text-brand' : 'text-muted'} aria-current={s.key === step ? 'step' : undefined}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      {step === 'upload' ? (
        <div className="mt-3 rounded-lg border border-dashed border-line bg-surface p-3">
          <p className="text-xs text-muted">
            {hasCurrent ? 'ההסכם הנוכחי ממשיך לשמש עד שההסכם החדש יופעל. ' : ''}
            החלפה משפיעה על הרשמות חדשות בלבד; הסכמים שכבר נוצרו נשארים כפי שהם.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם ההסכם"
              className="h-11 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
            />
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              aria-label="קובץ PDF של ההסכם"
              className="h-11 flex-1 text-sm text-fg file:me-2 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-xs"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void upload()} className={primaryClass}>
              {busy ? 'מעלה ומזהה שדות…' : 'העלאה וזיהוי שדות'}
            </button>
            {hasCurrent ? (
              <button type="button" onClick={onCancel} className={buttonClass}>
                ביטול
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 'map' ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          {detected.length === 0 ? (
            <>
              <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                לא זוהו שדות למילוי במסמך. יש להגדיר אותם לפני השימוש.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`/templates/${templateId}/fields?back=${encodeURIComponent(`/projects/${projectId}?tab=settings`)}`} className={primaryClass}>
                  הגדרת שדות על המסמך
                </a>
                <button type="button" onClick={onCancel} className={buttonClass}>
                  ביטול
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-fg">זוהו {detected.length} שדות. לכל שדה, בחרו איזה פרט מההרשמה ימולא בו:</p>
              <p className="mt-1 text-xs text-muted">ההצעות מסומנות מראש לפי שם השדה במסמך — אשרו או שנו אותן.</p>
              <ul className="mt-3 divide-y divide-line">
                {detected.map((f) => (
                  <li key={f.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1 text-sm text-fg">
                      {f.name}
                      <span className="ms-2 text-xs text-muted">
                        {TYPE_LABELS[f.type] ?? f.type} · עמוד {f.page}
                      </span>
                    </span>
                    <select
                      value={roles[f.id] ?? ''}
                      onChange={(e) => setRoles((r) => ({ ...r, [f.id]: (e.target.value || null) as AgreementRole | null }))}
                      aria-label={`תפקיד השדה ${f.name}`}
                      className="h-10 rounded-lg border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-brand sm:w-56"
                    >
                      <option value="">— לא ממולא אוטומטית —</option>
                      {AGREEMENT_ROLES.filter((r) => r.type === f.type).map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                          {r.required ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              {duplicates.length > 0 ? (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  אותו פרט נבחר ליותר משדה אחד: {duplicates.join(', ')}.
                </p>
              ) : null}
              {missingRequired.length > 0 ? (
                <p role="alert" className="mt-2 text-xs text-amber-900">
                  שדות חובה שעדיין לא מופו: {missingRequired.map((m) => m.label).join(', ')}.
                </p>
              ) : missing.length > 0 ? (
                <p className="mt-2 text-xs text-muted">
                  לא ימולאו אוטומטית: {missing.map((m) => m.label).join(', ')}.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || duplicates.length > 0 || missingRequired.length > 0}
                  onClick={() => void confirmMapping()}
                  className={primaryClass}
                >
                  {busy ? 'שומר…' : 'אישור המיפוי'}
                </button>
                <a href={`/templates/${templateId}/fields?back=${encodeURIComponent(`/projects/${projectId}?tab=settings`)}`} className={buttonClass}>
                  עריכת השדות על המסמך
                </a>
                <button type="button" onClick={onCancel} className={buttonClass}>
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {step === 'preview' ? (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <p className="text-sm text-fg">
            {name.trim() || 'ההסכם החדש'} · {detected.length} שדות, {chosen.filter(Boolean).length} מהם ימולאו אוטומטית.
          </p>
          <ul className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
            {detected
              .filter((f) => roles[f.id])
              .map((f) => (
                <li key={f.id}>
                  {ROLE_LABELS[roles[f.id]!]} ← {f.name}
                </li>
              ))}
          </ul>
          {missing.length > 0 ? (
            <p className="mt-2 text-xs text-muted">לא ימולאו אוטומטית: {missing.map((m) => m.label).join(', ')}.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/templates/${templateId}/file`} target="_blank" rel="noreferrer" className={buttonClass}>
              צפייה במסמך
            </a>
            <button type="button" disabled={busy} onClick={() => void activate()} className={primaryClass}>
              {busy ? 'מפעיל…' : 'שמור והפעל'}
            </button>
            <button type="button" onClick={() => setStep('map')} className={buttonClass}>
              חזרה למיפוי
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}
