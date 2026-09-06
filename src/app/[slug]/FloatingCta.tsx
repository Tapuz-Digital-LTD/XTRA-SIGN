'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * The call to action that follows the reader.
 *
 * A pill in the campaign's cyan, fixed to the bottom of the screen on a
 * phone and to the bottom-start corner on a desktop. It steps aside when the
 * artwork's own signpost is on screen, so the page never shows the same
 * button twice, and it never covers anything: the page keeps bottom room for
 * it (tourism.css, .tl-page).
 */
export function FloatingCta({ href, watch }: { href: string; watch: string }) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const target = document.querySelector(watch)
    if (!target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => setHidden(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.2 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [watch])

  return (
    <Link href={href} className={`tl-float${hidden ? ' tl-float-hidden' : ''}`} aria-hidden={hidden} tabIndex={hidden ? -1 : 0}>
      <span>מכאן מצטרפים</span>
      <span aria-hidden="true" className="tl-float-arrow">
        ←
      </span>
    </Link>
  )
}
