import { eq } from 'drizzle-orm'
import { CAPTCHA_ACTIONS, SURFACE_OF, type CaptchaAction, type CaptchaAdminView, type CaptchaProviderKey, type CaptchaPublicConfig } from '@/lib/captcha'
import { requireAdmin, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { notify } from '@/server/notifications/notifications'
import { AUDIT_EVENTS, recordAdminAction } from '@/server/users/admin-audit'
import { decryptSecret, encryptSecret, secretHint, secretsConfigured } from './secrets'

/**
 * One CAPTCHA service for every browser door: login (before an OTP goes
 * out), the public joining form, the campaign registration.
 *
 * The routes ask `verifyCaptcha` one question and get one answer; the
 * provider behind it — Google reCAPTCHA Enterprise today — is an
 * implementation of a small interface, so another can be added without the
 * doors changing. Settings live in the product, not in a deploy: an admin
 * can switch it off, replace the Google project or keys, and test the new
 * ones before they go live. The API credential is encrypted at rest and
 * never shown again.
 *
 * Fail-secure by design: when CAPTCHA is on and the provider cannot be
 * reached or answers nonsense, the request is refused and an admin is told.
 * Off means off — no script, no token, no assessment; the rate limits and
 * honeypots stay.
 */

const SETTINGS_KEY = 'captcha'

export type CaptchaConfig = {
  enabled: boolean
  provider: CaptchaProviderKey
  projectId: string
  siteKey: string
  /** Encrypted; see secrets.ts. */
  apiKeyEncrypted: string | null
  threshold: number
  protectLogin: boolean
  protectPublicForms: boolean
}

const DEFAULT_CONFIG: CaptchaConfig = {
  enabled: false,
  provider: 'google_recaptcha_enterprise',
  projectId: '',
  siteKey: '',
  apiKeyEncrypted: null,
  threshold: 0.5,
  protectLogin: true,
  protectPublicForms: true,
}

function clean(raw: unknown): CaptchaConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const threshold = Number(r.threshold)
  return {
    enabled: r.enabled === true,
    provider: 'google_recaptcha_enterprise',
    projectId: typeof r.projectId === 'string' ? r.projectId.trim().slice(0, 100) : '',
    siteKey: typeof r.siteKey === 'string' ? r.siteKey.trim().slice(0, 200) : '',
    apiKeyEncrypted: typeof r.apiKeyEncrypted === 'string' && r.apiKeyEncrypted ? r.apiKeyEncrypted : null,
    threshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : DEFAULT_CONFIG.threshold,
    protectLogin: r.protectLogin !== false,
    protectPublicForms: r.protectPublicForms !== false,
  }
}

async function loadConfig(): Promise<{ config: CaptchaConfig; updatedAt: Date | null }> {
  const [row] = await getDb().select().from(schema.systemSettings).where(eq(schema.systemSettings.key, SETTINGS_KEY)).limit(1)
  return { config: clean(row?.value), updatedAt: row?.updatedAt ?? null }
}

// ── what the pages get ────────────────────────────────────────────────────

/** For a page that renders a protected form: whether to load the script, and which key. */
export async function captchaPublicConfig(action: CaptchaAction): Promise<CaptchaPublicConfig> {
  const { config } = await loadConfig()
  const on = config.enabled && Boolean(config.siteKey) && surfaceOn(config, action)
  return { enabled: on, provider: config.provider, siteKey: on ? config.siteKey : null }
}

function surfaceOn(config: CaptchaConfig, action: CaptchaAction): boolean {
  const surface = SURFACE_OF[action]
  return surface === 'login' ? config.protectLogin : config.protectPublicForms
}

// ── the provider ──────────────────────────────────────────────────────────

export type VerifyOutcome =
  | { ok: true; score: number | null; assessment: string | null }
  | { ok: false; reason: 'invalid' | 'action_mismatch' | 'low_score' | 'provider_error'; detail: string; score?: number | null; assessment?: string | null }

export type ProviderTest = { ok: true; message: string } | { ok: false; message: string }

export interface CaptchaProvider {
  verify(config: CaptchaConfig & { apiKey: string }, input: { token: string; expectedAction: CaptchaAction; ip: string | null; userAgent: string | null }): Promise<VerifyOutcome>
  /** Checks credentials and configuration as far as a server can without a browser token. */
  test(config: CaptchaConfig & { apiKey: string }): Promise<ProviderTest>
}

const ASSESSMENT_TIMEOUT_MS = 8_000

/**
 * Google reCAPTCHA Enterprise, per the official "create assessment" docs:
 * `POST https://recaptchaenterprise.googleapis.com/v1/projects/{project}/assessments?key={apiKey}`
 * with `{ event: { token, siteKey, expectedAction, userIpAddress, userAgent } }`.
 * The answer's `tokenProperties.valid`, `tokenProperties.action` (which
 * must equal the expected action) and `riskAnalysis.score` decide.
 * Tokens are single-use and expire after two minutes — the browser mints
 * one at submit time and the server never stores it.
 */
export class GoogleRecaptchaEnterprise implements CaptchaProvider {
  private endpoint(config: { projectId: string; apiKey: string }) {
    return `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/assessments?key=${encodeURIComponent(config.apiKey)}`
  }

  private async assess(config: CaptchaConfig & { apiKey: string }, event: Record<string, string | undefined>) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ASSESSMENT_TIMEOUT_MS)
    try {
      const response = await fetch(this.endpoint(config), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: { siteKey: config.siteKey, ...event } }),
        signal: controller.signal,
      })
      const body = (await response.json().catch(() => null)) as GoogleAssessment | null
      return { status: response.status, body }
    } finally {
      clearTimeout(timer)
    }
  }

  async verify(config: CaptchaConfig & { apiKey: string }, input: { token: string; expectedAction: CaptchaAction; ip: string | null; userAgent: string | null }): Promise<VerifyOutcome> {
    let result: { status: number; body: GoogleAssessment | null }
    try {
      result = await this.assess(config, {
        token: input.token,
        expectedAction: input.expectedAction,
        userIpAddress: input.ip ?? undefined,
        userAgent: input.userAgent ?? undefined,
      })
    } catch (error) {
      return { ok: false, reason: 'provider_error', detail: error instanceof Error ? error.name : 'network' }
    }
    const { status, body } = result
    if (status !== 200 || !body) return { ok: false, reason: 'provider_error', detail: `http_${status}:${body?.error?.status ?? 'no_body'}` }
    const props = body.tokenProperties
    const assessment = body.name ?? null
    if (!props?.valid) return { ok: false, reason: 'invalid', detail: props?.invalidReason ?? 'INVALID', assessment }
    if (props.action !== input.expectedAction) return { ok: false, reason: 'action_mismatch', detail: `${props.action ?? '?'}≠${input.expectedAction}`, assessment }
    const score = typeof body.riskAnalysis?.score === 'number' ? body.riskAnalysis.score : null
    if (score === null || score < config.threshold) return { ok: false, reason: 'low_score', detail: (body.riskAnalysis?.reasons ?? []).join(',') || 'below_threshold', score, assessment }
    return { ok: true, score, assessment }
  }

  async test(config: CaptchaConfig & { apiKey: string }): Promise<ProviderTest> {
    // A deliberately bad token: a working project + key answers 200 with
    // `valid: false`; bad credentials answer 400/403; a wrong project 404.
    let result: { status: number; body: GoogleAssessment | null }
    try {
      result = await this.assess(config, { token: 'xtra-sign-connection-test', expectedAction: CAPTCHA_ACTIONS.LOGIN_OTP })
    } catch {
      return { ok: false, message: 'לא הצלחנו להגיע ל-Google. בדקו את החיבור ונסו שוב.' }
    }
    if (result.status === 200 && result.body?.tokenProperties) {
      return { ok: true, message: 'החיבור תקין: הפרויקט, המפתח והאישור מזוהים על ידי Google.' }
    }
    const code = result.body?.error?.status
    if (result.status === 400 && code === 'INVALID_ARGUMENT') return { ok: false, message: 'Google לא מזהה את ה-Site Key בפרויקט הזה. בדקו את ה-Site Key ואת ה-Project ID.' }
    if (result.status === 401 || result.status === 403) return { ok: false, message: 'האישור (API key) נדחה. בדקו שהוא שייך לפרויקט ושה-reCAPTCHA Enterprise API מופעל בו.' }
    if (result.status === 404) return { ok: false, message: 'Project ID לא נמצא ב-Google Cloud.' }
    return { ok: false, message: 'Google החזירה תשובה לא צפויה. בדקו את ההגדרות ונסו שוב.' }
  }
}

type GoogleAssessment = {
  name?: string
  tokenProperties?: { valid?: boolean; invalidReason?: string; action?: string; hostname?: string; createTime?: string }
  riskAnalysis?: { score?: number; reasons?: string[] }
  error?: { code?: number; status?: string; message?: string }
}

const providers: Record<CaptchaProviderKey, CaptchaProvider> = { google_recaptcha_enterprise: new GoogleRecaptchaEnterprise() }

// ── the one question the doors ask ────────────────────────────────────────

export const CAPTCHA_FAILED_MESSAGE = 'לא הצלחנו לאמת את הבקשה. נסו שוב.'

export type CaptchaCheck = { ok: true; skipped: boolean } | { ok: false; message: string; reason: VerifyOutcome extends { ok: false } ? never : 'missing_token' | 'invalid' | 'action_mismatch' | 'low_score' | 'provider_error' | 'not_configured' }

/**
 * Verifies a browser token for an action, or says the door is unguarded.
 * Never throws; never logs the token or the credential.
 */
export async function verifyCaptcha(input: { action: CaptchaAction; token: unknown; ip: string | null; userAgent: string | null }): Promise<CaptchaCheck> {
  const { config } = await loadConfig()
  if (!config.enabled || !surfaceOn(config, input.action)) return { ok: true, skipped: true }

  if (!config.siteKey || !config.projectId || !config.apiKeyEncrypted) {
    await alertAdmins('CAPTCHA מופעל אך ההגדרות חסרות (Project ID / Site Key / אישור).')
    return { ok: false, message: CAPTCHA_FAILED_MESSAGE, reason: 'not_configured' }
  }
  const token = typeof input.token === 'string' ? input.token.trim() : ''
  if (!token || token.length > 5000) {
    log.info('captcha refused', { action: input.action, category: 'missing_token' })
    return { ok: false, message: CAPTCHA_FAILED_MESSAGE, reason: 'missing_token' }
  }

  let apiKey: string
  try {
    apiKey = decryptSecret(config.apiKeyEncrypted)
  } catch (error) {
    log.error('captcha credential unreadable', { error: error instanceof Error ? error.message : String(error) })
    await alertAdmins('לא ניתן לקרוא את אישור ה-CAPTCHA השמור. ייתכן שמפתח ההצפנה של השרת השתנה.')
    return { ok: false, message: CAPTCHA_FAILED_MESSAGE, reason: 'provider_error' }
  }

  const outcome = await providers[config.provider].verify({ ...config, apiKey }, { token, expectedAction: input.action, ip: input.ip, userAgent: input.userAgent })
  if (outcome.ok) {
    log.info('captcha passed', { action: input.action, assessment: outcome.assessment, score: outcome.score })
    return { ok: true, skipped: false }
  }
  log.warn('captcha refused', { action: input.action, category: outcome.reason, detail: outcome.detail, assessment: outcome.assessment ?? null, score: outcome.score ?? null })
  if (outcome.reason === 'provider_error') await alertAdmins(`אימות CAPTCHA נכשל מול הספק (${outcome.detail}). בקשות מוגנות נדחות עד לתיקון.`)
  return { ok: false, message: CAPTCHA_FAILED_MESSAGE, reason: outcome.reason }
}

let lastAlertAt = 0
/** Tells the admins once every ten minutes at most — a provider outage is one incident, not a thousand. */
async function alertAdmins(body: string) {
  if (Date.now() - lastAlertAt < 10 * 60_000) return
  lastAlertAt = Date.now()
  const [org] = await getDb().select({ id: schema.organizations.id }).from(schema.organizations).orderBy(schema.organizations.createdAt).limit(1)
  if (!org) return
  await notify({ organizationId: org.id, type: 'security_alert', agreementId: null, link: '/settings/security', title: 'בעיה בהגנת CAPTCHA', body }).catch(() => {})
}

// ── the admin's settings ──────────────────────────────────────────────────

export async function getCaptchaAdminView(session: StaffSession): Promise<CaptchaAdminView> {
  requireAdmin(session)
  const { config, updatedAt } = await loadConfig()
  let apiKeyHint: string | null = null
  if (config.apiKeyEncrypted && secretsConfigured()) {
    try {
      apiKeyHint = secretHint(decryptSecret(config.apiKeyEncrypted))
    } catch {
      apiKeyHint = '••••••••••••????'
    }
  }
  return {
    enabled: config.enabled,
    provider: config.provider,
    projectId: config.projectId,
    siteKey: config.siteKey,
    apiKeyHint,
    threshold: config.threshold,
    protectLogin: config.protectLogin,
    protectPublicForms: config.protectPublicForms,
    secretsAvailable: secretsConfigured(),
    updatedAt: updatedAt?.toISOString() ?? null,
  }
}

export type CaptchaSaveInput = Partial<{
  enabled: boolean
  projectId: string
  siteKey: string
  /** A new credential; absent or empty keeps the stored one. */
  apiKey: string
  threshold: number
  protectLogin: boolean
  protectPublicForms: boolean
}>

export type CaptchaSaveResult = { ok: true; view: CaptchaAdminView } | { ok: false; message: string }

/**
 * Replaces the settings in one write, after checking they can work: an
 * enabled configuration must have a project, a site key and a credential.
 * Recorded in the admin audit — which fields changed, never the secret.
 */
export async function saveCaptchaSettings(session: StaffSession, input: CaptchaSaveInput, ip?: string | null): Promise<CaptchaSaveResult> {
  requireAdmin(session)
  const { config: current } = await loadConfig()
  const next: CaptchaConfig = clean({
    ...current,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.siteKey !== undefined ? { siteKey: input.siteKey } : {}),
    ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
    ...(input.protectLogin !== undefined ? { protectLogin: input.protectLogin } : {}),
    ...(input.protectPublicForms !== undefined ? { protectPublicForms: input.protectPublicForms } : {}),
  })
  let credentialReplaced = false
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    if (!secretsConfigured()) return { ok: false, message: 'השרת אינו מוגדר לשמירת מפתחות מוצפנים (SIGN_SECRETS_KEY חסר). יש להגדיר אותו פעם אחת בסביבת ההרצה.' }
    next.apiKeyEncrypted = encryptSecret(input.apiKey.trim())
    credentialReplaced = true
  }
  if (next.projectId && !/^[a-z][a-z0-9-]{4,29}$/.test(next.projectId)) return { ok: false, message: 'Project ID לא תקין (אותיות קטנות, ספרות ומקפים, 6–30 תווים).' }
  if (next.enabled) {
    if (!next.projectId) return { ok: false, message: 'כדי להפעיל CAPTCHA יש להזין Project ID.' }
    if (!next.siteKey) return { ok: false, message: 'כדי להפעיל CAPTCHA יש להזין Site Key.' }
    if (!next.apiKeyEncrypted) return { ok: false, message: 'כדי להפעיל CAPTCHA יש להזין את האישור (API key) של Google.' }
  }

  const changed = (['enabled', 'projectId', 'siteKey', 'threshold', 'protectLogin', 'protectPublicForms'] as const).filter((k) => current[k] !== next[k])
  if (credentialReplaced) changed.push('apiKey' as never)

  await getDb()
    .insert(schema.systemSettings)
    .values({ key: SETTINGS_KEY, value: next, updatedBy: session.userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: next, updatedBy: session.userId, updatedAt: new Date() } })

  await recordAdminAction({
    organizationId: session.organizationId,
    type: AUDIT_EVENTS.SECURITY_SETTINGS_CHANGED,
    actorEmail: session.email,
    ip: ip ?? null,
    metadata: {
      setting: 'captcha',
      changed,
      enabled: next.enabled,
      provider: next.provider,
      projectId: next.projectId || null,
      siteKeyHint: next.siteKey ? `…${next.siteKey.slice(-6)}` : null,
      credentialReplaced,
      threshold: next.threshold,
    },
  })
  return { ok: true, view: await getCaptchaAdminView(session) }
}

/** Tests a candidate configuration before it is saved; the stored credential is used when none is typed. */
export async function testCaptchaSettings(session: StaffSession, input: CaptchaSaveInput): Promise<ProviderTest> {
  requireAdmin(session)
  const { config: current } = await loadConfig()
  const candidate = clean({ ...current, ...(input.projectId !== undefined ? { projectId: input.projectId } : {}), ...(input.siteKey !== undefined ? { siteKey: input.siteKey } : {}) })
  let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  if (!apiKey) {
    if (!current.apiKeyEncrypted) return { ok: false, message: 'יש להזין את האישור (API key) כדי לבדוק את החיבור.' }
    try {
      apiKey = decryptSecret(current.apiKeyEncrypted)
    } catch {
      return { ok: false, message: 'לא ניתן לקרוא את האישור השמור. הזינו אותו מחדש.' }
    }
  }
  if (!candidate.projectId || !candidate.siteKey) return { ok: false, message: 'יש להזין Project ID ו-Site Key לפני הבדיקה.' }
  return providers[candidate.provider].test({ ...candidate, apiKey })
}

/** For tests and tooling: swap the provider behind a key. */
export function _setCaptchaProviderForTests(key: CaptchaProviderKey, provider: CaptchaProvider) {
  providers[key] = provider
}
