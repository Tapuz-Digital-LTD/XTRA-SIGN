import { toIsraeliNationalFormat } from '@/lib/phone'
import type { Channel, DeliveryResult, NotificationProvider, OutboundMessage } from './types'

/**
 * InforU client, shared by the SMS and Email providers.
 *
 * Shape taken from the working integration in XtraGiftCard-NestApp
 * (`utilities/inforu/inforu.service.ts`, `smb/sms/smb-sms.service.ts`) and
 * confirmed against https://apidoc.inforu.co.il — same host, same single
 * `Authorization` header, same `StatusId === 1` success contract on every
 * endpoint.
 *
 * Two things the original lacked and this adds: a retry with backoff, and the
 * provider's RequestId returned to the caller so a Delivery row can carry it.
 */

const SMS_PATH = '/v2/SMS/SendSms'
const EMAIL_PATH = '/Umail/Message/Send'

/**
 * A send that never returns used to hang its caller indefinitely in the
 * original. Kept generous enough for a slow provider, short enough that a stuck
 * call cannot outlive the request that triggered it.
 */
const TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [500, 2000]

type InforuResponse = {
  StatusId?: number
  StatusDescription?: string
  DetailedDescription?: string
  RequestId?: string
}

function credentials() {
  return {
    baseUrl: process.env.INFORU_API_URL?.replace(/\/+$/, '') ?? '',
    auth: process.env.BASE_CREDENTIALS ?? '',
  }
}

export function inforuIsConfigured(): boolean {
  const { baseUrl, auth } = credentials()
  return Boolean(baseUrl && auth)
}

/** True when the deployment is told to log messages instead of sending them. */
export function logOnlyMode(): boolean {
  return process.env.SIGN_LOG_NOTIFICATIONS === 'true'
}

/**
 * POSTs to InforU and normalises every outcome into a DeliveryResult.
 *
 * Never throws: a failed notification must not roll back the agreement that
 * was already created. The caller decides what a delivery failure means.
 */
async function post(path: string, body: unknown): Promise<DeliveryResult> {
  const { baseUrl, auth } = credentials()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: auth,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      // 4xx is our bug or a rejected recipient — retrying sends the same bad
      // request again. Only server-side and transport failures are retried.
      if (!response.ok && response.status < 500) {
        return {
          ok: false,
          error: `InforU ${response.status} ${response.statusText}`,
          providerMessageId: null,
        }
      }

      if (response.ok) {
        const data = (await response.json()) as InforuResponse
        if (data.StatusId === 1) {
          return { ok: true, providerMessageId: data.RequestId ?? null }
        }
        // A non-1 StatusId is a definitive rejection, not a transient fault.
        return {
          ok: false,
          error: `InforU StatusId=${data.StatusId} ${data.StatusDescription ?? ''}`.trim(),
          providerMessageId: data.RequestId ?? null,
        }
      }
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'InforU request failed',
          providerMessageId: null,
        }
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]))
    }
  }

  return { ok: false, error: 'InforU unreachable', providerMessageId: null }
}

/**
 * Shared by both providers: in log-only mode, or with no credentials, print the
 * message and report it as NOT sent.
 *
 * Returning ok:false here is the whole point. The original logged and returned
 * true, which makes a dev environment look like a working one — the UI then
 * shows "נשלח" for a message that never left the process.
 */
function logInstead(channel: Channel, to: string, text: string): DeliveryResult {
  const reason = logOnlyMode() ? 'SIGN_LOG_NOTIFICATIONS=true' : 'InforU credentials missing'
  console.warn(`[${channel}] not sent (${reason}) → ${to}: ${text}`)
  return { ok: false, error: `not_sent:${reason}`, providerMessageId: null }
}

export class InforuSmsProvider implements NotificationProvider {
  readonly channel = 'sms' as const

  isConfigured() {
    return inforuIsConfigured() && !logOnlyMode()
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const phone = toIsraeliNationalFormat(message.to)
    if (!phone) {
      return { ok: false, error: 'invalid_phone', providerMessageId: null }
    }

    if (!this.isConfigured()) return logInstead('sms', phone, message.text)

    return post(SMS_PATH, {
      Data: {
        Message: message.text,
        Recipients: [{ Phone: phone }],
        Settings: { Sender: process.env.SIGN_SMS_SENDER ?? 'Xtra' },
      },
    })
  }
}

export class InforuEmailProvider implements NotificationProvider {
  readonly channel = 'email' as const

  isConfigured() {
    return inforuIsConfigured() && !logOnlyMode()
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) return logInstead('email', message.to, message.text)

    // CampaignName must be unique per send; InforU derives CampaignRefId from it.
    const campaignName = `xtra-sign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return post(EMAIL_PATH, {
      CampaignName: campaignName,
      CampaignRefId: campaignName.replace(/-/g, ' '),
      FromAddress: process.env.SIGN_EMAIL_SENDER ?? 'services@xtra.co.il',
      FromName: process.env.SIGN_EMAIL_SENDER_NAME ?? 'XTRA',
      Subject: message.subject ?? '',
      Body: message.html ?? message.text,
      IncludeContacts: [{ Email: message.to, FirstName: message.recipientName ?? '' }],
    })
  }
}
