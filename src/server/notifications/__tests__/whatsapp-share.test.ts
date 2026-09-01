import { describe, expect, it } from 'vitest'
import { buildShareMessage, buildWhatsAppShareUrl } from '../whatsapp-share'

const base = { recipientName: 'ישראל ישראלי', signingLink: 'https://sign.xtra.co.il/sign/abc123' }

describe('buildShareMessage', () => {
  it('greets by name and carries the signing link', () => {
    expect(buildShareMessage(base)).toBe(
      'שלום ישראל ישראלי,\nמחכה לך מסמך לחתימה מ-XTRA:\nhttps://sign.xtra.co.il/sign/abc123',
    )
  })

  it('falls back to a bare greeting when the name is blank', () => {
    expect(buildShareMessage({ ...base, recipientName: '   ' })).toMatch(/^שלום,\n/)
  })
})

describe('buildWhatsAppShareUrl', () => {
  it('opens the contact picker when no number is known', () => {
    const url = buildWhatsAppShareUrl(base)
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
  })

  it('targets the contact directly when a number is known, digits only', () => {
    const url = buildWhatsAppShareUrl({ ...base, phoneE164: '+972501234567' })
    expect(url.startsWith('https://wa.me/972501234567?text=')).toBe(true)
    expect(url).not.toContain('+')
  })

  it('encodes the link so the query string survives intact', () => {
    const url = buildWhatsAppShareUrl(base)
    const text = decodeURIComponent(new URL(url).searchParams.get('text')!)
    expect(text).toContain(base.signingLink)
  })
})
