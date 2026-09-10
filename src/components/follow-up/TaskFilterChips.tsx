'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Three chips over the registrations: who has follow-up work waiting, whose
 * is being handled, whose is done. Counts come from the server so they are
 * right beyond the rows on screen; the chip is a link that sets `taskFilter`,
 * and the active one clears it. Nothing is drawn until the campaign has at
 * least one task. Plain words, because a campaign may have several tasks and
 * a chip counts them all.
 */

const CHIPS = [
  { key: 'pending', label: 'משימות ממתינות' },
  { key: 'in_progress', label: 'משימות בטיפול' },
  { key: 'done', label: 'משימות שבוצעו' },
] as const

type Counts = Record<(typeof CHIPS)[number]['key'] | 'not_needed', number>

export function TaskFilterChips({ projectId, version = 0 }: { projectId: string; version?: number }) {
  const params = useSearchParams()
  const active = params.get('taskFilter')
  const [counts, setCounts] = useState<Counts | null>(null)

  useEffect(() => {
    // A late answer for a screen that is gone is ignored, not aborted: an
    // aborted fetch shows up as a console error in development.
    let live = true
    fetch(`/api/projects/${projectId}/tasks?status=not_needed`)
      .then(async (r) => (r.ok ? ((await r.json()) as { counts?: Counts }) : null))
      .then((data) => {
        if (live) setCounts(data?.counts ?? null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [projectId, version])

  if (!counts || Object.values(counts).every((n) => n === 0)) return null

  const href = (key: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (key) next.set('taskFilter', key)
    else next.delete('taskFilter')
    return `?${next.toString()}`
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי מצב המשימות">
      {CHIPS.map((chip) => {
        const on = active === chip.key
        return (
          <Link
            key={chip.key}
            href={href(on ? null : chip.key)}
            scroll={false}
            aria-pressed={on}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition ${on ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg hover:border-brand'}`}
          >
            {chip.label}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-white/20' : 'bg-bg text-muted'}`}>{counts[chip.key]}</span>
          </Link>
        )
      })}
    </div>
  )
}
