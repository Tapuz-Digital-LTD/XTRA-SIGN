import { describe, expect, it } from 'vitest'
import { cleanOverrides } from '@/lib/message-template'
import { smsLength } from '@/lib/sms-length'

describe('smsLength', () => {
  it('counts GSM-7 text as one segment up to 160', () => {
    expect(smsLength('hello world').segments).toBe(1)
    expect(smsLength('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', segments: 1 })
    expect(smsLength('a'.repeat(161))).toMatchObject({ encoding: 'gsm7', segments: 2, perSegment: 153 })
  })
  it('switches to UCS-2 for Hebrew: 70 per single, 67 per part', () => {
    expect(smsLength('שלום')).toMatchObject({ encoding: 'ucs2', segments: 1 })
    expect(smsLength('ש'.repeat(70)).segments).toBe(1)
    expect(smsLength('ש'.repeat(71)).segments).toBe(2)
    expect(smsLength('ש'.repeat(135)).segments).toBe(3)
  })
  it('charges two units for GSM extension characters', () => {
    expect(smsLength('€').chars).toBe(2)
  })
  it('is zero for empty text', () => {
    expect(smsLength('').segments).toBe(0)
  })
})

describe('cleanOverrides', () => {
  it('keeps only known events and non-empty fields', () => {
    const out = cleanOverrides({ invitation: { sms: ' hi {{signing_link}} ', email: { subject: '', body: '', cta: '' } }, bogus: { sms: 'x' }, reminder: { sms: '' } })
    expect(out).toEqual({ invitation: { sms: 'hi {{signing_link}}' } })
  })
  it('returns an empty object for garbage', () => {
    expect(cleanOverrides(null)).toEqual({})
    expect(cleanOverrides('x')).toEqual({})
  })
})
