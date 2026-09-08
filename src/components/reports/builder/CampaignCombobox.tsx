'use client'

import { useEffect, useId, useRef, useState } from 'react'

export type CampaignHit = { id: string; name: string; kind: 'signing' | 'inquiries' | 'direct'; status: 'active' | 'paused' | 'ended' | 'archived' }

const KIND: Record<CampaignHit['kind'], string> = { signing: 'החתמה', inquiries: 'פניות', direct: 'חתימה ישירה' }
const STATUS: Record<CampaignHit['status'], { label: string; tone: string }> = {
  active: { label: 'פעיל', tone: 'bg-green-50 text-green-800' },
  paused: { label: 'מושהה', tone: 'bg-amber-50 text-amber-800' },
  ended: { label: 'הסתיים', tone: 'bg-slate-100 text-slate-700' },
  archived: { label: 'בארכיון', tone: 'bg-slate-100 text-slate-500' },
}

/** Names seen in any search this session, so a chip for an id from a link still reads as a name. */
const known = new Map<string, CampaignHit>()

/**
 * Pick campaigns by name: the server searches (debounced 200ms), the chosen
 * ones sit as chips with ×. Never loads the whole list — a page of matches
 * at a time — and "כל הקמפיינים" clears the choice without touching any
 * other condition.
 */
export function CampaignCombobox({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CampaignHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  async function search(q: string) {
    setLoading(true)
    try {
      const response = await fetch(`/api/campaigns/search?q=${encodeURIComponent(q)}&limit=12`)
      const data = response.ok ? await response.json() : null
      const list: CampaignHit[] = data?.campaigns ?? []
      for (const hit of list) known.set(hit.id, hit)
      setHits(list)
    } catch {
      setHits([])
    } finally {
      setLoading(false)
    }
  }

  // Ids that arrived from a link: one recent-campaigns search usually names them.
  useEffect(() => {
    if (!value.some((v) => !known.has(v))) return
    let cancelled = false
    fetch('/api/campaigns/search?q=&limit=30')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        const list: CampaignHit[] = data?.campaigns ?? []
        for (const hit of list) known.set(hit.id, hit)
        setHits(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // ponytail: only on mount — later ids come from this picker and are already known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onInput(q: string) {
    setQuery(q)
    setOpen(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void search(q), 200)
  }

  function add(hit: CampaignHit) {
    if (!value.includes(hit.id)) onChange([...value, hit.id])
    setQuery('')
    setOpen(false)
  }

  const visible = hits.filter((h) => !value.includes(h.id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((cid) => (
            <span key={cid} className="inline-flex items-center gap-1 rounded-full bg-blue-50 ps-3 text-sm text-fg">
              <span className="max-w-56 truncate">{known.get(cid)?.name ?? 'קמפיין שנבחר'}</span>
              <button type="button" onClick={() => onChange(value.filter((v) => v !== cid))} aria-label={`הסרת ${known.get(cid)?.name ?? 'הקמפיין'}`} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted hover:bg-blue-100 hover:text-fg">
                ×
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange([])} className="inline-flex min-h-9 items-center px-2 text-sm text-brand underline-offset-4 hover:underline">
            כל הקמפיינים
          </button>
        </div>
      ) : null}
      <div className="relative">
        <label htmlFor={id} className="sr-only">
          חיפוש קמפיין
        </label>
        <input
          id={id}
          type="text"
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          autoComplete="off"
          placeholder={value.length ? 'הוספת קמפיין נוסף…' : 'חיפוש קמפיין לפי שם…'}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => {
            setOpen(true)
            if (hits.length === 0) void search(query)
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
        />
        {open ? (
          <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
            {loading && visible.length === 0 ? <li className="px-3 py-2 text-sm text-muted">מחפש…</li> : null}
            {!loading && visible.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{query ? 'לא נמצא קמפיין בשם הזה.' : 'אין קמפיינים להצגה.'}</li> : null}
            {visible.map((hit) => (
              <li key={hit.id} role="option" aria-selected={false}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(hit)} className="flex min-h-11 w-full items-center gap-2 px-3 text-start text-sm text-fg hover:bg-bg">
                  <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                  <span className="shrink-0 text-xs text-muted">{KIND[hit.kind]}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS[hit.status].tone}`}>{STATUS[hit.status].label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
