/**
 * A date the way a person would say it.
 *
 * "נחתם היום 16:22" carries more than a timestamp does: the reader learns what
 * happened and when in one glance, which is the whole point of having a single
 * date column instead of five.
 */
const time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' })
const shortDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })

/** Event names in the past tense, for the ones worth naming. */
const EVENT_TEXT: Record<string, string> = {
  created: 'נוצר',
  sent: 'נשלח',
  viewed: 'נצפה',
  otp_verified: 'אומת',
  signature_applied: 'נחתם',
  completed: 'נחתם',
  declined: 'נדחה',
  canceled: 'בוטל',
  expired: 'פג תוקף',
  reminder_sent: 'נשלחה תזכורת',
  email_failed: 'שליחה נכשלה',
  sms_failed: 'שליחה נכשלה',
  company_linked: 'שויך',
  new_version_created: 'נוצרה גרסה',
}

/**
 * Formats against a caller-supplied "now" so a server render and the value a
 * test asserts cannot drift apart.
 */
export function describeActivity(at: Date, eventType: string | null, now: Date = new Date()): string {
  const label = eventType ? EVENT_TEXT[eventType] : null
  const elapsed = now.getTime() - at.getTime()
  const sameDay = at.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  let when: string
  if (elapsed < 60_000) when = 'הרגע'
  else if (elapsed < 3_600_000) {
    const minutes = Math.floor(elapsed / 60_000)
    when = minutes === 1 ? 'לפני דקה' : `לפני ${minutes} דקות`
  } else if (sameDay) when = `היום ${time.format(at)}`
  else if (at.toDateString() === yesterday.toDateString()) when = `אתמול ${time.format(at)}`
  else if (at.getFullYear() === now.getFullYear()) when = shortDate.format(at)
  else when = fullDate.format(at)

  return label ? `${label} ${when}` : when
}
