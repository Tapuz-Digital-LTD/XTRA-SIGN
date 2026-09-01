/**
 * Delivery channels the system actually *sends* on.
 *
 * WhatsApp is deliberately absent: it is a client-side share, not a send. The
 * system can only know that a share sheet was opened, never that a message was
 * delivered, so it must not produce a Delivery record that claims otherwise.
 * See `whatsapp-share.ts`.
 */
export type Channel = 'email' | 'sms'

export type OutboundMessage = {
  to: string
  /** SMS body, or email plain-text fallback. */
  text: string
  /** Email only. */
  subject?: string
  /** Email only; when absent the provider sends `text` as the body. */
  html?: string
  recipientName?: string
}

export type DeliveryResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; providerMessageId: string | null }

export interface NotificationProvider {
  readonly channel: Channel
  /**
   * False when credentials are absent. Callers surface this to the UI rather
   * than pretending a message went out.
   */
  isConfigured(): boolean
  send(message: OutboundMessage): Promise<DeliveryResult>
}
