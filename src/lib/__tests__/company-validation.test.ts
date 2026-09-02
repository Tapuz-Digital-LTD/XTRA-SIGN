import { describe, expect, it } from 'vitest'
import { validateCompanyField, validateCompanyFields } from '../company-validation'

/**
 * These rules run in the browser and on the server from this one module, so a
 * form can never accept what the server would refuse.
 */
describe('validateCompanyField', () => {
  it('requires a name', () => {
    expect(validateCompanyField('name', '   ')).toBeTruthy()
    expect(validateCompanyField('name', 'מקדונלדס')).toBeNull()
  })

  it.each(['abc', 'בהבבבההה', '12', '05012345678901'])('refuses %s as a phone', (value) => {
    expect(validateCompanyField('contactPhone', value)).toBeTruthy()
  })

  it.each(['0501234567', '050-123-4567', '+972501234567'])('accepts %s as a phone', (value) => {
    expect(validateCompanyField('contactPhone', value)).toBeNull()
  })

  it.each(['nope', 'a@b', '@b.com'])('refuses %s as an email', (value) => {
    expect(validateCompanyField('contactEmail', value)).toBeTruthy()
  })

  it('accepts a real email', () => {
    expect(validateCompanyField('contactEmail', 'tomer@xtra.co.il')).toBeNull()
  })

  it('leaves optional fields alone when empty', () => {
    for (const field of ['taxId', 'contactPhone', 'contactEmail'] as const) {
      expect(validateCompanyField(field, '')).toBeNull()
    }
  })

  it('reports every bad field at once', () => {
    const errors = validateCompanyFields({ name: '', contactPhone: 'abc', contactEmail: 'nope' })
    expect(Object.keys(errors).sort()).toEqual(['contactEmail', 'contactPhone', 'name'])
  })
})
