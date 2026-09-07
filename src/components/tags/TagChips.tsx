import type { Tag } from '@/server/tags/tags'

/** A company's tags, compact: the first few and "+N" for the rest; all of them on hover. */
export function TagChips({ tags, max = 2, className = '' }: { tags: Tag[]; max?: number; className?: string }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const rest = tags.length - shown.length
  return (
    <span className={`inline-flex max-w-full flex-wrap items-center gap-1 ${className}`} title={tags.map((t) => t.name).join(', ')}>
      {shown.map((tag) => (
        <span key={tag.id} className="inline-flex max-w-32 truncate rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {tag.name}
        </span>
      ))}
      {rest > 0 ? <span className="text-xs text-muted">+{rest}</span> : null}
    </span>
  )
}
