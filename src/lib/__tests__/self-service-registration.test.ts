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

/** "הטבת 18 ₪": benefit rows with two prices instead of benefit lines and a coupon code. */
const benefit18 = {
  withAppendix: true,
  benefit1: '25% הנחה',
  redemption: '',
  address: 'הנמל 3',
  city: 'חיפה',
  service1Type: 'כניסה לאתר',
  service1TourismPrice: '₪ 60',
  service1SitePrice: '1,200',
  bankAccountName: 'מוזיאון הנמל בע"מ',
  bankName: 'בנק הפועלים',
  bankNumber: '12',
  bankBranch: '600',
  bankAccount: '123-456789',
}

describe('validateRegistration — הטבת 18 ₪', () => {
  it('asks nothing of the appendix in the regular version, and returns its fields empty', () => {
    const result = validateRegistration({ ...base, address: 'stale', service1Type: 'left in a draft' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.withAppendix).toBe(false)
    expect(result.data.address).toBe('')
    expect(result.data.service1Type).toBe('')
    expect(result.data.redemption).toBe('generic_xtra25')
  })

  it('names every missing answer of the 18 ₪ version — and neither a benefit line nor a coupon choice', () => {
    const result = validateRegistration({ ...base, withAppendix: true, benefit1: '', redemption: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fields).sort()).toEqual(['address', 'bankAccount', 'bankAccountName', 'bankBranch', 'bankName', 'bankNumber', 'city', 'service1Type'].sort())
  })

  it('normalises prices and the account number, drops the benefit lines and the coupon', () => {
    const result = validateRegistration({ ...base, ...benefit18, couponCode: '777' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.service1TourismPrice).toBe('60')
    expect(result.data.service1SitePrice).toBe('1200')
    expect(result.data.bankAccount).toBe('123456789')
    // The row is the benefit line too — what the agreement's box and the staff tables show.
    expect(result.data.benefit1).toBe('כניסה לאתר: 60 ₪ (במקום 1200 ₪)')
    expect(result.data.benefit2).toBe('')
    expect(result.data.redemption).toBe('')
    expect(result.data.couponCode).toBe('')
  })

  it('checks every benefit row that was started, and only those', () => {
    const result = validateRegistration({ ...base, ...benefit18, service2SitePrice: '90' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.fields).toEqual({ service2Type: expect.any(String), service2TourismPrice: expect.any(String) })
  })

  it('moves a filled row up when the one above it was left empty', () => {
    const result = validateRegistration({ ...base, ...benefit18, service3Type: 'סדנה', service3TourismPrice: '40', service3SitePrice: '80' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([result.data.service2Type, result.data.service2TourismPrice, result.data.service2SitePrice]).toEqual(['סדנה', '40', '80'])
    expect(result.data.service3Type).toBe('')
  })

  it('refuses a price that is not shekels, and a tourism-month price that is not below the site price', () => {
    const notShekels = validateRegistration({ ...base, ...benefit18, service1TourismPrice: 'חינם', service1SitePrice: '12.345' })
    expect(notShekels.ok).toBe(false)
    if (!notShekels.ok) expect(Object.keys(notShekels.fields).sort()).toEqual(['service1SitePrice', 'service1TourismPrice'])

    const notLower = validateRegistration({ ...base, ...benefit18, service1TourismPrice: '90', service1SitePrice: '90' })
    expect(notLower.ok).toBe(false)
    if (!notLower.ok) expect(Object.keys(notLower.fields)).toEqual(['service1TourismPrice'])
  })
})
