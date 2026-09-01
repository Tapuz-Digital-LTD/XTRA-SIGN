import Link from 'next/link'

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string
  description: string
  actionLabel: string
  actionHref: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{description}</p>
      <Link
        href={actionHref}
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
      >
        {actionLabel}
      </Link>
    </div>
  )
}
