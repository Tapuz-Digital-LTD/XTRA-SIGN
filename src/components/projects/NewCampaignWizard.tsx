'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CampaignComparison } from '@/components/projects/CampaignComparison'
import { AUDIENCE_KINDS, ENTRY_METHODS, GOALS, audienceLabel, hasForm, type AudienceKind, type CampaignGoal, type EntryMethod } from '@/lib/campaigns'

/**
 * "קמפיין חדש": four short questions, each with a good default.
 *
 *   1. What do you want to do?   — collect details / have people sign
 *   2. Who is it for?            — suppliers / customers / both
 *   3. How do people come in?    — only the entries that fit the goal,
 *                                  the usual one preselected
 *   4. Details                   — a name, and for signing the agreement
 *
 * "Who signs" is the entry: people we choose, or strangers through a form
 * who then register and sign on their own (that is `handling`). Everything
 * else — dates, the words of every message, distributions — has a default
 * and lives inside the campaign.
 */

export type WizardOwner = { id: string; name: string; email: string }
export type WizardTemplate = { id: string; name: string }

const STEPS = ['מטרה', 'קהל', 'כניסה', 'פרטים']
const DEFAULT_ENTRY: Record<CampaignGoal, EntryMethod> = { inquiries: 'form', signing: 'audience' }

const primary = 'inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-base font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-5 text-base font-medium text-fg transition hover:border-brand disabled:opacity-50'
const input = 'mt-1 h-12 w-full rounded-xl border border-line bg-bg px-4 text-base text-fg outline-none focus:border-brand'
const card = (on: boolean, tall = false) => `flex ${tall ? 'min-h-28' : 'min-h-16'} w-full flex-col justify-center rounded-2xl border-2 px-5 py-3 text-start transition ${on ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`

export function NewCampaignWizard({ templates, autoOpen = false }: { owners?: WizardOwner[]; templates: WizardTemplate[]; currentUserId?: string; autoOpen?: boolean; customPageBound?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(autoOpen)
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState<CampaignGoal | null>(null)
  const [audience, setAudience] = useState<AudienceKind | null>(null)
  const [entry, setEntry] = useState<EntryMethod>('form')
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kind = audience === 'both' ? null : audience
  const handling = goal === 'signing' && hasForm(entry) ? 'auto_sign' : 'save'
  const canContinue = step === 0 ? goal !== null : step === 1 ? audience !== null : true

  function pickGoal(next: CampaignGoal) {
    if (next !== goal) setEntry(DEFAULT_ENTRY[next])
    setGoal(next)
    setStep(1)
  }

  function reset() {
    setStep(0)
    setGoal(null)
    setAudience(null)
    setEntry('form')
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
        body: JSON.stringify({ name, goal, kind, entryMethod: entry, handling, templateId: goal === 'signing' && templateId ? templateId : undefined }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה נכשלה.')
        return
      }
      const next =
        goal === 'inquiries'
          ? `/projects/${data.id}?tab=settings&section=page&setup=form`
          : hasForm(entry)
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
            {STEPS.map((label, i) => (
              <li key={label} className={i === step ? 'font-semibold text-brand' : i < step ? 'text-fg' : 'text-muted'} aria-current={i === step ? 'step' : undefined}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-lg font-semibold text-fg">מה תרצו לעשות?</p>
              {GOALS.map((g) => (
                <button key={g.key} type="button" onClick={() => pickGoal(g.key)} aria-pressed={goal === g.key} className={card(goal === g.key, true)}>
                  <span className="block text-lg font-semibold text-fg">{g.key === 'inquiries' ? 'איסוף פניות (לידים)' : 'להחתים אנשים על מסמכים'}</span>
                  <span className="mt-1 block text-base leading-relaxed text-muted">{g.blurb}</span>
                </button>
              ))}
              <CampaignComparison />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-3">
              <p className="text-lg font-semibold text-fg">למי הקמפיין מיועד?</p>
              <div role="radiogroup" aria-label="למי הקמפיין מיועד?" className="grid gap-3 sm:grid-cols-3">
                {AUDIENCE_KINDS.map((a) => (
                  <button key={a.key} type="button" role="radio" aria-checked={audience === a.key} onClick={() => setAudience(a.key)} className={card(audience === a.key)}>
                    <span className="block text-lg font-semibold text-fg">{a.label}</span>
                  </button>
                ))}
              </div>
              {audience === 'both' ? <p className="text-base leading-relaxed text-muted">בכל הזמנה או הרשמה תבחרו אם זה ספק או לקוח</p> : null}
            </div>
          ) : null}

          {step === 2 && goal ? (
            <div className="flex flex-col gap-3">
              <p className="text-lg font-semibold text-fg">איך אנשים ייכנסו לקמפיין?</p>
              <div role="radiogroup" aria-label="איך אנשים ייכנסו לקמפיין?" className="flex flex-col gap-3">
                {ENTRY_METHODS.filter((m) => m.goals.includes(goal)).map((m) => (
                  <button key={m.key} type="button" role="radio" aria-checked={entry === m.key} onClick={() => setEntry(m.key)} className={card(entry === m.key)}>
                    <span className="block text-base font-semibold text-fg">{m.key === 'audience' ? `בחירת ${audienceLabel(kind)} קיימים` : m.label}</span>
                    <span className="mt-0.5 block text-base leading-relaxed text-muted">{m.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === 3 && goal ? (
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
                  : hasForm(entry)
                    ? 'תקבלו קישור לטופס. כל מי שנרשם עובר ישירות לחתימה על המסמך ומקבל עותק חתום במייל.'
                    : 'אחרי היצירה בוחרים את האנשים בלשונית "קהל" ושולחים להם את המסמך לחתימה, כל אחד בנפרד.'}
              </p>
            </div>
          ) : null}

          {error ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-800">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={() => { setOpen(false); reset() }} className="min-h-11 text-base text-muted hover:underline">ביטול</button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button type="button" onClick={() => setStep(step - 1)} className={secondary}>חזרה</button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <button type="button" disabled={!canContinue} onClick={() => setStep(step + 1)} className={primary}>המשך</button>
            ) : (
              <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className={primary}>{busy ? 'יוצר…' : 'יצירת הקמפיין'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
