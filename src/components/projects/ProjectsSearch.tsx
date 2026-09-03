'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Search over the projects list. As-you-type, debounced into the URL — same
 * behaviour as the suppliers screen, so a filtered view can be linked and
 * reloaded.
 */
export function ProjectsSearch({ search, archived }: { search: string; archived: boolean }) {
  const router = useRouter()
  const [value, setValue] = useState(search)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const t = setTimeout(() => {
      const query = new URLSearchParams()
      if (archived) query.set('view', 'archive')
      if (value.trim()) query.set('q', value.trim())
      router.push(`/projects${query.toString() ? `?${query}` : ''}`)
    }, 300)
    return () => clearTimeout(t)
  }, [value, archived, router])

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">⌕</span>
      <label htmlFor="project-search" className="sr-only">חיפוש פרויקטים</label>
      <input
        id="project-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="חיפוש פרויקט"
        className="min-h-11 w-full rounded-lg border border-line bg-surface pe-9 ps-3 text-sm text-fg outline-none focus:border-brand"
      />
    </div>
  )
}
