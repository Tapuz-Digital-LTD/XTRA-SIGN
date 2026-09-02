'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Guards against losing unsaved work in an editor.
 *
 * Two layers, because a browser only lets you influence one of them:
 *
 *   - Leaving the site entirely (refresh, tab close, the browser's own Back out
 *     of the app) → the native `beforeunload` prompt. Its wording is fixed by
 *     the browser; all we control is whether it appears.
 *   - Navigating inside the app (our own buttons, and browser Back within the
 *     SPA) → our own Hebrew modal, so the choice is clear and in context.
 *
 * `dirty` must reflect only genuinely unsaved document changes — never zoom, an
 * open panel or a page change. After a successful save it goes false and both
 * guards fall silent.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // Native prompt for leaving the site.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      // Some engines still read the returnValue; harmless where they do not.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Browser Back inside the SPA: hold the user on the page and offer the modal.
  useEffect(() => {
    if (!dirty) return
    // A sentinel entry so the first Back pops this instead of leaving.
    history.pushState(null, '', window.location.href)
    const onPop = () => {
      if (!dirtyRef.current) return
      history.pushState(null, '', window.location.href)
      setPending('__back__')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [dirty])

  /** Wrap an internal navigation: goes straight through when clean. */
  const navigate = useCallback(
    (href: string) => {
      if (!dirtyRef.current) {
        router.push(href)
        return
      }
      setPending(href)
    },
    [router],
  )

  const stay = useCallback(() => setPending(null), [])
  const leave = useCallback(() => {
    const href = pending
    setPending(null)
    if (href && href !== '__back__') router.push(href)
    else router.back()
  }, [pending, router])

  const modal = pending ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-base font-semibold text-fg">יש לך שינויים שלא נשמרו</h2>
        <p className="mt-2 text-sm text-muted">אם תצא/י עכשיו, השינויים האחרונים שביצעת יאבדו.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={stay}
            autoFocus
            className="min-h-11 rounded-lg bg-brand text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            להישאר בעריכה
          </button>
          <button
            type="button"
            onClick={leave}
            className="min-h-11 rounded-lg border border-line bg-white text-sm text-danger hover:bg-red-50"
          >
            לצאת בלי לשמור
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { navigate, modal }
}
