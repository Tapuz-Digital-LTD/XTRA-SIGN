'use client'

import type { PlacedField } from '@/lib/fields'

/**
 * The settings for one field.
 *
 * Every label names the outcome, never the mechanism, and each field type shows
 * only the settings that make sense for it — a signature has no "value", a date
 * can fill itself, a checkbox has a caption rather than a title. The goal is
 * that someone seeing this for the first time never has to guess what a control
 * does.
 */

/** A placeholder example tuned to the field type, so the input shows its shape. */
const VALUE_EXAMPLES: Partial<Record<PlacedField['type'], string>> = {
  full_name: 'לדוגמה: תפוזנט פתרונות שיווק בע״מ',
  text: 'לדוגמה: תפוזנט פתרונות שיווק בע״מ',
  number: 'לדוגמה: 15',
  email: 'לדוגמה: info@example.co.il',
  phone: 'לדוגמה: 03-1234567',
  date: 'לדוגמה: 01/09/2026',
}

export function FieldPanel({
  field,
  pageCount,
  onChange,
  onDelete,
  onDuplicate,
  onClose,
}: {
  field: PlacedField
  pageCount: number
  onChange: (patch: Partial<PlacedField>) => void
  onDelete: () => void
  onDuplicate: () => void
  onClose: () => void
}) {
  const t = field.type
  const isSigner = field.ownedBy === 'signer'

  // Which types let a person choose who enters the data. A signature is always
  // the signer's; a checkbox and a date have their own, clearer choices.
  const hasOwnerChoice = ['full_name', 'text', 'number', 'email', 'phone', 'select'].includes(t)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">הגדרות השדה</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-slate-100 hover:text-fg"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {/* ── who enters the data ─────────────────────────────────────────── */}
        {t === 'signature' ? (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-fg">
            החותם חותם כאן, בזמן החתימה.
          </p>
        ) : t === 'date' ? (
          <Choice
            legend="מתי מוזן התאריך?"
            value={field.autoFill ? 'auto' : isSigner ? 'signer' : 'sender'}
            options={[
              { key: 'auto', label: 'אוטומטי — תאריך החתימה', hint: 'המערכת ממלאת את היום שבו נחתם המסמך.' },
              { key: 'signer', label: 'החותם מזין', hint: 'החותם יבחר תאריך בזמן החתימה.' },
              { key: 'sender', label: 'אני מזין', hint: 'תאריך קבוע שייקבע עכשיו.' },
            ]}
            onSelect={(k) =>
              onChange({
                autoFill: k === 'auto',
                ownedBy: k === 'signer' ? 'signer' : 'sender',
                ...(k !== 'sender' ? { value: null } : {}),
              })
            }
          />
        ) : hasOwnerChoice ? (
          <Choice
            legend="מי מזין את המידע בשדה?"
            value={isSigner ? 'signer' : 'sender'}
            options={[
              { key: 'sender', label: 'אני, לפני השליחה', hint: 'הערך יוכנס למסמך לפני שהוא נשלח.' },
              { key: 'signer', label: 'החותם, בזמן החתימה', hint: 'החותם יתבקש להשלים אותו.' },
            ]}
            onSelect={(k) => onChange({ ownedBy: k as 'sender' | 'signer' })}
          />
        ) : null}

        {/* ── checkbox caption ────────────────────────────────────────────── */}
        {t === 'checkbox' ? (
          <>
            <Text
              label="הטקסט שליד תיבת הסימון"
              value={field.label}
              placeholder="לדוגמה: אני מאשר/ת את תנאי ההסכם"
              onChange={(v) => onChange({ label: v })}
            />
            <Choice
              legend="מי מסמן?"
              value={isSigner ? 'signer' : 'sender'}
              options={[
                { key: 'signer', label: 'החותם מסמן', hint: 'החותם יסמן בזמן החתימה.' },
                { key: 'sender', label: 'אני מסמן עכשיו', hint: 'הסימון ייקבע כעת.' },
              ]}
              onSelect={(k) => onChange({ ownedBy: k as 'sender' | 'signer' })}
            />
            {!isSigner ? (
              <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={field.value === 'true'}
                  onChange={(e) => onChange({ value: e.target.checked ? 'true' : 'false' })}
                  className="h-5 w-5"
                />
                מסומן
              </label>
            ) : null}
          </>
        ) : null}

        {/* ── the value we fill, or the title/hint the signer sees ────────── */}
        {t !== 'signature' && t !== 'checkbox' && t !== 'select' ? (
          field.autoFill ? null : !isSigner ? (
            <Text
              label="מה יופיע בשדה?"
              value={field.value ?? ''}
              placeholder={VALUE_EXAMPLES[t] ?? ''}
              onChange={(v) => onChange({ value: v })}
              autoFocus
            />
          ) : (
            <>
              <Text
                label="כותרת השדה"
                value={field.label}
                placeholder="לדוגמה: שם מלא"
                onChange={(v) => onChange({ label: v })}
              />
              <Text
                label="טקסט עזר לחותם (לא חובה)"
                value={field.placeholder ?? ''}
                placeholder="לדוגמה: כפי שמופיע בתעודת הזהות"
                onChange={(v) => onChange({ placeholder: v || null })}
              />
            </>
          )
        ) : null}

        {/* ── select options ──────────────────────────────────────────────── */}
        {t === 'select' ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">האפשרויות לבחירה</label>
            <textarea
              rows={4}
              value={(field.options ?? []).join('\n')}
              onChange={(e) => onChange({ options: e.target.value.split('\n').filter((o) => o.trim()) })}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted">אפשרות אחת בכל שורה.</p>
          </div>
        ) : null}

        {/* ── required ────────────────────────────────────────────────────── */}
        {t !== 'checkbox' ? (
          field.autoFill ? null : !isSigner && t !== 'signature' ? (
            <Toggle
              label="חובה להגדיר ערך לפני השליחה"
              hint="לא נוכל לשלוח את המסמך כל עוד השדה ריק."
              checked={field.required}
              onChange={(v) => onChange({ required: v })}
            />
          ) : (
            <Toggle
              label="שדה חובה"
              hint="החותם לא יוכל לסיים לפני שמילא את השדה."
              checked={field.required}
              onChange={(v) => onChange({ required: v })}
            />
          )
        ) : isSigner ? (
          <Toggle
            label="חובה לסמן"
            hint="החותם לא יוכל לסיים לפני שסימן."
            checked={field.required}
            onChange={(v) => onChange({ required: v })}
          />
        ) : null}

        {/* ── page ────────────────────────────────────────────────────────── */}
        {pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="field-page" className="text-xs font-medium text-fg">
              עמוד
            </label>
            <select
              id="field-page"
              value={field.page}
              onChange={(e) => onChange({ page: Number(e.target.value) })}
              className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
            >
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  עמוד {n}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={onDuplicate}
          className="min-h-11 flex-1 rounded-lg border border-line bg-white text-sm text-fg transition-colors hover:bg-slate-50"
        >
          שכפול
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="min-h-11 flex-1 rounded-lg border border-line bg-white text-sm text-danger transition-colors hover:bg-red-50"
        >
          מחיקה
        </button>
      </div>
    </div>
  )
}

function Choice({
  legend,
  value,
  options,
  onSelect,
}: {
  legend: string
  value: string
  options: { key: string; label: string; hint: string }[]
  onSelect: (key: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-fg">{legend}</legend>
      {options.map((o) => {
        const active = o.key === value
        return (
          <label
            key={o.key}
            className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors ${
              active ? 'border-[var(--color-accent)] bg-blue-50' : 'border-line bg-white hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                checked={active}
                onChange={() => onSelect(o.key)}
                className="h-4 w-4"
              />
              <span className="font-medium text-fg">{o.label}</span>
            </span>
            <span className="mt-1 ms-6 text-xs text-muted">{o.hint}</span>
          </label>
        )
      })}
    </fieldset>
  )
}

function Text({
  label,
  value,
  placeholder,
  onChange,
  autoFocus,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-fg">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
      />
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}
