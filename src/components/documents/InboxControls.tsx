'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { ListFilter } from '@/server/documents/queries'

const TABS: { key: ListFilter; label: string }[] = [
  { key: 'all', label: 'הכול' },
  { key: 'drafts', label: 'טיוטות' },
  { key: 'pending', label: 'ממתינים לחתימה' },
  { key: 'viewed', label: 'נצפו' },
  { key: 'signed', label: 'נחתמו' },
  { key: 'canceled', label: 'בוטלו' },
  { key: 'attention', label: 'דורשים טיפול' },
]

/**
 * Search and filtering, both server-side.
 *
 * The filters live in the URL rather than in component state, so a filtered
 * view can be linked, reloaded and gone back to. On a narrow screen the tabs
 * scroll sideways rather than collapsing into a menu — every filter stays one
 * tap away instead of hidden behind a control you have to discover.
 */
export function InboxControls({ filter, search, attentionCount }: { filter: ListFilter; search: string; attentionCount: number }) {
  const router = useRouter()
  const params = useSearchParams()
  // Keyed by the committed search term: a new term from the URL remounts the
  // input with that value, instead of syncing it back through an effect.
  const [value, setValue] = useState(search)

  function apply(next: { filter?: ListFilter; q?: string }) {
    const query = new URLSearchParams(params.toString())
    if (next.filter !== undefined) {
      if (next.filter === 'all') query.delete('filter')
      else query.set('filter', next.filter)
    }
    if (next.q !== undefined) {
      if (next.q.trim()) query.set('q', next.q.trim())
      else query.delete('q')
    }
    query.delete('page') // a new filter or term starts at the first page
    router.push(`/documents${query.toString() ? `?${query}` : ''}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply({ q: value })
        }}
        className="flex gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <label htmlFor="doc-search" className="sr-only">
            חיפוש מסמכים
          </label>
          <input
            id="doc-search"
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="חיפוש לפי מסמך, חברה, חותם, טלפון או אימייל"
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
        >
          חיפוש
        </button>
      </form>

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="סינון מסמכים">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={filter === tab.key ? 'true' : undefined}
            onClick={() => apply({ filter: tab.key })}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition ${
              filter === tab.key ? 'bg-brand text-white' : 'text-muted hover:bg-slate-100 hover:text-fg'
            }`}
          >
            {tab.label}
            {tab.key === 'attention' && attentionCount > 0 ? (
              <span
                className={`rounded-full px-1.5 text-xs ${
                  filter === tab.key ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-900'
                }`}
              >
                {attentionCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </div>
  )
}
