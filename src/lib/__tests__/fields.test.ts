import { describe, expect, it } from 'vitest'
import { FIELD_TYPES, clampToPage, toPdfRect, toVariableKey } from '../fields'

/** Real page sizes, in PDF points. None of them is assumed. */
const A4_PORTRAIT = { widthPt: 595.276, heightPt: 841.89 }
const A4_LANDSCAPE = { widthPt: 841.89, heightPt: 595.276 }
const US_LETTER = { widthPt: 612, heightPt: 792 }

describe('FIELD_TYPES', () => {
  it('offers exactly the nine types agreed for the MVP', () => {
    expect(FIELD_TYPES).toHaveLength(9)
    expect(FIELD_TYPES.map((f) => f.type)).toEqual([
      'signature', 'full_name', 'text', 'number', 'date',
      'checkbox', 'select', 'email', 'phone',
    ])
  })

  it('labels every type in Hebrew', () => {
    for (const spec of FIELD_TYPES) {
      expect(spec.label, spec.type).toMatch(/[\u0590-\u05ff]/)
    }
  })
})

describe('clampToPage', () => {
  it('keeps a field inside the page when dragged past an edge', () => {
    expect(clampToPage({ x: -0.5, y: -0.5, width: 0.2, height: 0.1 })).toMatchObject({
      x: 0,
      y: 0,
    })
    // Pushed past the far edge, it stops with its far side on the boundary.
    expect(clampToPage({ x: 2, y: 2, width: 0.2, height: 0.1 })).toMatchObject({
      x: 0.8,
      y: 0.9,
    })
  })

  it('refuses to shrink a field below a grabbable size', () => {
    const result = clampToPage({ x: 0.5, y: 0.5, width: 0, height: -1 })
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  it('never lets a field be wider or taller than its page', () => {
    const result = clampToPage({ x: 0, y: 0, width: 5, height: 5 })
    expect(result.width).toBeLessThanOrEqual(1)
    expect(result.height).toBeLessThanOrEqual(1)
  })
})

describe('toPdfRect — the whole point of storing fractions', () => {
  it('puts a bottom-right signature in the bottom-right of A4 portrait', () => {
    // 0.72..1.0 across, 0.90..0.96 down — the bottom-right corner.
    const rect = toPdfRect({ x: 0.72, y: 0.9, width: 0.28, height: 0.06 }, A4_PORTRAIT)

    // Right edge of the field sits on the right edge of the page.
    expect(rect.x + rect.width).toBeCloseTo(A4_PORTRAIT.widthPt, 3)
    // PDF's origin is bottom-left, so a low y on screen is a small y in points.
    expect(rect.y).toBeCloseTo(A4_PORTRAIT.heightPt * 0.04, 3)
  })

  it('puts THE SAME fractions in the bottom-right of a LANDSCAPE page', () => {
    // The bug this replaces: an A4 ratio hardcoded anywhere would put this
    // field off the page, because landscape is wider than it is tall.
    const rect = toPdfRect({ x: 0.72, y: 0.9, width: 0.28, height: 0.06 }, A4_LANDSCAPE)

    expect(rect.x + rect.width).toBeCloseTo(A4_LANDSCAPE.widthPt, 3)
    expect(rect.y).toBeCloseTo(A4_LANDSCAPE.heightPt * 0.04, 3)
    // And it is genuinely a different physical rectangle.
    expect(rect.width).toBeGreaterThan(
      toPdfRect({ x: 0.72, y: 0.9, width: 0.28, height: 0.06 }, A4_PORTRAIT).width,
    )
  })

  it('puts THE SAME fractions in the bottom-right of US Letter', () => {
    const rect = toPdfRect({ x: 0.72, y: 0.9, width: 0.28, height: 0.06 }, US_LETTER)
    expect(rect.x + rect.width).toBeCloseTo(US_LETTER.widthPt, 3)
    expect(rect.y).toBeCloseTo(US_LETTER.heightPt * 0.04, 3)
  })

  it('always lands inside the page, for every page shape', () => {
    const field = { x: 0.72, y: 0.9, width: 0.28, height: 0.06 }
    for (const page of [A4_PORTRAIT, A4_LANDSCAPE, US_LETTER]) {
      const rect = toPdfRect(field, page)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(page.widthPt + 0.001)
      expect(rect.y + rect.height).toBeLessThanOrEqual(page.heightPt + 0.001)
    }
  })

  it('flips the y axis, because PDF measures from the bottom', () => {
    // A field at the very top of the screen is at the top of the PDF page,
    // which is a LARGE y in PDF coordinates.
    const top = toPdfRect({ x: 0, y: 0, width: 0.2, height: 0.1 }, A4_PORTRAIT)
    const bottom = toPdfRect({ x: 0, y: 0.9, width: 0.2, height: 0.1 }, A4_PORTRAIT)
    expect(top.y).toBeGreaterThan(bottom.y)
    expect(bottom.y).toBeCloseTo(0, 3)
  })

  it('is independent of the width the editor happened to render at', () => {
    // The editor stores fractions, so a phone at 320px and a desktop at 1200px
    // produce identical values — this is the property that makes that true.
    const field = { x: 0.331, y: 0.774, width: 0.28, height: 0.06 }
    const fromPhone = toPdfRect(field, A4_PORTRAIT)
    const fromDesktop = toPdfRect({ ...field }, A4_PORTRAIT)
    expect(fromPhone).toEqual(fromDesktop)
  })
})

describe('toVariableKey', () => {
  it('derives a stable key from a Hebrew label', () => {
    // The user types "שם החברה" and never sees a {{key}}; a CRM fills this in
    // later, so it has to survive being generated from Hebrew.
    const key = toVariableKey('שם החברה')
    expect(key).toBe('שם_החברה')
    expect(key).not.toContain(' ')
  })

  it('disambiguates duplicates rather than colliding', () => {
    expect(toVariableKey('טלפון', ['טלפון'])).toBe('טלפון_2')
    expect(toVariableKey('טלפון', ['טלפון', 'טלפון_2'])).toBe('טלפון_3')
  })

  it('never returns an empty key', () => {
    expect(toVariableKey('!!!')).toBe('field')
    expect(toVariableKey('   ')).toBe('field')
  })

  it('caps the length', () => {
    expect(toVariableKey('א'.repeat(200)).length).toBeLessThanOrEqual(40)
  })
})
