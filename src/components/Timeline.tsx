/** Internal event names never reach the screen. Anything unmapped is skipped. */
const LABELS: Record<string, string> = {
  created: 'נוצר',
  document_generated: 'המסמך הוכן',
  document_generation_failed: 'הכנת המסמך נכשלה',
  sent: 'נשלח',
  email_sent: 'נשלח באימייל',
  sms_sent: 'נשלח ב-SMS',
  whatsapp_share_opened: 'שותף ב-WhatsApp',
  viewed: 'נצפה',
  otp_sent: 'נשלח קוד אימות',
  otp_verified: 'הטלפון אומת',
  field_completed: 'מולא שדה',
  signature_applied: 'נחתם',
  completed: 'הושלם',
  declined: 'נדחה',
  canceled: 'בוטל',
  expired: 'פג תוקף',
  reminder_sent: 'נשלחה תזכורת',
  new_version_created: 'נוצרה גרסה חדשה',
}

const formatter = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function Timeline({ events }: { events: { type: string; createdAt: Date }[] }) {
  const visible = events.filter((event) => LABELS[event.type])

  if (visible.length === 0) {
    return <p className="mt-2 text-sm text-muted">אין עדיין אירועים.</p>
  }

  return (
    <ol className="mt-3 flex flex-col gap-2.5">
      {visible.map((event, index) => (
        <li key={index} className="flex items-baseline gap-2 text-sm">
          <span aria-hidden="true" className="text-[var(--status-success)]">
            ✓
          </span>
          <span className="text-fg">{LABELS[event.type]}</span>
          <time dateTime={event.createdAt.toISOString()} className="ms-auto text-xs text-muted">
            {formatter.format(event.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}
