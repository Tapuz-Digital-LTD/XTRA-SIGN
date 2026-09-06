import { afterEach, describe, expect, it } from 'vitest'
import { otpSmsText } from '../otp-sms'

describe('otpSmsText', () => {
  const original = process.env.SIGN_PUBLIC_URL
  afterEach(() => {
    process.env.SIGN_PUBLIC_URL = original
  })

  it('ends with the WebOTP domain-bound line on a real host', () => {
    process.env.SIGN_PUBLIC_URL = 'https://sign.example.co.il'
    const text = otpSmsText('קוד הכניסה שלך ל-XTRA SIGN הוא:', '123456')
    const lines = text.split('\n')
    expect(lines[0]).toBe('קוד הכניסה שלך ל-XTRA SIGN הוא: 123456')
    expect(lines.at(-1)).toBe('@sign.example.co.il #123456')
    expect(lines.at(-2)).toBe('')
  })

  it('leaves a local dev server without the binding line', () => {
    process.env.SIGN_PUBLIC_URL = 'http://localhost:3057'
    expect(otpSmsText('קוד:', '654321')).toBe('קוד: 654321')
  })
})
