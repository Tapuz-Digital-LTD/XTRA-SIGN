import { describe, expect, it } from 'vitest'
import { normalizeSlug, validateSlug } from '../public-slug'

describe('normalizeSlug', () => {
  it('lower-cases, turns whitespace and underscores into hyphens, drops the rest', () => {
    expect(normalizeSlug('  Israel Tourism  Month_2026 ')).toBe('israel-tourism-month-2026')
    expect(normalizeSlug('camp--aign---b')).toBe('camp-aign-b')
    expect(normalizeSlug('-lead/trail!-')).toBe('leadtrail')
  })
})

describe('validateSlug', () => {
  it('accepts a plain address', () => {
    expect(validateSlug('Campaign B')).toEqual({ ok: true, slug: 'campaign-b' })
  })
  it('refuses Hebrew, too short, too long, reserved and empty', () => {
    expect(validateSlug('תיירות').ok).toBe(false)
    expect(validateSlug('ab').ok).toBe(false)
    expect(validateSlug('a'.repeat(61)).ok).toBe(false)
    expect(validateSlug('api').ok).toBe(false)
    expect(validateSlug('Projects').ok).toBe(false)
    expect(validateSlug('   ').ok).toBe(false)
  })
})
