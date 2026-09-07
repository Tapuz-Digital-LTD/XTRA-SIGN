'use client'

import { useEffect, useRef, useState } from 'react'
import type { DeletionImpact, DeletionMode, EntityType } from '@/server/deletion/policy'

/**
 * The one conversation about removing something.
 *
 * Opens, asks the server what is behind the record, and says exactly what
 * will happen in the words a person uses: delete when nothing is behind
 * it; delete-and-cancel when unsigned work is; archive or ask an admin when
 * signed history is. An admin sees the protected removal with its summary
 * and has to say they understand the signed history stays. Never a
 * database word, never a guess — the policy on the server decides.
 */

export type Noun = 'ספק' | 'לקוח' | 'פרויקט' | 'תבנית' | 'הסכם' | 'הרשמה' | 'התראה'

type DialogProps = {
  type: EntityType
  id: string
  noun: Noun
  isAdmin: boolean
  open: boolean
  onClose: () => void
  /** Called after a successful action, with what happened. */
  onDone: (result: { action: DeletionMode | 'request' | 'purge'; message: string }) => void
}

type Impact = DeletionImpact & { isOwner?: boolean }

/** Each opening is a fresh conversation: the body is keyed on the record. */
export function DeleteDialog(props: DialogProps) {
  if (!props.open) return null
  return <DeleteDialogBody key={`${props.type}:${props.id}`} {...props} />
}

function DeleteDialogBody({ type, id, noun, isAdmin, open, onClose, onDone }: DialogProps) {
  const [impact, setImpact] = useState<Impact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'main' | 'protected' | 'purge'>('main')
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirm, setConfirm] = useState('')
  const firstButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    fetch(`/api/deletion?type=${type}&id=${id}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error?.message ?? 'לא הצלחנו לבדוק את הרשומה.')
        setImpact(data as Impact)
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setError(e instanceof Error ? e.message : 'לא הצלחנו לבדוק את הרשומה.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [open, type, id])

  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', escape)
    firstButton.current?.focus()
    return () => document.removeEventListener('keydown', escape)
  }, [open, onClose, impact])

  async function act(mode: DeletionMode | 'request' | 'purge') {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'purge' ? { type, id, mode, acknowledged: true, confirm: confirm.trim() } : { type, id, mode, acknowledged }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'הפעולה נכשלה.')
        return
      }
      onDone({ action: mode, message: data?.message ?? '' })
    } catch {
      setError('הפעולה נכשלה. בדקו את החיבור לאינטרנט.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const feminine = noun === 'תבנית' || noun === 'הרשמה' || noun === 'התראה'
  const the = `ה${noun}`
  const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition disabled:opacity-50'
  const secondary = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm text-fg transition hover:bg-slate-50 disabled:opacity-50'

  let title = `מחיקת ${noun}`
  let body: React.ReactNode = null
  let actions: React.ReactNode = null

  if (loading || (!impact && !error)) {
    body = <p className="text-sm text-muted">בודק מה עומד מאחורי הרשומה…</p>
  } else if (impact) {
    const signed = impact.signedAgreements
    const open = impact.openAgreements + impact.draftAgreements
    const crmNote = impact.crmLinked ? (
      <p className="mt-2 text-xs text-muted">{the} מקושר/ת ל-Fireberry. הפעולה משפיעה על XTRA Sign בלבד; ברשומה ב-CRM לא ישתנה דבר.</p>
    ) : null
    const deps = impact.dependentRecords.length > 0 ? (
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        {impact.dependentRecords.map((d) => (
          <li key={d.label}>
            {d.label}: {d.count}
          </li>
        ))}
      </ul>
    ) : null

    const purgeButton = impact.isOwner ? (
      <button type="button" disabled={busy} onClick={() => setStage('purge')} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50">
        מחיקה מלאה
      </button>
    ) : null

    if (stage === 'purge') {
      title = 'מחיקה מלאה — לצמיתות'
      body = (
        <>
          <p className="text-sm font-medium text-fg">{impact.name}</p>
          <p className="mt-2 text-sm text-fg">
            {the} {feminine ? 'תימחק' : 'יימחק'} לצמיתות יחד עם כל מה ששייך {feminine ? 'לה' : 'לו'}: הסכמים, קבצים חתומים, היסטוריית חתימות, הרשמות והודעות. אין ארכיון ואין דרך חזרה.
          </p>
          <p className="mt-1 text-xs text-muted">אפשרות זו שמורה לבעלי הארגון בלבד ונרשמת ביומן הביקורת.</p>
          {deps}
          {crmNote}
          <label className="mt-3 block text-sm">
            <span className="text-muted">לאישור, הקלידו כאן את המילה <strong className="text-fg">מחק</strong></span>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-fg outline-none focus:border-red-400" aria-label="הקלידו מחק לאישור" />
          </label>
        </>
      )
      actions = (
        <>
          <button type="button" onClick={() => setStage('main')} className={secondary}>
            חזרה
          </button>
          <button ref={firstButton} type="button" disabled={busy || confirm.trim() !== 'מחק'} onClick={() => void act('purge')} className={`${primary} bg-danger hover:opacity-90`}>
            {busy ? 'מוחק לצמיתות…' : 'מחק לצמיתות'}
          </button>
        </>
      )
    } else if (impact.recommendedAction === 'keep') {
      title = 'הרשומה נשמרת'
      body = <p className="text-sm text-fg">{impact.keepReason}</p>
      actions = (
        <>
          <button ref={firstButton} type="button" onClick={onClose} className={secondary}>
            סגירה
          </button>
          {purgeButton}
        </>
      )
    } else if (impact.archived && impact.recommendedAction !== 'delete') {
      title = `${the} בארכיון`
      body = (
        <>
          <p className="text-sm text-fg">{impact.name}</p>
          <p className="mt-1 text-sm text-muted">אפשר להחזיר {the} לרשימות הפעילות{isAdmin && impact.requiresAdmin ? ', או להסיר במחיקה מוגנת' : ''}.</p>
          {crmNote}
        </>
      )
      actions = (
        <>
          <button type="button" onClick={onClose} className={secondary}>
            ביטול
          </button>
          <button ref={firstButton} type="button" disabled={busy} onClick={() => void act('restore')} className={`${primary} bg-brand hover:opacity-90`}>
            החזרה מהארכיון
          </button>
          {isAdmin && impact.requiresAdmin ? (
            <button type="button" disabled={busy} onClick={() => setStage('protected')} className={secondary}>
              מחיקה מוגנת
            </button>
          ) : null}
          {purgeButton}
        </>
      )
    } else if (stage === 'protected') {
      title = 'מחיקה מוגנת'
      body = (
        <>
          <p className="text-sm text-fg">
            {the} {feminine ? 'תוסר' : 'יוסר'} מהרשימות הפעילות. {signed} הסכמים חתומים ו-{signed} קבצי PDF יישמרו לצורכי היסטוריה ומעקב, יחד עם
            היסטוריית החתימות.
          </p>
          {crmNote}
          <label className="mt-3 flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-0.5 size-4" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            אני מבין/ה שההיסטוריה החתומה תישמר
          </label>
        </>
      )
      actions = (
        <>
          <button type="button" onClick={() => setStage('main')} className={secondary}>
            חזרה
          </button>
          <button ref={firstButton} type="button" disabled={busy || !acknowledged} onClick={() => void act('protected')} className={`${primary} bg-danger hover:opacity-90`}>
            {busy ? 'מסיר…' : `הסר ${noun}`}
          </button>
        </>
      )
    } else if (impact.requiresAdmin) {
      title = isAdmin ? 'לא ניתן למחוק את הרשומה במחיקה רגילה' : 'נדרש אישור מנהל'
      body = (
        <>
          <p className="text-sm font-medium text-fg">{impact.name}</p>
          <p className="mt-2 text-sm text-fg">
            לרשומה זו קיימת היסטוריה חתומה ולכן לא ניתן למחוק אותה באופן רגיל. ניתן להסיר אותה מהרשימות הפעילות תוך שמירת המסמכים
            והיסטוריית החתימות{isAdmin ? ', או לבצע מחיקה מוגנת' : ', או לבקש אישור מנהל מערכת'}.
          </p>
          <p className="mt-2 text-xs text-muted">
            {signed} הסכמים חתומים{open > 0 ? ` · ${open} הסכמים פתוחים` : ''}
          </p>
          {deps}
          {crmNote}
        </>
      )
      actions = (
        <>
          <button type="button" onClick={onClose} className={secondary}>
            ביטול
          </button>
          <button ref={firstButton} type="button" disabled={busy} onClick={() => void act('archive')} className={`${primary} bg-brand hover:opacity-90`}>
            {busy ? 'רגע…' : 'העבר לארכיון'}
          </button>
          {isAdmin ? (
            <button type="button" disabled={busy} onClick={() => setStage('protected')} className={secondary}>
              מחיקה מוגנת
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void act('request')} className={secondary}>
              בקשת מחיקת מנהל
            </button>
          )}
          {purgeButton}
        </>
      )
    } else if (impact.recommendedAction === 'delete_with_cancel') {
      title = `מחיקת ${noun}`
      body = (
        <>
          <p className="text-sm font-medium text-fg">{impact.name}</p>
          <p className="mt-2 text-sm text-fg">
            ל{noun} {feminine ? 'זו' : 'זה'} קיימים {open} הסכמים שעדיין לא נחתמו.
          </p>
          <p className="mt-1 text-sm text-fg">
            מחיקה תבטל אותם ותסיר {the} מהמערכת. קישורי החתימה שלהם יפסיקו לעבוד.
          </p>
          {deps}
          {crmNote}
        </>
      )
      actions = (
        <>
          <button ref={firstButton} type="button" onClick={onClose} className={secondary}>
            ביטול
          </button>
          <button type="button" disabled={busy} onClick={() => void act('delete')} className={`${primary} bg-danger hover:opacity-90`}>
            {busy ? 'מוחק…' : `מחק ${noun} ובטל הסכמים`}
          </button>
          {purgeButton}
        </>
      )
    } else if (impact.recommendedAction === 'archive') {
      // History that is not signed — finished agreements, a template already used.
      title = type === 'template' ? 'הסרת תבנית' : `העברת ${noun} לארכיון`
      body = (
        <>
          <p className="text-sm font-medium text-fg">{impact.name}</p>
          <p className="mt-2 text-sm text-fg">
            {type === 'template'
              ? 'התבנית כבר שימשה ליצירת הסכמים. היא תוסר מרשימת התבניות, וההסכמים שנוצרו ממנה ימשיכו לעבוד כרגיל.'
              : `ל${noun} ${feminine ? 'זו' : 'זה'} יש היסטוריה של הסכמים שהסתיימו. ${the} ${feminine ? 'תועבר' : 'יועבר'} לארכיון וההסכמים יישמרו.`}
          </p>
          {deps}
          {crmNote}
        </>
      )
      actions = (
        <>
          <button ref={firstButton} type="button" onClick={onClose} className={secondary}>
            ביטול
          </button>
          <button type="button" disabled={busy} onClick={() => void act(type === 'template' ? 'delete' : 'archive')} className={`${primary} bg-brand hover:opacity-90`}>
            {busy ? 'רגע…' : type === 'template' ? 'הסר מהרשימה' : 'העבר לארכיון'}
          </button>
          {purgeButton}
        </>
      )
    } else {
      title = `למחוק את ${the}?`
      body = (
        <>
          <p className="text-sm font-medium text-fg">{impact.name}</p>
          <p className="mt-2 text-sm text-fg">
            {the} {feminine ? 'תוסר' : 'יוסר'} מהמערכת ולא ניתן יהיה לשחזר {feminine ? 'אותה' : 'אותו'}.
          </p>
          {deps}
          {crmNote}
        </>
      )
      actions = (
        <>
          <button ref={firstButton} type="button" onClick={onClose} className={secondary}>
            ביטול
          </button>
          <button type="button" disabled={busy} onClick={() => void act('delete')} className={`${primary} bg-danger hover:opacity-90`}>
            {busy ? 'מוחק…' : 'מחק'}
          </button>
          {purgeButton}
        </>
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-dialog-title" className="text-base font-semibold text-fg">
          {title}
        </h2>
        <div className="mt-3">{body}</div>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {actions ?? (
            <button ref={firstButton} type="button" onClick={onClose} className={secondary}>
              סגירה
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
