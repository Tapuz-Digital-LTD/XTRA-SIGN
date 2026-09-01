/**
 * WhatsApp is a CLIENT-SIDE SHARE, not a send.
 *
 * There is no WhatsApp Business API, no InforU WhatsApp endpoint, no approved
 * TemplateId and no credentials involved. The button hands the user a prefilled
 * message; the user picks the contact and presses send inside WhatsApp.
 *
 * Consequences enforced elsewhere and restated here so nobody "fixes" it later:
 *   - No Delivery row is created for WhatsApp. A Delivery asserts a provider
 *     accepted a message; nothing here can assert that.
 *   - The audit event is `whatsapp_share_opened` — the share sheet opened. It
 *     is NOT evidence the recipient received anything.
 *   - The UI must never render WhatsApp as "נשלח".
 */

export type WhatsAppShareInput = {
  recipientName: string
  signingLink: string
  /** Optional: prefills the chat when we already know the number. */
  phoneE164?: string | null
}

/**
 * Default body. Kept short because WhatsApp truncates the preview, and the link
 * has to survive the fold.
 */
export function buildShareMessage({ recipientName, signingLink }: WhatsAppShareInput): string {
  const greeting = recipientName.trim() ? `שלום ${recipientName.trim()},` : 'שלום,'
  return `${greeting}\nמחכה לך מסמך לחתימה מ-XTRA:\n${signingLink}`
}

/**
 * `https://wa.me/...` — the one link that works on iOS, Android and desktop
 * WhatsApp Web alike. `api.whatsapp.com` and the `whatsapp://` scheme each fail
 * on one of the three, so this is the only form used.
 *
 * With a phone number the chat opens directly on that contact; without one
 * WhatsApp shows the contact picker, which is the behaviour we want when the
 * sender wants to forward the link somewhere else.
 */
export function buildWhatsAppShareUrl(input: WhatsAppShareInput): string {
  const text = encodeURIComponent(buildShareMessage(input))
  // wa.me wants digits only — no '+', no separators.
  const digits = input.phoneE164?.replace(/\D/g, '') ?? ''
  return digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`
}
