'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AFTER_REGISTRATION_OPTIONS, CAMPAIGN_KINDS, JOIN_METHODS, type AfterRegistration, type CampaignKind, type JoinMethod } from '@/lib/campaigns'

/**
 * "קמפיין חדש" in three short steps: what you want to do, the name and
 * dates, and one kind-specific question — how people join (public) or who
 * signs what (signatures). Creating works at once; nothing needs editing
 * before the campaign is usable.
 */

export type WizardOwner = { id: string; name: string; email: string }
export type WizardTemplate = { id: string; name: string }

type Company = { id: string; name: string; kind: 'supplier' | 'customer'; taxId: string | null; fromCrm?: boolean; contactPhone?: string | null; contactEmail?: string | null }

const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'

export function NewCampaignWizard({
  owners,
  templates,
  currentUserId,
  autoOpen = false,
  customPageBound = false,
}: {
  owners: WizardOwner[]
  templates: WizardTemplate[]
  currentUserId: string
  autoOpen?: boolean
  /** True when a developer already bound a bespoke page to some campaign. */
  customPageBound?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(autoOpen)
  const [step, setStep] = useState(1)
  const [kind, setKind] = useState<CampaignKind | null>(null)
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [ownerUserId, setOwnerUserId] = useState(currentUserId)
  const [joinMethod, setJoinMethod] = useState<JoinMethod>('form')
  const [after, setAfter] = useState<AfterRegistration>('save')
  const [audienceKind, setAudienceKind] = useState<'supplier' | 'customer'>('supplier')
  const [audienceSource, setAudienceSource] = useState<'all' | 'crm' | 'xtra'>('all')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Company[]>([])
  const [chosen, setChosen] = useState<Map<string, Company>>(new Map())
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || kind !== 'signature' || step !== 3) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/companies?kind=${audienceKind}&q=${encodeURIComponent(query)}&limit=50${audienceSource === 'all' ? '' : `&source=${audienceSource}`}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { companies: [] }))
        .then((data: { companies?: Company[] } | Company[]) => setResults(Array.isArray(data) ? data : (data.companies ?? [])))
        .catch(() => {})
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, kind, step, audienceKind, audienceSource, query])

  function reset() {
    setStep(1)
    setKind(null)
    setName('')
    setStartsAt('')
    setEndsAt('')
    setChosen(new Map())
    setError(null)
  }

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          kind: kind === 'public' ? 'supplier' : audienceKind,
          campaignKind: kind,
          startsAt: startsAt || undefined,
          endsAt: endsAt || undefined,
          ownerUserId: ownerUserId || undefined,
          defaultTemplateId: kind === 'signature' && templateId ? templateId : undefined,
          joinMethod: kind === 'public' ? joinMethod : undefined,
          companyIds: kind === 'signature' ? [...chosen.keys()] : undefined,
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'היצירה נכשלה.')
        return
      }
      const next =
        kind === 'public'
          ? after === 'auto_sign'
            ? `/projects/${data.id}?tab=settings&setup=self-service`
            : joinMethod === 'custom'
              ? `/projects/${data.id}?tab=settings&setup=custom-page`
              : `/projects/${data.id}?tab=settings&setup=${joinMethod}`
          : `/projects/${data.id}`
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

  const validCount = [...chosen.values()].filter((c) => c.contactPhone || c.contactEmail).length
  const canContinue = step === 1 ? kind !== null : step === 2 ? name.trim().length > 0 && (!startsAt || !endsAt || endsAt >= startsAt) : true

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ncw-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 id="ncw-title" className="text-base font-semibold text-fg">קמפיין חדש</h2>
          <ol className="mt-2 flex gap-4 text-xs" aria-label="שלבים">
            {['מה רוצים לעשות?', 'פרטים', kind === 'public' ? 'איך מצטרפים' : 'למי ומה'].map((label, i) => (
              <li key={label} className={i + 1 === step ? 'font-semibold text-brand' : i + 1 < step ? 'text-fg' : 'text-muted'} aria-current={i + 1 === step ? 'step' : undefined}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 1 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {CAMPAIGN_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(k.key)}
                  aria-pressed={kind === k.key}
                  className={`rounded-xl border p-4 text-start transition ${kind === k.key ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`}
                >
                  <span className="text-2xl" aria-hidden="true">{k.key === 'public' ? '📣' : '✍️'}</span>
                  <span className="mt-2 block text-base font-semibold text-fg">{k.label}</span>
                  <span className="mt-1 block text-sm text-muted">{k.blurb}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3">
              <label className="block text-sm">
                <span className="text-muted">
                  שם הקמפיין <span className="text-red-700">*</span>
                </span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={kind === 'public' ? 'למשל: חודש התיירות הישראלית 2026' : 'למשל: הסכמי ספקים 2027'} className={input} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">תאריך התחלה (רשות)</span>
                  <input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={input} />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">תאריך סיום (רשות)</span>
                  <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} min={startsAt || undefined} className={input} />
                </label>
              </div>
              {kind === 'public' && endsAt ? <p className="text-xs text-muted">בתאריך הסיום ההרשמה נסגרת אוטומטית; אפשר לשנות זאת אחר כך בהגדרות.</p> : null}
              <label className="block text-sm">
                <span className="text-muted">בעלים</span>
                {owners.length > 0 ? (
                  <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className={input}>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · {o.email}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value="אני" readOnly className={input} />
                )}
              </label>
            </div>
          ) : null}

          {step === 3 && kind === 'public' ? (
            <div className="flex flex-col gap-4">
              <fieldset>
                <legend className="text-sm font-medium text-fg">איך אנשים יצטרפו?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {JOIN_METHODS.map((m) => (
                    <label key={m.key} className={`flex cursor-pointer flex-col rounded-xl border p-3 transition ${joinMethod === m.key ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`}>
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <input type="radio" name="join" className="size-4" checked={joinMethod === m.key} onChange={() => setJoinMethod(m.key)} />
                        {m.label}
                      </span>
                      <span className="mt-1 text-xs text-muted">{m.blurb}</span>
                      {m.key === 'custom' && customPageBound ? <span className="mt-1 text-xs text-green-700">עמוד קמפיין כבר מחובר לקמפיין אחר; קמפיין נוסף דורש חיבור על ידי מפתח.</span> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium text-fg">לאחר הרשמה</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {AFTER_REGISTRATION_OPTIONS.map((o) => (
                    <label key={o.key} className={`flex cursor-pointer flex-col rounded-xl border p-3 transition ${after === o.key ? 'border-brand bg-blue-50' : 'border-line bg-bg hover:border-brand'}`}>
                      <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <input type="radio" name="after" className="size-4" checked={after === o.key} onChange={() => setAfter(o.key)} />
                        {o.label}
                      </span>
                      <span className="mt-1 text-xs text-muted">{o.blurb}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 3 && kind === 'signature' ? (
            <div className="flex flex-col gap-4">
              <fieldset>
                <legend className="text-sm font-medium text-fg">מאיפה לבחור נמענים?</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['supplier', 'customer'] as const).map((k) => (
                    <button key={k} type="button" onClick={() => { setAudienceKind(k); setChosen(new Map()) }} aria-pressed={audienceKind === k} className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${audienceKind === k ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg'}`}>
                      {k === 'supplier' ? 'ספקים' : 'לקוחות'}
                    </button>
                  ))}
                  <span className="inline-flex min-h-10 items-center rounded-full border border-dashed border-line px-4 text-sm text-muted" title="קובץ נטען בשלב ההפצה, ונשאר נמעני ההפצה בלבד">
                    Excel / CSV — בהפצה
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">מקור:</span>
                  {(['all', 'crm', 'xtra'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setAudienceSource(s)} aria-pressed={audienceSource === s} className={`inline-flex min-h-8 items-center rounded-full border px-3 font-medium ${audienceSource === s ? 'border-fg bg-fg text-white' : 'border-line bg-surface text-fg'}`}>
                      {s === 'all' ? 'הכול' : s === 'crm' ? 'CRM' : 'XTRA Sign'}
                    </button>
                  ))}
                  <span className="text-muted">רשומות ה-CRM מסונכרנות מקומית מ-Fireberry; הבחירה לא משנה דבר ב-CRM.</span>
                </div>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש לפי שם, ח.פ., טלפון או אימייל" className={input} aria-label="חיפוש" />
                <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line">
                  {results.map((c) => (
                    <li key={c.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm text-fg hover:bg-bg">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={chosen.has(c.id)}
                          onChange={(e) => {
                            const next = new Map(chosen)
                            if (e.target.checked) next.set(c.id, c)
                            else next.delete(c.id)
                            setChosen(next)
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {c.fromCrm ? <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">CRM</span> : null}
                        {c.taxId ? <span className="text-xs text-muted" dir="ltr">{c.taxId}</span> : null}
                      </label>
                    </li>
                  ))}
                  {results.length === 0 ? <li className="px-3 py-3 text-sm text-muted">לא נמצאו תוצאות. אפשר להוסיף נמענים גם אחר כך, מלשונית "קהל".</li> : null}
                </ul>
                <p className="mt-2 text-xs text-muted">{chosen.size} נבחרו{chosen.size > 0 ? ` · ${validCount} עם טלפון או אימייל` : ''}</p>
              </fieldset>
              <label className="block text-sm">
                <span className="text-muted">ההסכם לחתימה</span>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={input}>
                  <option value="">— לבחור בהמשך —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {chosen.size > 0 && validCount < chosen.size ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  ל-{chosen.size - validCount} מהנבחרים חסר טלפון או אימייל — ניתן להשלים בכרטיס הספק לפני השליחה.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={() => { setOpen(false); reset() }} className="text-sm text-muted hover:underline">
            ביטול
          </button>
          <div className="flex gap-2">
            {step > 1 ? (
              <button type="button" onClick={() => setStep(step - 1)} className={secondary}>
                חזרה
              </button>
            ) : null}
            {step < 3 ? (
              <button type="button" disabled={!canContinue} onClick={() => setStep(step + 1)} className={primary}>
                המשך
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void create()} className={primary}>
                {busy ? 'יוצר…' : 'יצירת הקמפיין'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
