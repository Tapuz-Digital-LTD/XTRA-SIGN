'use client'

import { useEffect } from 'react'

const key = () => `scroll:${location.pathname}${location.search}`

/**
 * Remembers how far down a list the user was, per URL, and puts them back
 * there when the same URL is shown again — after "חזרה" from a card, or the
 * browser's back. sessionStorage: this tab only, gone when it closes.
 */
export function ScrollRestore() {
  useEffect(() => {
    // Restore in a passive effect: the router's own scroll-to-top runs in the
    // layout phase, so this lands after it.
    try {
      const saved = Number(sessionStorage.getItem(key()))
      if (saved > 0) window.scrollTo(0, saved)
    } catch {
      // Storage blocked: nothing to restore.
    }

    const save = () => {
      try {
        sessionStorage.setItem(key(), String(Math.round(window.scrollY)))
      } catch {
        // Storage blocked: the position is simply not kept.
      }
    }
    let timer: number | null = null
    const onScroll = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        save()
      }, 150)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      if (timer !== null) clearTimeout(timer)
      save()
    }
  }, [])
  return null
}
