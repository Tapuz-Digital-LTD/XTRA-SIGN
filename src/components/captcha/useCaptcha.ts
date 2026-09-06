'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { CaptchaAction, CaptchaPublicConfig } from '@/lib/captcha'

/**
 * A token for one protected action, minted the moment the person submits.
 *
 * reCAPTCHA Enterprise's script is loaded only when the door is guarded;
 * `getToken` runs `grecaptcha.enterprise.execute` with the action and hands
 * back the single-use token (the docs: it expires after two minutes, so it
 * is never made at page load). When the script cannot load or execute, the
 * token is null and the server refuses — fail-secure, never a silent skip.
 */

declare global {
  interface Window {
    grecaptcha?: { enterprise: { ready: (cb: () => void) => void; execute: (siteKey: string, options: { action: string }) => Promise<string> } }
  }
}

const SCRIPT_ID = 'recaptcha-enterprise'

export function useCaptcha(config: CaptchaPublicConfig | null | undefined) {
  const enabled = Boolean(config?.enabled && config.siteKey)
  const siteKey = config?.siteKey ?? null
  const loading = useRef<Promise<void> | null>(null)

  const load = useCallback((): Promise<void> => {
    if (!enabled || !siteKey) return Promise.resolve()
    if (window.grecaptcha?.enterprise) return Promise.resolve()
    if (loading.current) return loading.current
    loading.current = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
      if (existing) {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error('captcha script')))
        return
      }
      const script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('captcha script'))
      document.head.appendChild(script)
    })
    return loading.current
  }, [enabled, siteKey])

  // Warm the script early so the first submit does not wait for it.
  useEffect(() => {
    if (enabled) void load().catch(() => {})
  }, [enabled, load])

  const getToken = useCallback(
    async (action: CaptchaAction): Promise<string | null> => {
      if (!enabled || !siteKey) return null
      try {
        await load()
        const g = window.grecaptcha?.enterprise
        if (!g) return null
        await new Promise<void>((resolve) => g.ready(resolve))
        return await g.execute(siteKey, { action })
      } catch {
        return null
      }
    },
    [enabled, siteKey, load],
  )

  return { enabled, getToken }
}
