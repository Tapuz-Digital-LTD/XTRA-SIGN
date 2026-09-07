'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { REGISTRATION_TARGETS, type RegistrationTarget } from '@/lib/campaigns'

/**
 * "שמירת נרשמים": one question with two answers. XTRA Sign (the default)
 * keeps registrants here and never looks at the CRM; CRM tries to find the
 * synced company by tax id and links the registration to it, without
 * touching anything in the CRM. Saved on its own, the moment it changes.
 */
export function RegistrationTargetSetting({ projectId, value, noun }: { projectId: string; value: RegistrationTarget; noun: 'ספקים' | 'לקוחות' }) {
  const router = useRouter()
  const [current, setCurrent] = useState<RegistrationTarget>(value)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function choose(next: RegistrationTarget) {
    if (next === current || busy) return
    const previous = current
    setCurrent(next)
    setBusy(true)
    setMsg(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/campaign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationTarget: next }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setCurrent(previous)
        setMsg({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setMsg({ tone: 'ok', text: 'נשמר. חל על הרשמות חדשות בלבד.' })
      router.refresh()
    } catch {
      setCurrent(previous)
      setMsg({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">שמירת נרשמים</h2>
      <p className="mt-1 text-sm text-muted">היכן לשמור {noun} שנרשמים דרך הקמפיין?</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="שמירת נרשמים">
        {REGISTRATION_TARGETS.map((t) => (
          <label key={t.key} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ${current === t.key ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`}>
            <input type="radio" name="registration-target" className="mt-1 size-4" checked={current === t.key} disabled={busy} onChange={() => void choose(t.key)} />
            <span>
              <span className="block text-base font-semibold text-fg">{t.label}{t.key === 'xtra_sign' ? ' — ברירת מחדל' : ''}</span>
              {current === t.key ? <span className="mt-1 block text-sm leading-relaxed text-muted">{t.blurb(noun)}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {msg ? <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{msg.text}</p> : null}
    </section>
  )
}
