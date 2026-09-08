'use client'

import { OPERATORS, OPERATOR_LABELS } from '@/server/reports/engine/types'
import type { Clause, Condition, ConditionValue, FieldMeta, Operator } from '@/server/reports/engine/types'
import { CampaignCombobox } from './CampaignCombobox'
import { btnLink, fieldClass, shapeOf, userLabel, type TagOption, type TeamUser } from './shared'

/** Relative dates the engine understands; a preset uses "tomorrow", so a date box must be able to say it. */
const RELATIVE_DATES: { value: string; label: string }[] = [
  { value: 'today', label: 'היום' },
  { value: 'tomorrow', label: 'מחר' },
  { value: 'yesterday', label: 'אתמול' },
]

const compact = 'min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand'

function groupFields(fields: FieldMeta[]): [string, FieldMeta[]][] {
  const groups = new Map<string, FieldMeta[]>()
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field])
  return [...groups.entries()]
}

const range = (v: ConditionValue | undefined): { from?: string; to?: string } => (v && typeof v === 'object' && !Array.isArray(v) && !('days' in v) ? v : {})
const list = (v: ConditionValue | undefined): string[] => (Array.isArray(v) ? v : [])

/** Chips a person toggles; the value is the list of the chosen ones. */
function Chips({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-1 flex-wrap gap-1.5">
      {options.length === 0 ? <span className="self-center text-sm text-muted">אין אפשרויות.</span> : null}
      {options.map((o) => {
        const on = value.includes(o.value)
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])} className={`inline-flex min-h-10 items-center rounded-full px-3 text-sm transition-colors ${on ? 'bg-brand text-white' : 'bg-bg text-fg hover:bg-slate-200'}`}>
            {on ? <span aria-hidden="true" className="me-1">✓</span> : null}
            <span className="max-w-48 truncate">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function ValueControl({ field, condition, onChange, team, tags }: { field: FieldMeta; condition: Condition; onChange: (v: ConditionValue | undefined) => void; team: TeamUser[]; tags: TagOption[] }) {
  const shape = shapeOf(field.type, condition.op)
  const v = condition.value
  const str = typeof v === 'string' || typeof v === 'number' ? String(v) : ''
  switch (shape) {
    case 'none':
      return null
    case 'text':
      return <input type="text" aria-label="ערך" value={str} onChange={(e) => onChange(e.target.value)} className={`${compact} min-w-0 flex-1`} placeholder="הקלידו…" />
    case 'number':
      return <input type="number" aria-label="ערך" value={str} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className={`${compact} w-32`} />
    case 'numberRange': {
      const r = range(v)
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input type="number" aria-label="מ־" value={r.from ?? ''} onChange={(e) => onChange({ ...r, from: e.target.value })} className={`${compact} w-28`} placeholder="מ־" />
          <span className="text-sm text-muted">עד</span>
          <input type="number" aria-label="עד" value={r.to ?? ''} onChange={(e) => onChange({ ...r, to: e.target.value })} className={`${compact} w-28`} placeholder="עד" />
        </div>
      )
    }
    case 'date': {
      const relative = RELATIVE_DATES.some((d) => d.value === str)
      return (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="מתי" value={relative ? str : 'date'} onChange={(e) => onChange(e.target.value === 'date' ? '' : e.target.value)} className={compact}>
            <option value="date">תאריך…</option>
            {RELATIVE_DATES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          {!relative ? <input type="date" aria-label="תאריך" value={str} onChange={(e) => onChange(e.target.value)} className={compact} /> : null}
        </div>
      )
    }
    case 'dateRange': {
      const r = range(v)
      return (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" aria-label="מתאריך" value={r.from ?? ''} onChange={(e) => onChange({ ...r, from: e.target.value })} className={compact} />
          <span className="text-sm text-muted">עד</span>
          <input type="date" aria-label="עד תאריך" value={r.to ?? ''} onChange={(e) => onChange({ ...r, to: e.target.value })} className={compact} />
        </div>
      )
    }
    case 'days': {
      const days = v && typeof v === 'object' && 'days' in v ? v.days : ''
      return (
        <div className="flex items-center gap-2">
          <input type="number" min={1} aria-label="מספר ימים" value={days} onChange={(e) => onChange({ days: Number(e.target.value) || 0 })} className={`${compact} w-24`} />
          <span className="text-sm text-muted">ימים אחרונים</span>
        </div>
      )
    }
    case 'one':
      return (
        <select aria-label="ערך" value={str} onChange={(e) => onChange(e.target.value)} className={compact}>
          <option value="">בחרו…</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'many':
      return <Chips options={field.options ?? []} value={list(v)} onChange={onChange} label={field.label} />
    case 'bool':
      return (
        <select aria-label="ערך" value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'yes')} className={compact}>
          <option value="">בחרו…</option>
          <option value="yes">כן</option>
          <option value="no">לא</option>
        </select>
      )
    case 'campaigns':
      return <CampaignCombobox value={list(v)} onChange={onChange} />
    case 'tags':
      return <Chips options={tags.map((t) => ({ value: t.id, label: t.name }))} value={list(v)} onChange={onChange} label="תגים" />
    case 'user':
      return (
        <select aria-label="משתמש" value={str} onChange={(e) => onChange(e.target.value)} className={compact}>
          <option value="">בחרו…</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u)}
            </option>
          ))}
        </select>
      )
    case 'users':
      return <Chips options={team.map((u) => ({ value: u.id, label: userLabel(u) }))} value={list(v)} onChange={onChange} label="משתמשים" />
  }
}

function ConditionRow({ fields, condition, onChange, onRemove, team, tags }: { fields: FieldMeta[]; condition: Condition; onChange: (c: Condition) => void; onRemove: () => void; team: TeamUser[]; tags: TagOption[] }) {
  const field = fields.find((f) => f.key === condition.field)
  const operators: readonly Operator[] = field ? OPERATORS[field.type] : []

  function setField(key: string) {
    const next = fields.find((f) => f.key === key)
    if (!next) return
    onChange({ field: key, op: OPERATORS[next.type][0], value: undefined })
  }

  function setOp(op: Operator) {
    if (!field) return
    const keep = shapeOf(field.type, op) === shapeOf(field.type, condition.op)
    onChange({ ...condition, op, value: keep ? condition.value : undefined })
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-start">
      <select aria-label="שדה" value={condition.field} onChange={(e) => setField(e.target.value)} className={`${fieldClass} md:w-56`}>
        {!field ? <option value="">בחרו שדה…</option> : null}
        {groupFields(fields).map(([group, items]) => (
          <optgroup key={group} label={group}>
            {items.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {field ? (
        <select aria-label="תנאי" value={condition.op} onChange={(e) => setOp(e.target.value as Operator)} className={`${fieldClass} md:w-44`}>
          {operators.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </select>
      ) : null}
      {field ? (
        <div className="flex min-w-0 flex-1 items-start">
          <ValueControl field={field} condition={condition} onChange={(value) => onChange({ ...condition, value })} team={team} tags={tags} />
        </div>
      ) : null}
      <button type="button" onClick={onRemove} aria-label="הסרת התנאי" className="inline-flex min-h-11 min-w-11 items-center justify-center self-end rounded-xl text-muted hover:bg-bg hover:text-danger md:self-start">
        ✕
      </button>
    </div>
  )
}

/**
 * The conditions: each row is one, rows in the same box are alternatives
 * ("או"), boxes stack as "וגם". No words a person has to look up.
 */
export function FilterBuilder({ fields, clauses, onChange, team, tags }: { fields: FieldMeta[]; clauses: Clause[]; onChange: (clauses: Clause[]) => void; team: TeamUser[]; tags: TagOption[] }) {
  const filterable = fields.filter((f) => f.filterable)
  const fresh = (): Condition => ({ field: '', op: 'is', value: undefined })

  function update(ci: number, any: Condition[]) {
    const next = clauses.map((c, i) => (i === ci ? { any } : c)).filter((c) => c.any.length > 0)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-2">
      {clauses.map((clause, ci) => (
        <div key={ci} className="flex flex-col gap-2">
          {ci > 0 ? <div className="text-xs font-semibold text-muted">וגם</div> : null}
          <div className={`flex flex-col gap-2 rounded-xl border bg-surface p-3 ${clause.any.length > 1 ? 'border-brand/40' : 'border-line'}`}>
            {clause.any.map((condition, i) => (
              <div key={i} className="flex flex-col gap-2">
                {i > 0 ? <div className="text-xs font-semibold text-brand">או</div> : null}
                <ConditionRow
                  fields={filterable}
                  condition={condition}
                  team={team}
                  tags={tags}
                  onChange={(c) => update(ci, clause.any.map((x, j) => (j === i ? c : x)))}
                  onRemove={() => update(ci, clause.any.filter((_, j) => j !== i))}
                />
              </div>
            ))}
            <button type="button" onClick={() => update(ci, [...clause.any, fresh()])} className={`${btnLink} self-start`}>
              + או
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...clauses, { any: [fresh()] }])} className="inline-flex min-h-12 items-center justify-center gap-1 self-start rounded-xl border border-dashed border-brand px-4 text-sm font-medium text-brand hover:bg-blue-50">
        + הוספת תנאי
      </button>
    </div>
  )
}
