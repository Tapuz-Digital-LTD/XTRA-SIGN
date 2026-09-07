'use client'

import { useRef, useState } from 'react'

/**
 * An email as a mail client would show it: the rendered HTML inside an
 * isolated frame at a real viewport width — a phone (375) or a desktop
 * reading pane (640) — sized to the whole message so there is no inner
 * scrollbar. The frame is `srcDoc` + a sandbox with no scripts, so nothing
 * in the mail can run, and nothing of the app (cookies, storage) is
 * reachable from it.
 */
export type MailDevice = 'desktop' | 'mobile'

export const DEVICE_WIDTH: Record<MailDevice, number> = { desktop: 640, mobile: 375 }

export function MailFrame({ html, device, title = 'תצוגה מקדימה של המייל' }: { html: string; device: MailDevice; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(560)
  const width = DEVICE_WIDTH[device]

  function fit() {
    const doc = ref.current?.contentDocument
    const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight
    if (h && h > 200) setHeight(Math.min(h + 24, 4000))
  }

  return (
    <div className="flex justify-center overflow-x-auto rounded-xl border border-line bg-slate-100 p-3 sm:p-5">
      <div
        className={`overflow-hidden bg-white shadow-md ${device === 'mobile' ? 'rounded-[28px] border-[8px] border-slate-800' : 'rounded-lg border border-slate-300'}`}
        style={{ width: width + (device === 'mobile' ? 16 : 2), maxWidth: '100%' }}
      >
        {device === 'mobile' ? <div className="mx-auto mt-2 h-1.5 w-20 rounded-full bg-slate-600" aria-hidden="true" /> : <div className="flex h-7 items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3" aria-hidden="true"><span className="size-2.5 rounded-full bg-slate-300" /><span className="size-2.5 rounded-full bg-slate-300" /><span className="size-2.5 rounded-full bg-slate-300" /></div>}
        <iframe
          ref={ref}
          key={`${device}-${html.length}`}
          title={title}
          srcDoc={html}
          // Same-origin only so the frame's height can be read; no scripts,
          // no forms, no top-navigation — the mail is a picture that lays out.
          sandbox="allow-same-origin"
          onLoad={fit}
          scrolling="no"
          style={{ width, maxWidth: '100%', height, border: 0, display: 'block', background: '#f3f4f6' }}
        />
      </div>
    </div>
  )
}

export function DeviceToggle({ device, onChange }: { device: MailDevice; onChange: (d: MailDevice) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="גודל תצוגה">
      {(['desktop', 'mobile'] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={device === d}
          className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition ${device === d ? 'border-fg bg-fg text-white' : 'border-line bg-surface text-fg hover:border-brand'}`}
        >
          {d === 'desktop' ? 'מחשב' : 'נייד'}
        </button>
      ))}
    </div>
  )
}
