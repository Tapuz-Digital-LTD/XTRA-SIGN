/**
 * The events a project's addresses can hear about, in the words the
 * settings screen uses. Data only, so the client screen and the server
 * share one list without the client pulling in server modules.
 */
export const PROJECT_EVENTS = [
  { key: 'new_registration', label: 'ספק חדש נרשם', immediate: true },
  { key: 'signed', label: 'הסכם נחתם', immediate: true },
  { key: 'send_failed', label: 'שליחה נכשלה', immediate: true },
  { key: 'unsigned_digest', label: 'תזכורת יומית להסכמים שלא נחתמו', immediate: false },
  { key: 'expiring_digest', label: 'הסכמים שעומדים לפוג', immediate: false },
] as const

export type ProjectEventKey = (typeof PROJECT_EVENTS)[number]['key']

export type SignerCopySettings = {
  enabled: boolean
  replyTo: string | null
  senderName: string | null
  /** A short line of the campaign's own under the standard copy. */
  note: string | null
  attachPdf: boolean
}

export type ProjectNotificationSettings = {
  emails: string[]
  events: Record<ProjectEventKey, boolean>
  signerCopy: SignerCopySettings
}
