import { describe, expect, it } from 'vitest'
import { answersOf, formatAnswer, TOURISM_FORM_COLUMNS } from '../form-columns'

describe('form columns', () => {
  it('reads the snapshot first and lets the row win', () => {
    const answers = answersOf({ commercialName: 'מערות הים', contactPerson: '' }, { commercialName: 'ישן', week: 'week_2', optionalExtension: true, benefit1: '25% הנחה' })
    expect(answers).toEqual({ commercialName: 'מערות הים', week: 'week_2', optionalExtension: 'true', benefit1: '25% הנחה' })
    expect(answersOf(null, undefined)).toEqual({})
  })

  it('says a stored code in the form\'s words', () => {
    const week = TOURISM_FORM_COLUMNS.find((c) => c.key === 'week')!
    expect(formatAnswer(week, 'week_2')).toBe('שבוע שני - צפון')
    expect(formatAnswer(TOURISM_FORM_COLUMNS.find((c) => c.key === 'optionalExtension')!, 'true')).toBe('כן')
    expect(formatAnswer(TOURISM_FORM_COLUMNS.find((c) => c.key === 'benefit1')!, '25% הנחה')).toBe('25% הנחה')
    expect(formatAnswer(week, undefined)).toBe('')
  })
})
