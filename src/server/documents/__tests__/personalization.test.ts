import { describe, expect, it } from 'vitest'
import { personalize, resolveAutoSource } from '@/server/documents/personalization'

const acme = {
  name: 'אקמה בע"מ',
  taxId: '514123456',
  contactName: 'דנה כהן',
  contactPhone: '+972501112222',
  contactEmail: 'dana@acme.co.il',
  address: 'הרצל 1, תל אביב',
}

describe('personalization', () => {
  it('resolves each source from the company it is sent to', () => {
    expect(resolveAutoSource('company.name', acme)).toBe('אקמה בע"מ')
    expect(resolveAutoSource('company.tax_id', acme)).toBe('514123456')
    expect(resolveAutoSource('company.contact_name', acme)).toBe('דנה כהן')
  })

  it('stamps the send date in Israeli format', () => {
    expect(resolveAutoSource('today', acme, new Date('2026-03-09T22:30:00Z'))).toBe('10.03.2026')
  })

  it('gives two companies different values from the same template', () => {
    const fields = [
      { id: 'f1', label: 'שם החברה', autoSource: 'company.name', required: true },
      { id: 'f2', label: 'ח.פ', autoSource: 'company.tax_id', required: true },
    ]
    const other = { ...acme, name: 'בטא שירותים', taxId: '515999888' }

    const a = personalize(fields, acme)
    const b = personalize(fields, other)

    expect(a.values.get('f1')).toBe('אקמה בע"מ')
    expect(b.values.get('f1')).toBe('בטא שירותים')
    // The whole point: the same template must not produce the same document.
    expect(a.values.get('f2')).not.toBe(b.values.get('f2'))
  })

  it('reports a missing required value instead of leaving a blank line', () => {
    const fields = [{ id: 'f1', label: 'ח.פ', autoSource: 'company.tax_id', required: true }]
    const { values, missing } = personalize(fields, { ...acme, taxId: null })

    expect(values.has('f1')).toBe(false)
    expect(missing).toEqual([{ label: 'ח.פ', source: 'company.tax_id' }])
  })

  it('lets an optional missing value through', () => {
    const fields = [{ id: 'f1', label: 'כתובת', autoSource: 'company.address', required: false }]
    expect(personalize(fields, { ...acme, address: null }).missing).toEqual([])
  })
})
