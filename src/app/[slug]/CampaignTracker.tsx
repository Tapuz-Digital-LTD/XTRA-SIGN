'use client'

import { useEffect } from 'react'
import type { CampaignEventType } from '@/lib/campaign-events'
import { track } from './track'

/** Records one event when the page mounts — a page view, a thank-you seen. */
export function CampaignTracker({ formId, event, token }: { formId: string; event: CampaignEventType; token?: string }) {
  useEffect(() => {
    track(formId, event, { token })
  }, [formId, event, token])
  return null
}
