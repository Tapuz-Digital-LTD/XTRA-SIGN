import { describe, expect, it } from 'vitest'
import {
  isSamePhone,
  maskPhone,
  normalizeIsraeliPhone,
  toIsraeliNationalFormat,
} from '../phone'

describe('normalizeIsraeliPhone', () => {
  it('collapses every spelling of one number to a single key', () => {
    const expected = '+972501234567'
    for (const spelling of [
      '0501234567',
      '050-123-4567',
      '050 123 4567',
      '+972501234567',
      '+972-50-123-4567',
      '00972501234567',
      '972501234567',
      ' 0501234567 ',
    ]) {
      expect(normalizeIsraeliPhone(spelling), spelling).toBe(expected)
    }
  })

  it('strips the RTL/LTR marks Hebrew form fields inject', () => {
    expect(normalizeIsraeliPhone('‏050-123-4567‎')).toBe('+972501234567')
  })

  it('accepts 057 — XTRA Sign serves whoever the sender contracted with', () => {
    // The gift-card app blocks 056/057/059 as a business decision. Inheriting
    // that would stop a real supplier from receiving a signing link.
    expect(normalizeIsraeliPhone('0571234567')).toBe('+972571234567')
    expect(normalizeIsraeliPhone('0561234567')).toBe('+972561234567')
    expect(normalizeIsraeliPhone('0591234567')).toBe('+972591234567')
  })

  it('returns null rather than guessing at anything unreadable', () => {
    for (const bad of ['', '   ', 'abc', '05012345', '05012345678', '0301234567', null, undefined, 12345 as never]) {
      expect(normalizeIsraeliPhone(bad as string), String(bad)).toBeNull()
    }
  })

  it('treats a local number starting 972 as local, not as a country code', () => {
    // 0972123456 is 10 digits: a local number that happens to begin with 972.
    expect(normalizeIsraeliPhone('0972123456')).toBeNull()
  })
})

describe('toIsraeliNationalFormat', () => {
  it('produces the 05X form InforU expects', () => {
    expect(toIsraeliNationalFormat('+972501234567')).toBe('0501234567')
    expect(toIsraeliNationalFormat('nonsense')).toBeNull()
  })
})

describe('maskPhone', () => {
  it('masks the middle for the signature certificate', () => {
    expect(maskPhone('0501234567')).toBe('050-XXX-4567')
  })
})

describe('isSamePhone', () => {
  it('matches across spellings', () => {
    expect(isSamePhone('050-123-4567', '+972501234567')).toBe(true)
  })

  it('never matches unreadable values, even when identical', () => {
    // Equality on garbage is not identity — two bad strings are not one person.
    expect(isSamePhone('garbage', 'garbage')).toBe(false)
    expect(isSamePhone(null, null)).toBe(false)
  })
})
