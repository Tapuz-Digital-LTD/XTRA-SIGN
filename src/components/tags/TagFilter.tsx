'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Tag } from '@/server/tags/tags'

export type TagsMode = 'all' | 'any'

/**
 * Filter a list by tags. The choice lives in the URL — `tags=id1,id2` and
 * `tagsMode=all|any` — next to whatever else the screen keeps, so a filtered
 * list can be reloaded, shared and returned to.
 */
export function TagFilter({ tags, selected, mode }: { tags: Tag[]; selected: string[]; mode: TagsMode }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  if (tags.length === 0) return null

  const push = (ids: string[], nextMode: TagsMode) => {
    const next = new URLSearchParams(params.toString())
    if (ids.length > 0) next.set('tags', ids.join(','))
    else next.delete('tags')
    if (ids.length > 1 && nextMode === 'any') next.set('tagsMode', 'any')
    else next.delete('tagsMode')
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const toggle = (id: string) => push(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], mode)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="סינון לפי תגים">
      <span className="text-xs text-muted">תגים:</span>
      <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
        {tags.map((tag) => {
          const on = selected.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag.id)}
              className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm transition-colors ${on ? 'bg-brand text-white' : 'bg-surface text-muted hover:text-fg'}`}
            >
              <span className="max-w-40 truncate">{tag.name}</span>
            </button>
          )
        })}
      </div>
      {selected.length > 1 ? (
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label="איך לשלב תגים">
          {(
            [
              ['all', 'כל התגים'],
              ['any', 'אחד מהם'],
            ] as [TagsMode, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => push(selected, value)}
              className={`min-h-9 rounded-md px-3 text-xs transition ${mode === value ? 'bg-brand text-white' : 'text-muted hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {selected.length > 0 ? (
        <button type="button" onClick={() => push([], 'all')} className="min-h-9 text-xs text-brand underline-offset-4 hover:underline">
          ניקוי
        </button>
      ) : null}
    </div>
  )
}
