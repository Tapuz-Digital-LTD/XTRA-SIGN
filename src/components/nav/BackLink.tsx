import Link from 'next/link'
import { describeReturn } from '@/lib/return-to'

/**
 * "→ חזרה ל…" at the top of a card: back to the screen it was opened from,
 * with that screen's state, or to the card's own list when there is none.
 * `returnTo` is the page's `?returnTo=` after `readReturnTo`, never the raw value.
 */
export function BackLink({ returnTo, fallback }: { returnTo: string | null | undefined; fallback: string }) {
  const href = returnTo || fallback
  return (
    <div className="mb-4">
      <Link href={href} data-back-link className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
        → {describeReturn(href)}
      </Link>
    </div>
  )
}
