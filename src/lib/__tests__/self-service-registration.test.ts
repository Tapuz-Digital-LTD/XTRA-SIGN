import { describe, expect, it } from 'vitest'
import { validateRegistration } from '../self-service-registration'

const base = {
  businessName: 'מוזיאון הנמל',
  taxId: '515123456',
  signatoryName: 'ישראל ישראלי',
  signatoryRole: 'מנכ"ל',
  contactPerson: 'דנה כהן',
  phone: '052-1234567',
  email: 'dana@example.com',
  benefit1: '25% הנחה',
  week: 'week_2',
  redemption: 'generic_xtra25',
  declareLicense: true,
  declareInsurance: true,
}

const appendix = {
  withAppendix: true,
  address: 'הנמל 3',
  city: 'חיפה',
  audience: 'both',
  service1Type: 'כרטיס כניסה',
  service1Details: 'כניסה למוזיאון, כולל סיור',
  service1Price: '₪ 1,200',
  service1Net: '18',
  bankAccountName: 'מוזיאון הנמל בע"מ',
  bankName: 'בנק הפועלים',
  bankNumber: '12',
  bankBranch: '600',
  bankAccount: '123-456789',
  consentAppendix: true,
}

describe('validateRegistration — the 18 ₪ appendix', () => {
  it('asks nothing of the appendix in the regular version, and returns its fields empty', () => {
    const result = validateRegistration({ ...base, address: 'stale', service1Type: 'left in a draft', consentAppendix: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.withAppendix).toBe(false)
    expect(result.data.address).toBe('')
    expect(result.data.service1Type).toBe('')
    expect(result.data.consentAppendix).toBe(false)
  })

  it('names every missing appendix answer when the version carries it', () => {
    const result = validateRegistration({ ...base, withAppendix: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fields).sort()).toEqual(
      ['address', 'audience', 'bankAccount', 'bankAccountName', 'bankBranch', 'bankName', 'bankNumber', 'city', 'consentAppendix', 'service1Type'].sort(),
    )
  })

  it('normalises prices and the account number, keeps the rest as typed', () => {
    const result = validateRegistration({ ...base, ...appendix })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.service1Price).toBe('1200')
    expect(result.data.service1Net).toBe('18')
    expect(result.data.bankAccount).toBe('123456789')
    expect(result.data.audience).toBe('both')
    expect(result.data.consentAppendix).toBe(true)
  })

  it('checks every service row that was started, and only those', () => {
    const result = validateRegistration({ ...base, ...appendix, service2Details: 'סיור לילי', service3Type: '', service3Net: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.fields).toEqual({
      service2Type: expect.any(String),
      service2Price: expect.any(String),
      service2Net: expect.any(String),
    })
  })

  it('moves a filled row up when the one above it was left empty', () => {
    const result = validateRegistration({ ...base, ...appendix, service3Type: 'סיור', service3Price: '60', service3Net: '18' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.data.service2Type, result.data.service2Price, result.data.service2Net]).toEqual(['סיור', '60', '18'])
    expect(result.data.service3Type).toBe('')
  })

  it('refuses a price that is not a number of shekels', () => {
    const result = validateRegistration({ ...base, ...appendix, service1Net: 'חינם', service1Price: '12.345' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fields).sort()).toEqual(['service1Net', 'service1Price'])
  })

  it('cannot be signed without the appendix consent', () => {
    const result = validateRegistration({ ...base, ...appendix, consentAppendix: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fields)).toEqual(['consentAppendix'])
  })
})
