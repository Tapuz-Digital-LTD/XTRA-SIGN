'use client'

import { UTM_KEYS, type CampaignEventType } from '@/lib/campaign-events'

/**
 * First-party campaign analytics from the browser's side.
 *
 * A visit id is minted once per browser and kept in localStorage — random,
 * opaque, meaning nothing to anyone. Every event carries it, the address the
 * page was reached at, the campaign tags on the URL and the referring host.
 * Sent with `keepalive` so a click that navigates away still lands. Never
 * awaited by the page: analytics must not slow down a person joining.
 */

const KEY = 'xs_visit'

export function visitId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing && /^[A-Za-z0-9_-]{10,40}$/.test(existing)) return existing
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('')
    localStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    // Storage blocked: a per-page id still de-duplicates within the page.
    return (window as unknown as { __xsVisit?: string }).__xsVisit ??= Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 8)
  }
}

export function track(formId: string, type: CampaignEventType, extra: { token?: string } = {}) {
  try {
    const params = new URLSearchParams(window.location.search)
    const utm: Record<string, string> = {}
    for (const key of UTM_KEYS) {
      const value = params.get(key)
      if (value) utm[key] = value.slice(0, 120)
    }
    const inv = params.get('xs_inv')
    const body = JSON.stringify({
      type,
      visitId: visitId(),
      // The personal invitation this visit came through, when the link had one.
      inv: inv && /^[0-9a-f-]{36}$/i.test(inv) ? inv : null,
      path: window.location.pathname.slice(0, 200),
      utm,
      referrer: document.referrer ? document.referrer.slice(0, 500) : null,
      token: extra.token ?? null,
    })
    void fetch(`/api/self-service/${formId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Analytics never surfaces as an error.
  }
}
