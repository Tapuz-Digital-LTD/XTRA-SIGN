import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CAPTCHA_ACTIONS } from '@/lib/captcha'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { InforuSmsProvider } from '@/server/notifications/inforu'
import { POST as loginPost } from '@/app/api/auth/login/route'
import { POST as registerPost } from '@/app/api/self-service/[formId]/register/route'
import { saveSelfServiceConfig } from '@/server/projects/self-service'
import { createGroup } from '@/server/groups/groups'
import { createTemplateFromPdf } from '@/server/templates/templates'
import { readFileSync } from 'node:fs'
import { GoogleRecaptchaEnterprise, captchaPublicConfig, getCaptchaAdminView, saveCaptchaSettings, testCaptchaSettings, verifyCaptcha } from '../captcha'
import { decryptSecret } from '../secrets'

/**
 * The CAPTCHA layer against a stand-in Google: a good token passes, a bad
 * one, a wrong action, a low score and a dead provider are refused with
 * the same human sentence; off means untouched; settings replace atomically
 * and the credential never comes back in plain text.
 */

// The register route hands its follow-up work to next/server's after(), which needs a request scope vitest has none of.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (task: () => unknown) => { void Promise.resolve().then(task).catch(() => {}) } }
})

const db = getDb()
let admin: StaffSession
let user: StaffSession
let formId: string
const ORIGIN = process.env.SIGN_PUBLIC_URL ?? 'https://sign.test'

/** A fake Google: the token says what the assessment should answer. */
function fakeGoogle() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { event: { token: string; expectedAction: string; siteKey: string } }
    const key = new URL(url).searchParams.get('key')
    const json = (status: number, payload: unknown) => ({ ok: status === 200, status, json: async () => payload }) as Response
    if (key !== 'good-api-key') return json(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'bad key' } })
    if (!url.includes('/projects/xtra-sign-prod/')) return json(404, { error: { code: 404, status: 'NOT_FOUND' } })
    const t = body.event.token
    if (t === 'xtra-sign-connection-test') return json(200, { name: 'projects/x/assessments/test', tokenProperties: { valid: false, invalidReason: 'MALFORMED' } })
    if (t === 'expired') return json(200, { name: 'a1', tokenProperties: { valid: false, invalidReason: 'EXPIRED', action: body.event.expectedAction } })
    if (t === 'reused') return json(200, { name: 'a2', tokenProperties: { valid: false, invalidReason: 'DUPE', action: body.event.expectedAction } })
    if (t === 'wrong-action') return json(200, { name: 'a3', tokenProperties: { valid: true, action: 'SOMETHING_ELSE' }, riskAnalysis: { score: 0.9 } })
    if (t === 'bot') return json(200, { name: 'a4', tokenProperties: { valid: true, action: body.event.expectedAction }, riskAnalysis: { score: 0.1, reasons: ['AUTOMATION'] } })
    if (t === 'outage') throw new Error('ECONNRESET')
    if (t.startsWith('human')) return json(200, { name: 'a5', tokenProperties: { valid: true, action: body.event.expectedAction }, riskAnalysis: { score: 0.9 } })
    return json(200, { name: 'a6', tokenProperties: { valid: false, invalidReason: 'MALFORMED' } })
  })
}

beforeAll(async () => {
  process.env.SIGN_SECRETS_KEY = Buffer.alloc(32, 7).toString('base64')
  const tag = crypto.randomUUID().slice(0, 8)
  const [org] = await db.insert(schema.organizations).values({ name: `Captcha ${tag}` }).returning({ id: schema.organizations.id })
  const mk = async (isAdmin: boolean) => {
    const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const [u] = await db.insert(schema.users).values({ organizationId: org.id, email: `${crypto.randomUUID().slice(0, 8)}@xtra.test`, name: isAdmin ? 'Admin' : 'User', phone: `+972${phone.slice(1)}`, isAdmin }).returning({ id: schema.users.id, email: schema.users.email })
    return { session: { userId: u.id, organizationId: org.id, email: u.email, name: 'x', isAdmin } satisfies StaffSession, phone }
  }
  const a = await mk(true)
  admin = a.session
  loginPhone = a.phone
  user = (await mk(false)).session
  const group = await createGroup({ session: admin, name: 'C', kind: 'supplier' })
  if (!group.ok) throw new Error('group')
  const template = await createTemplateFromPdf({ session: admin, buffer: readFileSync('.design/tourism-2026/agreement.pdf'), name: 'T' })
  if (!template.ok) throw new Error('template')
  const saved = await saveSelfServiceConfig(admin, group.id, { enabled: true, skin: 'tourism-2026', templateId: template.templateId, ownerUserId: admin.userId })
  if (!saved.ok) throw new Error(saved.message)
  const [row] = await db.select({ formId: schema.groups.landingSlug }).from(schema.groups).where(eq(schema.groups.id, group.id))
  formId = row.formId!
  vi.spyOn(InforuSmsProvider.prototype, 'send').mockResolvedValue({ ok: false, error: 'not_sent:test', providerMessageId: null })
})
let loginPhone = ''

afterEach(() => vi.unstubAllGlobals())
afterAll(() => vi.restoreAllMocks())

const request = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'user-agent': 'vitest' }, body: JSON.stringify(body) })

const registration = (token: string | undefined) => ({
  idempotencyKey: `cap-${crypto.randomUUID()}`,
  values: { businessName: 'עסק CAPTCHA', taxId: `51${String(Date.now()).slice(-7)}`, signatoryName: 'ישראל ישראלי', signatoryRole: 'מנהל', phone: '052-1234567', email: `c-${crypto.randomUUID().slice(0, 6)}@example.test` },
  ...(token === undefined ? {} : { captchaToken: token }),
})

describe('settings', () => {
  it('only an admin may see or change them; the credential comes back as a hint only', async () => {
    await expect(getCaptchaAdminView(user)).rejects.toThrow()
    await expect(saveCaptchaSettings(user, { enabled: true })).rejects.toThrow()

    const refused = await saveCaptchaSettings(admin, { enabled: true, projectId: 'xtra-sign-prod', siteKey: '6Lsitekey' })
    expect(refused).toMatchObject({ ok: false })

    const saved = await saveCaptchaSettings(admin, { enabled: true, projectId: 'xtra-sign-prod', siteKey: '6Lsitekey', apiKey: 'good-api-key', threshold: 0.5 })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.view.apiKeyHint).toBe('••••••••••••-key')
    expect(JSON.stringify(saved.view)).not.toContain('good-api-key')
    const [row] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, 'captcha'))
    const stored = row.value as { apiKeyEncrypted: string }
    expect(stored.apiKeyEncrypted.startsWith('enc:v1:')).toBe(true)
    expect(decryptSecret(stored.apiKeyEncrypted)).toBe('good-api-key')
    const audits = await db.select().from(schema.adminAuditEvents).where(eq(schema.adminAuditEvents.type, 'security_settings_changed'))
    expect(audits.length).toBeGreaterThan(0)
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain('good-api-key')

    expect(await captchaPublicConfig(CAPTCHA_ACTIONS.LOGIN_OTP)).toEqual({ enabled: true, provider: 'google_recaptcha_enterprise', siteKey: '6Lsitekey' })
  })

  it('a connection test speaks Google, without saving anything', async () => {
    vi.stubGlobal('fetch', fakeGoogle())
    expect(await testCaptchaSettings(admin, { projectId: 'xtra-sign-prod', siteKey: '6Lsitekey' })).toMatchObject({ ok: true })
    expect(await testCaptchaSettings(admin, { projectId: 'xtra-sign-prod', siteKey: '6Lsitekey', apiKey: 'wrong' })).toMatchObject({ ok: false })
    expect(await testCaptchaSettings(admin, { projectId: 'other-project', siteKey: '6Lsitekey' })).toMatchObject({ ok: false })
    const view = await getCaptchaAdminView(admin)
    expect(view.projectId).toBe('xtra-sign-prod')
  })
})

describe('verification', () => {
  it('passes a human, refuses expired, reused, wrong-action and low-score tokens with one sentence', async () => {
    vi.stubGlobal('fetch', fakeGoogle())
    const base = { ip: '10.0.0.1', userAgent: 'vitest' }
    expect(await verifyCaptcha({ action: CAPTCHA_ACTIONS.LOGIN_OTP, token: 'human-1', ...base })).toEqual({ ok: true, skipped: false })
    for (const token of ['expired', 'reused', 'wrong-action', 'bot', '', undefined]) {
      const result = await verifyCaptcha({ action: CAPTCHA_ACTIONS.LOGIN_OTP, token, ...base })
      expect(result.ok, String(token)).toBe(false)
      if (!result.ok) expect(result.message).toBe('לא הצלחנו לאמת את הבקשה. נסו שוב.')
    }
    // The assessment was asked for the action the door expects.
    const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(JSON.parse(String(calls[0][1].body)).event.expectedAction).toBe('LOGIN_OTP')
  })

  it('a dead provider refuses (never a silent pass) and tells the admins', async () => {
    vi.stubGlobal('fetch', fakeGoogle())
    const result = await verifyCaptcha({ action: CAPTCHA_ACTIONS.CAMPAIGN_REGISTRATION, token: 'outage', ip: null, userAgent: null })
    expect(result).toMatchObject({ ok: false, reason: 'provider_error' })
    const alerts = await db.select().from(schema.notifications).where(eq(schema.notifications.type, 'security_alert'))
    expect(alerts.length).toBeGreaterThan(0)
  })

  it('an unprotected door or a switched-off CAPTCHA is skipped', async () => {
    await saveCaptchaSettings(admin, { protectPublicForms: false })
    expect(await verifyCaptcha({ action: CAPTCHA_ACTIONS.PUBLIC_FORM_SUBMIT, token: undefined, ip: null, userAgent: null })).toEqual({ ok: true, skipped: true })
    expect((await captchaPublicConfig(CAPTCHA_ACTIONS.PUBLIC_FORM_SUBMIT)).enabled).toBe(false)
    await saveCaptchaSettings(admin, { protectPublicForms: true, enabled: false })
    expect(await verifyCaptcha({ action: CAPTCHA_ACTIONS.LOGIN_OTP, token: undefined, ip: null, userAgent: null })).toEqual({ ok: true, skipped: true })
    await saveCaptchaSettings(admin, { enabled: true })
  })
})

describe('the doors', () => {
  it('login: a valid token sends the code, an invalid one does not', async () => {
    vi.stubGlobal('fetch', fakeGoogle())
    const send = InforuSmsProvider.prototype.send as unknown as ReturnType<typeof vi.fn>
    send.mockClear()
    const bad = await loginPost(request('/api/auth/login', { step: 'request', phone: loginPhone, captchaToken: 'bot' }))
    expect(bad.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
    const good = await loginPost(request('/api/auth/login', { step: 'request', phone: loginPhone, captchaToken: 'human-login' }))
    expect(good.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('campaign registration: refused before anything is created, accepted with a human token', async () => {
    vi.stubGlobal('fetch', fakeGoogle())
    const before = (await db.select().from(schema.projectLeads)).length
    const bad = await registerPost(request(`/api/self-service/${formId}/register`, registration('expired')), { params: Promise.resolve({ formId }) })
    expect(bad.status).toBe(400)
    expect((await db.select().from(schema.projectLeads)).length).toBe(before)
    const missing = await registerPost(request(`/api/self-service/${formId}/register`, registration(undefined)), { params: Promise.resolve({ formId }) })
    expect(missing.status).toBe(400)
    const good = await registerPost(request(`/api/self-service/${formId}/register`, registration('human-reg')), { params: Promise.resolve({ formId }) })
    expect(good.status).toBe(200)
    expect((await db.select().from(schema.projectLeads)).length).toBe(before + 1)
  })

  it('replacing the key: the new one is what Google is asked with', async () => {
    const fetchMock = fakeGoogle()
    vi.stubGlobal('fetch', fetchMock)
    const saved = await saveCaptchaSettings(admin, { apiKey: 'good-api-key' })
    expect(saved.ok).toBe(true)
    await verifyCaptcha({ action: CAPTCHA_ACTIONS.LOGIN_OTP, token: 'human-2', ip: null, userAgent: null })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('key=good-api-key')
    // Google's provider builds the documented endpoint.
    const provider = new GoogleRecaptchaEnterprise()
    const outcome = await provider.verify({ enabled: true, provider: 'google_recaptcha_enterprise', projectId: 'xtra-sign-prod', siteKey: '6Lsitekey', apiKeyEncrypted: null, threshold: 0.5, protectLogin: true, protectPublicForms: true, apiKey: 'good-api-key' }, { token: 'human-3', expectedAction: CAPTCHA_ACTIONS.LOGIN_OTP, ip: null, userAgent: null })
    expect(outcome).toMatchObject({ ok: true, score: 0.9 })
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe('https://recaptchaenterprise.googleapis.com/v1/projects/xtra-sign-prod/assessments?key=good-api-key')
  })
})
