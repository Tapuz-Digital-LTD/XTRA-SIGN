'use client'

import { DeleteDialog } from '@/components/deletion/DeleteDialog'
import { FollowUpSettings } from '@/components/follow-up/FollowUpSettings'
import { NotificationSettings } from '@/components/projects/NotificationSettings'
import { MessagesSettings } from '@/components/projects/MessagesSettings'
import { CampaignSettings, type CampaignSettingsValue } from '@/components/projects/CampaignSettings'
import { ShareSettings } from '@/components/projects/ShareSettings'
import { RegistrationTargetSetting } from '@/components/projects/RegistrationTargetSetting'
import { CampaignStatusSetting } from '@/components/projects/CampaignStatusSetting'
import type { ProjectNotificationSettings } from '@/lib/project-notifications'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FormBuilder } from '@/components/projects/FormBuilder'
import { PublishPanel } from '@/components/projects/PublishPanel'
import {
  SelfServiceSettings,
  type PublicSlugView,
  type OwnerOption,
} from '@/components/projects/SelfServiceSettings'
import type { ActiveAgreement } from '@/components/projects/AgreementPanel'
import type { LandingSettings } from '@/server/projects/landing'
import type { FormField } from '@/server/projects/form-schema'
import type { SelfServiceConfig } from '@/server/projects/self-service'

/**
 * A campaign's settings in five rooms, one open at a time: general, the
 * public page and registration, the messages recipients get, who on the
 * team is told, and the rarely-needed rest. The address bar remembers the
 * room (`section=`), so a link lands on the right one.
 */

export const SETTINGS_SECTIONS = [
  { key: 'general', label: 'כללי', blurb: 'שם, סוג, תאריכים, בעלים' },
  { key: 'page', label: 'עמוד והרשמה', blurb: 'כתובת, טופס, הטמעה, שיתוף, הסכם' },
  { key: 'messages', label: 'הודעות', blurb: 'מה הנמענים מקבלים' },
  { key: 'notifications', label: 'התראות', blurb: 'מי בצוות מקבל עדכון ומתי' },
  { key: 'advanced', label: 'מתקדם', blurb: 'מקורות מורשים, מחיקה' },
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['key']

const input = 'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-brand'
const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5'

export function ProjectSettings({
  projectId,
  projectName,
  projectDescription,
  landing,
  selfService,
  publicSlug,
  publicBase,
  agreement,
  owners,
  currentUserId,
  isAdmin,
  notifications,
  campaign,
  templates,
  setup,
  section: initialSection,
  registrantsNoun = 'ספקים',
}: {
  projectId: string
  projectName: string
  projectDescription: string | null
  landing: LandingSettings
  selfService: SelfServiceConfig
  publicSlug: PublicSlugView
  publicBase: string
  agreement: ActiveAgreement | null
  owners: OwnerOption[]
  currentUserId: string
  isAdmin: boolean
  notifications: ProjectNotificationSettings
  campaign: CampaignSettingsValue
  templates: { id: string; name: string }[]
  /** What the wizard asked to finish here, if anything. */
  setup?: string
  section?: string
  registrantsNoun?: 'ספקים' | 'לקוחות'
}) {
  const router = useRouter()
  const isSection = (s: string | undefined): s is SettingsSection => SETTINGS_SECTIONS.some((x) => x.key === s)
  const [section, setSection] = useState<SettingsSection>(isSection(initialSection) ? initialSection : setup ? 'page' : 'general')
  const [name, setName] = useState(projectName)
  const [description, setDescription] = useState(projectDescription ?? '')
  const [enabled, setEnabled] = useState(landing.enabled)
  const [title, setTitle] = useState(landing.config.title)
  const [about, setAbout] = useState(landing.config.description)
  const [successMessage, setSuccessMessage] = useState(landing.config.successMessage)
  const [fields, setFields] = useState<FormField[]>(landing.config.fields)
  const [allowedOrigins, setAllowedOrigins] = useState(landing.config.allowedOrigins.join('\n'))
  const [url, setUrl] = useState(landing.url)
  const [slug, setSlug] = useState(landing.slug)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [removing, setRemoving] = useState(false)

  function go(next: SettingsSection) {
    setSection(next)
    const params = new URLSearchParams(window.location.search)
    params.set('tab', 'settings')
    params.set('section', next)
    params.delete('setup')
    window.history.replaceState(null, '', `?${params.toString()}`)
  }

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      // The project's name travels through the existing rename action; the
      // landing settings through their own endpoint. One button, two writes.
      if (name.trim() !== projectName || (description || null) !== (projectDescription ?? null)) {
        const renamed = await fetch(`/api/groups/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rename', name: name.trim(), description: description || null }),
        })
        if (!renamed.ok) {
          const data = await renamed.json().catch(() => null)
          setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
          return
        }
      }

      const response = await fetch(`/api/projects/${projectId}/landing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          config: {
            title,
            description: about,
            successMessage,
            fields,
            allowedOrigins: allowedOrigins
              .split(/[\n,]/)
              .map((o) => o.trim())
              .filter(Boolean),
          },
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({ tone: 'error', text: data?.error?.message ?? 'השמירה נכשלה.' })
        return
      }
      setUrl(data.url ?? null)
      setSlug(data.slug ?? null)
      if (data.config?.fields) setFields(data.config.fields)
      setMessage({ tone: 'ok', text: 'ההגדרות נשמרו.' })
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'השמירה נכשלה. נסו שוב.' })
    } finally {
      setBusy(false)
    }
  }

  const saveBar = (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
        {busy ? 'שומר…' : 'שמירת ההגדרות'}
      </button>
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-green-200 bg-green-50 text-green-800'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  )

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {setup ? (
        <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {setup === 'self-service'
            ? 'הקמפיין נוצר. כדי להפעיל הרשמה וחתימה אוטומטית: בחרו את ההסכם ואת הבעלים בכרטיס "הרשמה וחתימה עצמאית", וחברו עמוד קמפיין או השתמשו בטופס הציבורי.'
            : setup === 'embed'
              ? 'הקמפיין נוצר והטופס הציבורי פעיל. קוד ההטמעה נמצא בכרטיס "פרסום והטמעה".'
              : setup === 'api'
                ? 'הקמפיין נוצר והטופס הציבורי פעיל. פרטי ה-API להגשת הרשמות נמצאים בכרטיס "פרסום והטמעה".'
                : setup === 'custom-page'
                  ? 'הקמפיין נוצר. דף קמפיין מותאם אישית נבנה על ידי מפתח, שמחבר אותו לקמפיין הזה.'
                  : 'הקמפיין נוצר והטופס הציבורי פעיל. הכתובת לשיתוף נמצאת בכרטיס "טופס ההצטרפות".'}
        </p>
      ) : null}

      <nav aria-label="חלקי ההגדרות" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => go(s.key)}
                aria-current={section === s.key ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition ${section === s.key ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-fg hover:border-brand'}`}
                title={s.blurb}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {section === 'general' ? (
        <>
          <section className={card}>
            <h2 className="text-base font-semibold text-fg">שם ותיאור</h2>
            <label className="mt-3 block text-sm">
              <span className="text-muted">שם הקמפיין</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-muted">תיאור (פנימי)</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
            </label>
            <div className="mt-4">{saveBar}</div>
          </section>
          <CampaignStatusSetting projectId={projectId} value={{ status: campaign.status, endedMessage: campaign.endedMessage, allowCompletionAfterEnd: campaign.allowCompletionAfterEnd }} publicUrl={publicSlug.current ? `${publicBase}/${publicSlug.current}` : null} isAdmin={isAdmin} />
          <CampaignSettings projectId={projectId} value={campaign} owners={owners} templates={templates} />
        </>
      ) : null}

      {section === 'page' ? (
        <>
          <SelfServiceSettings projectId={projectId} config={selfService} publicSlug={publicSlug} publicBase={publicBase} agreement={agreement} owners={owners} currentUserId={currentUserId} />
          <RegistrationTargetSetting projectId={projectId} value={campaign.registrationTarget} noun={registrantsNoun} />
          <ShareSettings projectId={projectId} campaignName={name} publicUrl={publicSlug.current ? `${publicBase}/${publicSlug.current}` : url} />
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">טופס הצטרפות</h2>
                <p className="mt-1 text-sm text-muted">
                  הטופס הציבורי שבו נרשמים משאירים פרטים.
                  {selfService.enabled ? ' כשההרשמה והחתימה העצמאית פעילות, עמוד הקמפיין משתמש בטופס שלו והטופס הזה לא מוצג.' : ''}
                </p>
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-5" />
                פעיל
              </label>
            </div>
            {url && enabled ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-bg px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-fg" dir="ltr">{url}</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                  }}
                  className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand"
                >
                  {copied ? 'הועתק ✓' : 'העתקת קישור'}
                </button>
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-fg transition hover:border-brand">פתיחה</a>
              </div>
            ) : null}
            <label className="mt-4 block text-sm">
              <span className="text-muted">כותרת הטופס</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-muted">הסבר קצר</span>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} placeholder="למשל: מלאו פרטים ונחזור אליכם עם הסכם ההתקשרות." className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
            </label>
            <label className="mt-3 block text-sm">
              <span className="text-muted">הודעת תודה אחרי שליחה</span>
              <input value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} className={input} />
            </label>
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-fg">שדות הטופס</h3>
              <p className="mt-0.5 text-xs text-muted">שדות פרטי העסק ממלאים את כרטיס הספק אוטומטית; שדות מותאמים נשמרים עם ההרשמה.</p>
              <div className="mt-3">
                <FormBuilder fields={fields} onChange={setFields} />
              </div>
            </div>
            <div className="mt-4">{saveBar}</div>
          </section>
          {slug && url ? (
            <section className={card}>
              <h2 className="text-base font-semibold text-fg">פרסום והטמעה</h2>
              <p className="mt-1 text-sm text-muted">אותו טופס, שלוש דרכים: הקישור, הטמעה באתר חיצוני, או שליחה ישירה מהאתר שלכם.</p>
              <div className="mt-3">
                <PublishPanel slug={slug} url={url} fields={fields} allowedOrigins={allowedOrigins} onOriginsChange={setAllowedOrigins} />
              </div>
            </section>
          ) : (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">אפשרויות ההטמעה וה-API יופיעו אחרי השמירה הראשונה של הטופס.</p>
          )}
        </>
      ) : null}

      {section === 'messages' ? <MessagesSettings projectId={projectId} /> : null}

      {section === 'notifications' ? <NotificationSettings projectId={projectId} settings={notifications} /> : null}

      {section === 'advanced' ? (
        <>
          <section className={card}>
            <h2 className="text-base font-semibold text-fg">מקורות מורשים להגשת הרשמות</h2>
            <p className="mt-1 text-sm text-muted">כתובות אתרים שמותר להן לשלוח את הטופס (הטמעה ו-API). ריק = כל אתר.</p>
            <textarea value={allowedOrigins} onChange={(e) => setAllowedOrigins(e.target.value)} rows={3} dir="ltr" placeholder="https://www.example.co.il" className="mt-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
            <div className="mt-4">{saveBar}</div>
          </section>
          <FollowUpSettings projectId={projectId} isAdmin={isAdmin} />
          <section className={`${card} border-red-200`}>
            <h2 className="text-base font-semibold text-fg">מחיקת הקמפיין</h2>
            <p className="mt-1 text-sm text-muted">קמפיין עם הסכמים חתומים עובר לארכיון ולא נמחק; ההיסטוריה נשמרת.</p>
            <button type="button" disabled={busy} onClick={() => setRemoving(true)} className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm text-red-700 transition hover:border-red-400 disabled:opacity-50">
              מחיקת הקמפיין
            </button>
          </section>
        </>
      ) : null}

      <DeleteDialog
        type="project"
        id={projectId}
        noun="פרויקט"
        isAdmin={isAdmin}
        open={removing}
        onClose={() => setRemoving(false)}
        onDone={(result) => {
          setRemoving(false)
          if (result.action === 'request' || result.action === 'restore') {
            setMessage({ tone: 'ok', text: result.message })
            return
          }
          router.push('/projects')
          router.refresh()
        }}
      />
    </div>
  )
}
