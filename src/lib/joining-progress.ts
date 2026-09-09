/**
 * One answer, everywhere, to "where is this supplier and what do I do next?".
 *
 * The screens never re-decide this. They take the evidence the database
 * actually holds — a submitted form, a created agreement, an accepted send, a
 * code request, a verified phone, an opened link, a signature — and get back a
 * headline in business words, one explaining sentence, a short secondary line
 * for a table row, the next thing a person can do, and the step list for a
 * drawer.
 *
 * Two rules the whole file exists to keep:
 *   1. A step is shown as done only when a row proves it. Nothing is inferred:
 *      an opened link does not mean a verified code, and a code that was sent
 *      does not mean it was typed.
 *   2. "נשלח" means the message left XTRA Sign to the provider. It never means
 *      "נמסר" — no delivery receipt reaches this system, and no screen may
 *      claim one.
 */

export type ProgressStepKey = 'invited' | 'invitation_opened' | 'form' | 'agreement' | 'link_sent' | 'code_sent' | 'code_verified' | 'link_opened' | 'signed'

/** Timestamps, and only timestamps: each one is a row that exists. */
export type ProgressEvidence = {
  /** A personal invitation was created for this person. */
  invitedAt?: string | null
  /**
   * The campaign page was opened through this person's own invitation link
   * (a campaign event carrying its id). Absent when nobody clicked, and
   * absent for anyone who reached the page some other way — never inferred
   * from a message having been sent.
   */
  invitationOpenedAt?: string | null
  /** The join form was submitted (form_snapshot). */
  submittedAt?: string | null
  agreementCreatedAt?: string | null
  /** The provider accepted a link message. Never proof it reached a handset. */
  linkSentAt?: string | null
  /** The last link message the provider refused. */
  linkSendFailedAt?: string | null
  /** A verification code was requested for this signer. */
  codeSentAt?: string | null
  /** The signer typed the right code (recipients.verified_at). */
  codeVerifiedAt?: string | null
  /** The signing page was opened (audit 'viewed'). */
  linkOpenedAt?: string | null
  signedAt?: string | null
  agreementStatus?: string | null
  leadStatus?: string | null
}

export type ProgressStep = { key: ProgressStepKey; label: string; at: string | null; done: boolean; note: string | null }

export type JoiningProgress = {
  /** The business state, in the words a person would use. */
  headline: string
  /** One sentence saying what that means. */
  explain: string
  /** The last proven step, for a table row. Null when the status says it all. */
  secondary: string | null
  /** What this person can do about it now. Null when nothing is needed. */
  next: string | null
  tone: 'pending' | 'success' | 'danger' | 'neutral'
  steps: ProgressStep[]
}

const STEP_LABELS: Record<ProgressStepKey, string> = {
  invited: 'נשלחה הזמנה אישית',
  invitation_opened: 'הקישור האישי נפתח',
  form: 'הפרטים התקבלו',
  agreement: 'ההסכם נוצר',
  link_sent: 'קישור לחתימה נשלח',
  code_sent: 'קוד אימות נשלח',
  code_verified: 'קוד האימות אומת',
  link_opened: 'הקישור להסכם נפתח',
  signed: 'החתימה הושלמה',
}

/** What each step means, and what it deliberately does not mean. */
const STEP_NOTES: Partial<Record<ProgressStepKey, string>> = {
  link_sent: 'יצא מהמערכת. אישור מסירה למכשיר אינו זמין.',
  code_sent: 'יצא מהמערכת. אישור מסירה למכשיר אינו זמין.',
  code_verified: 'הספק הזין את הקוד שנשלח לנייד שלו.',
  link_opened: 'ההסכם נפתח בדפדפן של הספק.',
  invitation_opened: 'דף הקמפיין נפתח מהקישור האישי שנשלח.',
}

const CLOSED = new Set(['signed', 'declined', 'canceled', 'expired'])

export function joiningProgress(e: ProgressEvidence): JoiningProgress {
  const status = e.agreementStatus ?? null
  const signedAt = e.signedAt ?? null
  const openAgreement = status === 'sent' || status === 'viewed' || status === 'draft'
  const sendFailedOnly = Boolean(e.linkSendFailedAt) && !e.linkSentAt

  const steps: ProgressStep[] = []
  const push = (key: ProgressStepKey, at: string | null | undefined, when = true) => {
    if (!when) return
    steps.push({ key, label: STEP_LABELS[key], at: at ?? null, done: Boolean(at), note: at ? (STEP_NOTES[key] ?? null) : null })
  }
  push('invited', e.invitedAt, Boolean(e.invitedAt))
  // Shown to anyone who was invited: not knowing whether they opened it is
  // itself the answer a worker needs, so the step stays, undone.
  push('invitation_opened', e.invitationOpenedAt, Boolean(e.invitedAt))
  push('form', e.submittedAt, Boolean(e.submittedAt) || Boolean(e.agreementCreatedAt))
  push('agreement', e.agreementCreatedAt, Boolean(e.agreementCreatedAt) || Boolean(e.submittedAt))
  push('link_sent', e.linkSentAt, Boolean(e.agreementCreatedAt) || Boolean(e.linkSentAt))
  push('code_sent', e.codeSentAt, Boolean(e.agreementCreatedAt) || Boolean(e.codeSentAt))
  push('code_verified', e.codeVerifiedAt, Boolean(e.agreementCreatedAt) || Boolean(e.codeVerifiedAt))
  push('link_opened', e.linkOpenedAt, Boolean(e.linkOpenedAt))
  push('signed', signedAt, Boolean(e.agreementCreatedAt) || Boolean(signedAt))

  // Finished, or finished badly: the state is the whole story.
  if (signedAt || status === 'signed') {
    return { headline: 'ההצטרפות הושלמה', explain: 'הספק חתם על ההסכם. הקמת המוצר באתר היא משימה נפרדת.', secondary: null, next: null, tone: 'success', steps }
  }
  if (status === 'declined') {
    return { headline: 'הספק סירב לחתום', explain: 'הספק פתח את ההסכם ובחר לא לחתום עליו.', secondary: 'סורב', next: 'אפשר לברר טלפונית מה חסר לו.', tone: 'danger', steps }
  }
  if (status === 'canceled') {
    return { headline: 'ההסכם בוטל', explain: 'ההסכם שנוצר לספק בוטל, ואין קישור פעיל לחתימה.', secondary: 'בוטל', next: 'אפשר לשלוח הסכם חדש.', tone: 'neutral', steps }
  }
  if (status === 'expired') {
    return { headline: 'פג תוקף הקישור', explain: 'הספק לא השלים את החתימה בזמן, והקישור שקיבל אינו בתוקף.', secondary: 'פג תוקף · טרם הושלמה חתימה', next: 'שלחו קישור חדש לחתימה.', tone: 'danger', steps }
  }
  if (e.leadStatus === 'failed' || e.leadStatus === 'rejected') {
    return { headline: 'ההרשמה לא הושלמה', explain: 'הפרטים נשמרו, אך ההסכם לא נוצר עבור הספק.', secondary: 'ההרשמה נכשלה', next: 'צרו קשר עם הספק ובקשו להירשם שוב.', tone: 'danger', steps }
  }

  // Invited and nothing more. Whether they opened the link is the one thing
  // that changes what a worker should do next, so it leads the line.
  if (!e.submittedAt && !e.agreementCreatedAt) {
    const opened = Boolean(e.invitationOpenedAt)
    return {
      headline: opened ? 'הקישור נפתח, טרם נרשם' : 'הוזמן, טרם נרשם',
      explain: opened
        ? 'הספק פתח את הקישור האישי וראה את דף הקמפיין, אך עדיין לא מילא את טופס ההצטרפות.'
        : 'נשלחה הזמנה אישית. הספק עדיין לא מילא את טופס ההצטרפות.',
      secondary: opened
        ? 'הקישור נפתח · טרם נרשם'
        : e.linkSentAt
          ? 'הזמנה נשלחה · אין נתון על פתיחה'
          : sendFailedOnly
            ? 'שליחת ההזמנה נכשלה'
            : 'ההזמנה טרם נשלחה',
      next: sendFailedOnly ? 'בדקו את הטלפון או המייל ושלחו שוב.' : opened ? 'הוא כבר ראה את הדף — שיחה עכשיו היא הצעד הטוב ביותר.' : 'אפשר לשלוח תזכורת או להתקשר.',
      tone: sendFailedOnly ? 'danger' : 'pending',
      steps,
    }
  }

  // Registered, but no agreement was created for them.
  if (!e.agreementCreatedAt) {
    return { headline: 'נרשם, ההסכם טרם נוצר', explain: 'הפרטים התקבלו, אך עדיין לא נוצר הסכם לחתימה עבור הספק.', secondary: 'הפרטים התקבלו', next: 'שלחו לו הסכם לחתימה.', tone: 'pending', steps }
  }

  // The live case: an agreement is open and waiting for the signature.
  const explain = 'הספק מילא את הפרטים, אך עדיין לא השלים את החתימה על ההסכם.'
  const base = { headline: 'ממתין להשלמת חתימה', explain, tone: 'pending' as const, steps }
  if (sendFailedOnly) return { ...base, secondary: 'שליחת הקישור נכשלה', next: 'תקנו את הטלפון או המייל ושלחו את הקישור שוב.', tone: 'danger' }
  if (e.codeVerifiedAt) return { ...base, secondary: 'קוד אומת · טרם הושלמה חתימה', next: 'הספק אומת אך לא סיים לחתום. שיחה קצרה בדרך כלל סוגרת את זה.' }
  if (e.linkOpenedAt) return { ...base, secondary: 'קישור נפתח · טרם הושלמה חתימה', next: 'הספק פתח את ההסכם ולא הזין קוד אימות. אפשר להתקשר או לשלוח את הקישור שוב.' }
  if (e.codeSentAt && e.linkSentAt) return { ...base, secondary: 'קישור וקוד נשלחו · טרם נפתח', next: 'אפשר לשלוח תזכורת או להתקשר.' }
  if (e.codeSentAt) return { ...base, secondary: 'קוד אימות נשלח · טרם אומת', next: 'אפשר לשלוח את הקישור לחתימה שוב.' }
  if (e.linkSentAt) return { ...base, secondary: 'קישור נשלח · טרם נפתח', next: 'אפשר לשלוח תזכורת או להתקשר.' }
  return { ...base, secondary: 'ההסכם נוצר · הקישור טרם נשלח', next: 'שלחו לספק את הקישור לחתימה.' }
}

/** True while a person can still act on this row. */
export const progressIsOpen = (status: string | null | undefined) => !status || !CLOSED.has(status)
