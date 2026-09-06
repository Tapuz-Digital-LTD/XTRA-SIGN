'use client'

import { useState } from 'react'
import { levelFor, PROTECTION_LEVELS, type CaptchaAdminView, type ProtectionLevel } from '@/lib/captcha'

/**
 * "אבטחת טפסים והתחברות": one switch, which doors, the Google account,
 * a connection test, a protection level — and advanced only for those who
 * open it. The credential is typed once and shown again only as its last
 * characters. Enabling requires a successful test of whatever is typed.
 */

const inputClass = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'
const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'

export function SecuritySettingsForm({ initial }: { initial: CaptchaAdminView }) {
  const [view, setView] = useState(initial)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [protectLogin, setProtectLogin] = useState(initial.protectLogin)
  const [protectPublicForms, setProtectPublicForms] = useState(initial.protectPublicForms)
  const [projectId, setProjectId] = useState(initial.projectId)
  const [siteKey, setSiteKey] = useState(initial.siteKey)
  const [apiKey, setApiKey] = useState('')
  const [replacingKey, setReplacingKey] = useState(!initial.apiKeyHint)
  const [level, setLevel] = useState<ProtectionLevel | 'custom'>(levelFor(initial.threshold))
  const [threshold, setThreshold] = useState(String(initial.threshold))
  const [advanced, setAdvanced] = useState(levelFor(initial.threshold) === 'custom')
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const credentialsChanged = projectId !== view.projectId || siteKey !== view.siteKey || apiKey.trim() !== ''
  const needsTest = enabled && credentialsChanged && !(tested?.ok)

  async function test() {
    setTesting(true)
    setTested(null)
    try {
      const response = await fetch('/api/security/captcha/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, siteKey, apiKey: apiKey || undefined }),
      })
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; error?: { message?: string } } | null
      setTested({ ok: Boolean(data?.ok), message: data?.message ?? data?.error?.message ?? (response.ok ? 'החיבור תקין.' : 'הבדיקה נכשלה.') })
    } catch {
      setTested({ ok: false, message: 'הבדיקה נכשלה. בדקו את החיבור לאינטרנט.' })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const chosen = level === 'custom' ? Number(threshold) : PROTECTION_LEVELS.find((l) => l.key === level)!.threshold
      const response = await fetch('/api/security/captcha', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, protectLogin, protectPublicForms, projectId, siteKey, apiKey: apiKey || undefined, threshold: chosen }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setView(data as CaptchaAdminView)
      setApiKey('')
      setReplacingKey(false)
      setTested(null)
      setMessage({ tone: 'ok', text: (data as CaptchaAdminView).enabled ? 'ההגדרות נשמרו. הגנת CAPTCHA פעילה.' : 'ההגדרות נשמרו. הגנת CAPTCHA כבויה.' })
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-fg">הגנת CAPTCHA</h2>
            <p className="mt-1 text-sm text-muted">מסננת שליחות אוטומטיות בהתחברות ובטפסים הציבוריים, ברקע וללא חידות. עובדת לצד הגבלות הקצב הקיימות.</p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
            <input type="checkbox" className="size-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            CAPTCHA פעיל
          </label>
        </div>
        {!enabled ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            כיבוי CAPTCHA מפחית את ההגנה מפני שליחות אוטומטיות וניצול לרעה.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">ספק</span>
            <select value="google_recaptcha_enterprise" disabled className={inputClass}>
              <option value="google_recaptcha_enterprise">Google reCAPTCHA Enterprise</option>
            </select>
          </label>
          <div className="text-sm">
            <span className="text-muted">איפה להגן</span>
            <div className="mt-1 flex flex-col gap-1">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-fg">
                <input type="checkbox" className="size-4" checked={protectLogin} onChange={(e) => setProtectLogin(e.target.checked)} />
                התחברות (לפני שליחת קוד)
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-fg">
                <input type="checkbox" className="size-4" checked={protectPublicForms} onChange={(e) => setProtectPublicForms(e.target.checked)} />
                טפסים ציבוריים והרשמה לקמפיינים
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">חשבון Google</h2>
        <p className="mt-1 text-sm text-muted">אפשר להחליף פרויקט או מפתחות בכל עת: מזינים, בודקים, ושומרים. ההגדרות הישנות נשארות בתוקף עד שהחדשות נבדקו ונשמרו.</p>
        {!view.secretsAvailable ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            השרת אינו מוגדר לשמירת מפתחות מוצפנים. יש להגדיר את משתנה הסביבה SIGN_SECRETS_KEY פעם אחת בסביבת ההרצה.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">Google Cloud Project ID</span>
            <input value={projectId} onChange={(e) => { setProjectId(e.target.value); setTested(null) }} dir="ltr" autoComplete="off" className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Site Key</span>
            <input value={siteKey} onChange={(e) => { setSiteKey(e.target.value); setTested(null) }} dir="ltr" autoComplete="off" className={inputClass} />
          </label>
          <div className="block text-sm sm:col-span-2">
            <span className="text-muted">API Key (אישור ליצירת Assessments)</span>
            {replacingKey ? (
              <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                <input
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTested(null) }}
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  placeholder={view.apiKeyHint ? 'הזינו מפתח חדש' : ''}
                  className="h-11 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand"
                />
                {view.apiKeyHint ? (
                  <button type="button" onClick={() => { setReplacingKey(false); setApiKey('') }} className={buttonClass}>
                    ביטול
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-11 flex-1 items-center rounded-lg border border-line bg-bg px-3 font-mono text-sm text-fg" dir="ltr">
                  {view.apiKeyHint}
                </span>
                <button type="button" onClick={() => setReplacingKey(true)} className={buttonClass}>
                  החלפת מפתח
                </button>
              </div>
            )}
            <span className="mt-1 block text-xs text-muted">המפתח נשמר מוצפן ואינו מוצג שוב. רשימת הדומיינים המורשים למפתח מנוהלת ב-Google Cloud, לא כאן.</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={testing || !projectId || !siteKey} onClick={() => void test()} className={buttonClass}>
            {testing ? 'בודק…' : 'בדיקת חיבור'}
          </button>
          {tested ? (
            <span role={tested.ok ? 'status' : 'alert'} className={`text-sm ${tested.ok ? 'text-green-700' : 'text-red-700'}`}>
              {tested.message}
            </span>
          ) : null}
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">הגנה</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {PROTECTION_LEVELS.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => { setLevel(l.key); setThreshold(String(l.threshold)) }}
              aria-pressed={level === l.key}
              className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition ${level === l.key ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg hover:border-brand'}`}
            >
              {l.label}
            </button>
          ))}
          {level === 'custom' ? <span className="inline-flex min-h-10 items-center rounded-full border border-brand px-4 text-sm text-fg">מותאם ({threshold})</span> : null}
        </div>
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="mt-3 text-xs text-muted hover:underline" aria-expanded={advanced}>
          הגדרות מתקדמות
        </button>
        {advanced ? (
          <label className="mt-2 block max-w-xs text-sm">
            <span className="text-muted">Score threshold (0–1)</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={threshold}
              onChange={(e) => { setThreshold(e.target.value); setLevel('custom') }}
              dir="ltr"
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-muted">בקשות עם ציון נמוך מהסף נדחות. Google ממליצה לכוון לפי הנתונים בפועל אחרי 48 שעות.</span>
          </label>
        ) : null}
      </section>

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm ${message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'}`}>
          {message.text}
        </p>
      ) : null}
      {needsTest ? <p className="text-xs text-muted">לפני הפעלה עם פרטים חדשים יש להריץ &quot;בדיקת חיבור&quot; מוצלחת.</p> : null}

      <div>
        <button
          type="button"
          disabled={busy || needsTest}
          onClick={() => void save()}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'שומר…' : enabled ? 'שמור והפעל' : 'שמירה'}
        </button>
      </div>
    </div>
  )
}
