import { describe, expect, it } from 'vitest'
import { joiningProgress } from '../joining-progress'

/**
 * The four states a worker asks about, and the one rule under all of them:
 * a step is shown only when a row proves it, and a message that left the
 * system is never called delivered.
 */
const at = (h: number) => `2026-09-08T0${h}:00:00.000Z`
const done = (p: ReturnType<typeof joiningProgress>, key: string) => p.steps.find((s) => s.key === key)?.done ?? false

describe('joiningProgress', () => {
  it('code sent but never verified: says the code is waiting, not that it was entered', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSentAt: at(2), codeSentAt: at(2), agreementStatus: 'sent' })
    expect(p.headline).toBe('ממתין להשלמת חתימה')
    expect(p.secondary).toBe('קישור וקוד נשלחו · טרם נפתח')
    expect(done(p, 'code_sent')).toBe(true)
    expect(done(p, 'code_verified')).toBe(false)
    expect(done(p, 'link_opened')).toBe(false)
    expect(done(p, 'signed')).toBe(false)
    expect(p.next).toContain('תזכורת')
  })

  it('link opened without verification: never claims the code was verified', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSentAt: at(2), codeSentAt: at(2), linkOpenedAt: at(3), agreementStatus: 'viewed' })
    expect(p.secondary).toBe('קישור נפתח · טרם הושלמה חתימה')
    expect(done(p, 'link_opened')).toBe(true)
    expect(done(p, 'code_verified')).toBe(false)
    expect(p.next).toContain('קוד אימות')
  })

  it('code verified without a signature: the person is one step from done', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSentAt: at(2), codeSentAt: at(2), codeVerifiedAt: at(3), agreementStatus: 'viewed' })
    expect(p.headline).toBe('ממתין להשלמת חתימה')
    expect(p.secondary).toBe('קוד אומת · טרם הושלמה חתימה')
    expect(done(p, 'code_verified')).toBe(true)
    expect(done(p, 'signed')).toBe(false)
  })

  it('signature completed: one success line, no leftover "waiting" wording', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSentAt: at(2), codeSentAt: at(2), codeVerifiedAt: at(3), signedAt: at(4), agreementStatus: 'signed' })
    expect(p.headline).toBe('ההצטרפות הושלמה')
    expect(p.tone).toBe('success')
    expect(p.secondary).toBeNull()
    expect(p.next).toBeNull()
    expect(done(p, 'signed')).toBe(true)
  })

  it('never says a message was delivered — only that it was sent', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSentAt: at(2), agreementStatus: 'sent' })
    const words = [p.headline, p.explain, p.secondary, p.next, ...p.steps.map((s) => `${s.label} ${s.note ?? ''}`)].join(' ')
    expect(words).not.toContain('נמסר')
    expect(words).toContain('אישור מסירה למכשיר אינו זמין')
  })

  it('a failed send is a problem to fix, not a quiet wait', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSendFailedAt: at(2), agreementStatus: 'sent' })
    expect(p.tone).toBe('danger')
    expect(p.secondary).toBe('שליחת הקישור נכשלה')
    expect(done(p, 'link_sent')).toBe(false)
  })

  it('invited only: not a registration, and says so', () => {
    const p = joiningProgress({ invitedAt: at(1), linkSentAt: at(1), leadStatus: 'invited' })
    expect(p.headline).toBe('הוזמן, טרם נרשם')
    // Sent is not opened: with no event of its own, the line says so rather
    // than implying the person saw anything.
    expect(p.secondary).toBe('הזמנה נשלחה · אין נתון על פתיחה')
    expect(done(p, 'form')).toBe(false)
    expect(done(p, 'invitation_opened')).toBe(false)
  })

  it('invited and the personal link was opened: a different headline and a different next step', () => {
    const p = joiningProgress({ invitedAt: at(1), linkSentAt: at(1), invitationOpenedAt: at(2), leadStatus: 'invited' })
    expect(p.headline).toBe('הקישור נפתח, טרם נרשם')
    expect(p.secondary).toBe('הקישור נפתח · טרם נרשם')
    expect(done(p, 'invitation_opened')).toBe(true)
    expect(done(p, 'form')).toBe(false)
    expect(p.next).toContain('שיחה')
  })

  it('an expired link is named, with the action that fixes it', () => {
    const p = joiningProgress({ submittedAt: at(1), agreementCreatedAt: at(1), linkSentAt: at(2), agreementStatus: 'expired' })
    expect(p.headline).toBe('פג תוקף הקישור')
    expect(p.next).toContain('קישור חדש')
  })
})
