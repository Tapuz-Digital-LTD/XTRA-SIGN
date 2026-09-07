'use client'

import { useState } from 'react'
import type { Tag } from '@/server/tags/tags'

const keyOf = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

/** Reads the backend's message out of a failed response, or falls back. */
async function failure(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null)
  return data?.error?.message ?? fallback
}

/**
 * The tags on one company: chips with ×, and an input that suggests the
 * organization's existing tags or creates a new one on Enter. Every change is
 * shown at once and undone if the server refuses it.
 */
export function TagPicker({ companyId, tags: initial }: { companyId: string; tags: Tag[] }) {
  const [tags, setTags] = useState<Tag[]>(initial)
  const [all, setAll] = useState<Tag[] | null>(null)
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadAll() {
    if (all) return
    const response = await fetch('/api/tags?kind=company')
    if (response.ok) setAll((await response.json())?.tags ?? [])
  }

  async function link(action: 'add_tags' | 'remove_tags', tagId: string): Promise<string | null> {
    try {
      const response = await fetch('/api/companies/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyIds: [companyId], action, tagIds: [tagId] }),
      })
      return response.ok ? null : await failure(response, 'השמירה נכשלה.')
    } catch {
      return 'השמירה נכשלה. בדקו את החיבור לאינטרנט.'
    }
  }

  async function attach(tag: Tag) {
    if (tags.some((t) => t.id === tag.id)) return
    setError(null)
    setInput('')
    setTags((current) => [...current, tag])
    const message = await link('add_tags', tag.id)
    if (message) {
      setTags((current) => current.filter((t) => t.id !== tag.id))
      setError(message)
    }
  }

  async function create(name: string) {
    const key = keyOf(name)
    if (!key) return
    const existing = all?.find((t) => keyOf(t.name) === key)
    if (existing) return attach(existing)

    // Shown at once under a temporary id; swapped for the real one on success.
    const temp: Tag = { id: `tmp-${Date.now()}`, kind: 'company', name: name.trim().replace(/\s+/g, ' '), color: null }
    setError(null)
    setInput('')
    setTags((current) => [...current, temp])
    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: 'company' }),
      })
      if (!response.ok) throw new Error(await failure(response, 'יצירת התג נכשלה.'))
      const tag: Tag = (await response.json()).tag
      setAll((current) => (current && !current.some((t) => t.id === tag.id) ? [...current, tag] : current))
      const message = await link('add_tags', tag.id)
      if (message) throw new Error(message)
      setTags((current) => current.map((t) => (t.id === temp.id ? tag : t)))
    } catch (e) {
      setTags((current) => current.filter((t) => t.id !== temp.id))
      setError(e instanceof Error ? e.message : 'יצירת התג נכשלה.')
    }
  }

  async function remove(tag: Tag) {
    setError(null)
    setTags((current) => current.filter((t) => t.id !== tag.id))
    const message = await link('remove_tags', tag.id)
    if (message) {
      setTags((current) => [...current, tag])
      setError(message)
    }
  }

  const key = keyOf(input)
  const suggestions = (all ?? [])
    .filter((t) => !tags.some((x) => x.id === t.id))
    .filter((t) => !key || keyOf(t.name).includes(key))
    .slice(0, 8)
  const exact = key !== '' && (all ?? []).some((t) => keyOf(t.name) === key)
  const showList = focused && (suggestions.length > 0 || (key !== '' && !exact))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 ps-3 text-sm text-slate-800">
            <span className="max-w-48 truncate">{tag.name}</span>
            <button
              type="button"
              onClick={() => void remove(tag)}
              aria-label={`הסרת התג ${tag.name}`}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-full text-muted hover:bg-slate-200 hover:text-fg"
            >
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 ? <span className="text-sm text-muted">אין תגים עדיין.</span> : null}
      </div>

      <div className="relative max-w-sm">
        <label htmlFor={`tag-input-${companyId}`} className="sr-only">הוספת תג</label>
        <input
          id={`tag-input-${companyId}`}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => {
            setFocused(true)
            void loadAll()
          }}
          // Delayed so a click on a suggestion lands before the list closes.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create(input)
            }
          }}
          placeholder="הוספת תג… (Enter ליצירה)"
          autoComplete="off"
          className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
        />
        {showList ? (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg" role="listbox">
            {suggestions.map((tag) => (
              <li key={tag.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void attach(tag)} className="flex min-h-11 w-full items-center px-3 text-start text-sm text-fg hover:bg-bg">
                  {tag.name}
                </button>
              </li>
            ))}
            {key !== '' && !exact ? (
              <li>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void create(input)} className="flex min-h-11 w-full items-center gap-1 border-t border-line px-3 text-start text-sm font-medium text-brand hover:bg-bg">
                  <span aria-hidden="true">+</span>
                  {`צור תג חדש "${input.trim()}"`}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  )
}
