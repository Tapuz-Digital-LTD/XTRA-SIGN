/**
 * The CAPTCHA contract shared by the pages and the server: which actions
 * exist, what the browser is told, what the admin can set. Nothing here
 * knows how Google works.
 */

export const CAPTCHA_ACTIONS = {
  LOGIN_OTP: 'LOGIN_OTP',
  PUBLIC_FORM_SUBMIT: 'PUBLIC_FORM_SUBMIT',
  CAMPAIGN_REGISTRATION: 'CAMPAIGN_REGISTRATION',
} as const

export type CaptchaAction = (typeof CAPTCHA_ACTIONS)[keyof typeof CAPTCHA_ACTIONS]

/** Which door an action guards; the admin switches doors, not actions. */
export type CaptchaSurface = 'login' | 'public_forms'

export const SURFACE_OF: Record<CaptchaAction, CaptchaSurface> = {
  LOGIN_OTP: 'login',
  PUBLIC_FORM_SUBMIT: 'public_forms',
  CAMPAIGN_REGISTRATION: 'public_forms',
}

export type CaptchaProviderKey = 'google_recaptcha_enterprise'

/** What the browser needs, and all it gets: the site key is public by design. */
export type CaptchaPublicConfig = {
  enabled: boolean
  provider: CaptchaProviderKey
  siteKey: string | null
}

/** "רמת הגנה" as a person picks it; the number underneath is the score threshold. */
export const PROTECTION_LEVELS = [
  { key: 'low', label: 'נמוכה', threshold: 0.3 },
  { key: 'normal', label: 'רגילה', threshold: 0.5 },
  { key: 'high', label: 'גבוהה', threshold: 0.7 },
] as const

export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number]['key']

export function levelFor(threshold: number): ProtectionLevel | 'custom' {
  return PROTECTION_LEVELS.find((l) => Math.abs(l.threshold - threshold) < 1e-9)?.key ?? 'custom'
}

/** The settings screen's view: the secret is a hint, never the value. */
export type CaptchaAdminView = {
  enabled: boolean
  provider: CaptchaProviderKey
  projectId: string
  siteKey: string
  /** "••••••••••••abcd" or null when no credential is stored. */
  apiKeyHint: string | null
  threshold: number
  protectLogin: boolean
  protectPublicForms: boolean
  /** The deployment can encrypt secrets; without it nothing can be saved. */
  secretsAvailable: boolean
  updatedAt: string | null
}
