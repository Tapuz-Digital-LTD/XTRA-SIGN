'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { GOALS, type CampaignGoal } from '@/lib/campaigns'

/**
 * "קמפיין חדש" asks only what it must, in the words a person thinks:
 *
 *   1. What do you want to do?  — collect details from people / have
 *      people sign documents
 *   2. (signing only) Who signs? — people I choose / anyone who registers
 *      through a form
 *   3. A name, and for signing the agreement (or "later")
 *
 * Everything else — the audience, dates, how the form is embedded, the
 * words of every message, distributions — has a good default and lives
 * inside the campaign for whenever it is needed.
 */

export type WizardOwner = { id: string; name: string; email: string }
export type WizardTemplate = { id: string; name: string }

type Signers = 'audience' | 'form'

const primary = 'inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-5 text-base font-medium text-fg transition hover:border-brand disabled:opacity-50'
const input = 'mt-1 h-12 w-full rounded-xl border border-line bg-bg px-4 text-base text-fg outline-none focus:border-brand'
const bigCard = (on: boolean) => `flex min-h-28 w-full flex-col justify-center rounded-2xl border-2 p-5 text-start transition ${on ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`

export function NewCampaignWizard({ templates, autoOpen = false }: { owners?: WizardOwner[]; templates: WizardTemplate[]; currentUserId?: string; autoOpen?: boolean; customPageBound?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(autoOpen)
  const [goal, setGoal] = useState<CampaignGoal | null>(null)
  const [signers, setSigners] = useState<Signers | null>(null)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = goal === 'signing' ? ['מה תרצו לעשות?', 'מי חותם?', 'שם ומסמך'] : ['מה תרצו לעשות?', 'שם']
  const step = goal === null ? 0 : goal === 'signing' && signers === null ? 1 : steps.length - 1
  const entry = goal === 'inquiries' ? 'form' : signers === 'audience' ? 'audience' : 'form'
  const handling = goal === 'signing' && signers === 'form' ? 'auto_sign' : 'save'

  function reset() {
    setGoal(null)
    setSigners(null)
    setName('')
    setError(null)
  }

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, goal, entryMethod: entry, handling, templateId: goal === 'signing' && templateId ? templateId : undefined }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה נכשלה.')
        return
      }
      const next =
        goal === 'inquiries'
          ? `/projects/${data.id}?tab=settings&section=page&setup=form`
          : signers === 'form'
            ? templateId
              ? `/projects/${data.id}?tab=settings&section=page&setup=self-service`
              : `/projects/${data.id}?tab=settings&section=page&setup=agreement`
            : `/projects/${data.id}?tab=audience&setup=audience`
      router.push(next)
    } catch {
      setError('היצירה נכשלה. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={primary}>
        + קמפיין חדש
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="ncw-title" onClick={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="border-b border-line px-6 py-4">
          <h2 id="ncw-title" className="text-lg font-semibold text-fg">קמפיין חדש</h2>
          <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="שלבים">
            {steps.map((label, i) => (
              <li key={label} className={i === step ? 'font-semibold text-brand' : i < step ? 'text-fg' : 'text-muted'} aria-current={i === step ? 'step' : undefined}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-base text-fg">מה תרצו לעשות?</p>
              {GOALS.map((g) => (
                <button key={g.key} type="button" onClick={() => { setGoal(g.key); setSigners(null) }} aria-pressed={goal === g.key} className={bigCard(goal === g.key)}>
                  <span className="block text-lg font-semibold text-fg">{g.key === 'inquiries' ? 'לאסוף פרטים מאנשים' : 'להחתים אנשים על מסמכים'}</span>
                  <span className="mt-1 block text-base leading-relaxed text-muted">{g.blurb}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 1 && goal === 'signing' ? (
            <div className="flex flex-col gap-3">
              <p className="text-base text-fg">מי חותם?</p>
              <button type="button" onClick={() => setSigners('audience')} aria-pressed={signers === 'audience'} className={bigCard(signers === 'audience')}>
                <span className="block text-lg font-semibold text-fg">אנשים שאבחר</span>
                <span className="mt-1 block text-base leading-relaxed text-muted">ספקים או לקוחות מהמערכת או מה-CRM. כל אחד מקבל את ההסכם שלו לחתימה. בוחרים אותם אחר כך, בלשונית "קהל".</span>
              </button>
              <button type="button" onClick={() => setSigners('form')} aria-pressed={signers === 'form'} className={bigCard(signers === 'form')}>
                <span className="block text-lg font-semibold text-fg">כל מי שיירשם דרך טופס</span>
                <span className="mt-1 block text-base leading-relaxed text-muted">מי שממלא את הטופס נוצר כספק/לקוח, מקבל את ההסכם, מאמת טלפון וחותם — בלי שלב ידני.</span>
              </button>
            </div>
          ) : null}

          {step === steps.length - 1 && goal ? (
            <div className="flex flex-col gap-4">
              <label className="block text-base">
                <span className="text-fg">איך נקרא לקמפיין?</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={goal === 'inquiries' ? 'למשל: פניות ספקים 2027' : 'למשל: הסכמי ספקים 2027'} className={input} />
              </label>
              {goal === 'signing' ? (
                <label className="block text-base">
                  <span className="text-fg">איזה מסמך חותמים?</span>
                  {templates.length > 0 ? (
                    <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={input}>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                      <option value="">אעלה את המסמך אחר כך</option>
                    </select>
                  ) : (
                    <span className="mt-1 block rounded-xl border border-dashed border-line bg-bg px-4 py-3 text-base text-muted">עדיין אין מסמכים במערכת. אחרי היצירה תוכלו להעלות PDF של ההסכם מתוך הקמפיין.</span>
                  )}
                </label>
              ) : null}
              <p className="text-base leading-relaxed text-muted">
                {goal === 'inquiries'
                  ? 'תקבלו קישור לטופס מוכן לשיתוף. כל פנייה תופיע בקמפיין ותחכה לטיפול. אפשר גם להטמיע את הטופס באתר, לחבר דרך API או להפיץ ב-SMS ואימייל — הכול מתוך הקמפיין.'
                  : signers === 'form'
                    ? 'תקבלו קישור לטופס. כל מי שנרשם עובר ישירות לחתימה על המסמך ומקבל עותק חתום במייל.'
                    : 'אחרי היצירה בוחרים את האנשים בלשונית "קהל" ושולחים להם את המסמך לחתימה, כל אחד בנפרד.'}
              </p>
            </div>
          ) : null}

          {error ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-800">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={() => { setOpen(false); reset() }} className="text-base text-muted hover:underline">ביטול</button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button type="button" onClick={() => (step === 1 || goal === 'inquiries' ? setGoal(null) : setSigners(null))} className={secondary}>חזרה</button>
            ) : null}
            {step < steps.length - 1 ? (
              <button type="button" disabled={step === 0 ? goal === null : signers === null} onClick={() => { if (step === 0 && goal === 'inquiries') return; }} className={`${primary} ${step === 0 && goal === 'inquiries' ? 'hidden' : ''}`} aria-hidden={step === 0 && goal === 'inquiries'}>המשך</button>
            ) : (
              <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className={primary}>{busy ? 'יוצר…' : 'יצירת הקמפיין'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
