'use client'

import { OWNER_LABELS, type FieldOwner, type PlacedField } from '@/lib/fields'

/**
 * Everything you can change about one field.
 *
 * Four controls. No advanced section, no conditional logic, no validation
 * rules — the spec asks for a form an office worker can use without training,
 * and every extra control here is one more thing to read past.
 */
export function FieldPanel({
  field,
  onChange,
  onDelete,
  onDuplicate,
}: {
  field: PlacedField
  onChange: (patch: Partial<PlacedField>) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const isSelect = field.type === 'select'

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg">עריכת שדה</h2>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="field-label" className="text-xs font-medium text-fg">
            שם השדה
          </label>
          <input
            id="field-label"
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          {/* "מי ממלא את השדה?" — never "field owner". */}
          <legend className="text-xs font-medium text-fg">מי ממלא את השדה?</legend>
          <div className="mt-1 flex gap-2">
            {(['sender', 'signer'] as FieldOwner[]).map((owner) => (
              <label
                key={owner}
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm transition-colors ${
                  field.ownedBy === owner
                    ? 'border-[var(--color-accent)] bg-blue-50 font-medium text-fg'
                    : 'border-line bg-white text-muted hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="owner"
                  className="sr-only"
                  checked={field.ownedBy === owner}
                  onChange={() => onChange({ ownedBy: owner })}
                />
                {OWNER_LABELS[owner]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex min-h-11 items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="h-4 w-4"
          />
          חובה למלא
        </label>

        {isSelect ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="field-options" className="text-xs font-medium text-fg">
              אפשרויות לבחירה
            </label>
            <textarea
              id="field-options"
              rows={4}
              value={(field.options ?? []).join('\n')}
              onChange={(e) =>
                onChange({ options: e.target.value.split('\n').filter((o) => o.trim()) })
              }
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted">אפשרות אחת בכל שורה</p>
          </div>
        ) : null}

        {/* Only a field we fill in has a value to type now. */}
        {field.ownedBy === 'sender' && !isSelect ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="field-value" className="text-xs font-medium text-fg">
              ערך
            </label>
            <input
              id="field-value"
              value={field.value ?? ''}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder="למשל: אטרקציות ישראל בע״מ"
              className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
            />
          </div>
        ) : null}

        <div className="flex gap-2 border-t border-line pt-3">
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
    </div>
  )
}
