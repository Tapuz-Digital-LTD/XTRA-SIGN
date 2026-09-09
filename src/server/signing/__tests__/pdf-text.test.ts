import { describe, expect, it } from 'vitest'
import { shapeForPdf } from '../pdf-text'

/**
 * What the stamper hands fontkit, so that what fontkit draws reads right.
 * A value with Hebrew is pre-reversed so fontkit's own reversal cancels out;
 * a value without Hebrew is left alone. (A Latin-first value that also has
 * Hebrew and digits still prints its digits reversed — a known gap, measured
 * in .design/qa/agreement-v2/shape-lab.ts and not yet solved.)
 */
describe('shapeForPdf', () => {
  it('leaves a value without Hebrew untouched', () => {
    expect(shapeForPdf('15%')).toBe('15%')
    expect(shapeForPdf('e2e-1@example.com')).toBe('e2e-1@example.com')
  })

  it('pre-reverses a Hebrew-first value, so fontkit\'s reversal restores the visual order', () => {
    // Visual (RTL): the Hebrew at the right, then "E2E 123" at the left.
    expect(shapeForPdf('מלון הבדיקה E2E 123')).toBe('מלון הבדיקה 321 E2E')
  })

})
