import { describe, expect, it } from 'vitest'
import { currentUrlFor, describeReturn, readReturnTo, safeReturnTo, withReturnTo } from '@/lib/return-to'

describe('safeReturnTo', () => {
  it('keeps same-origin relative paths, query string included', () => {
    expect(safeReturnTo('/projects/abc?tab=audience&view=waiting&q=x', '/x')).toBe('/projects/abc?tab=audience&view=waiting&q=x')
    expect(safeReturnTo('/suppliers?source=xtra&q=%D7%90', '/x')).toBe('/suppliers?source=xtra&q=%D7%90')
    expect(safeReturnTo('/', '/x')).toBe('/')
    expect(safeReturnTo('/ab', '/f')).toBe('/ab')
  })

  it('falls back on anything that could leave the origin', () => {
    for (const bad of ['https://evil.example', 'http://evil.example/', '//evil.example', '//evil', '/\\evil.example', 'javascript:alert(1)', 'evil.example', 'projects/abc', '']) {
      expect(safeReturnTo(bad, '/suppliers')).toBe('/suppliers')
    }
  })

  it('falls back on control characters, whitespace, backslashes anywhere, and very long values', () => {
    expect(safeReturnTo('/a' + String.fromCharCode(10) + 'b', '/f')).toBe('/f')
    expect(safeReturnTo('/a' + String.fromCharCode(9) + 'b', '/f')).toBe('/f')
    expect(safeReturnTo('/a' + String.fromCharCode(0) + 'b', '/f')).toBe('/f')
    expect(safeReturnTo('/a b', '/f')).toBe('/f')
    expect(safeReturnTo('/a?x=\\b', '/f')).toBe('/f')
    expect(safeReturnTo('/' + 'a'.repeat(600), '/f')).toBe('/f')
    expect(safeReturnTo('/' + 'a'.repeat(598), '/f')).toBe('/' + 'a'.repeat(598))
  })

  it('falls back on non-strings (a repeated query param arrives as an array)', () => {
    expect(safeReturnTo(['/a', '/b'], '/f')).toBe('/f')
    expect(safeReturnTo(undefined, '/f')).toBe('/f')
    expect(safeReturnTo(null, '/f')).toBe('/f')
    expect(safeReturnTo(42, '/f')).toBe('/f')
  })
})

describe('readReturnTo', () => {
  it('is the validated path or null', () => {
    expect(readReturnTo('/tracking?view=waiting')).toBe('/tracking?view=waiting')
    expect(readReturnTo('https://evil.example')).toBeNull()
    expect(readReturnTo(undefined)).toBeNull()
  })
})

describe('withReturnTo', () => {
  it('appends returnTo, keeping the href query', () => {
    expect(withReturnTo('/companies/1', '/projects/p?tab=audience&q=x')).toBe('/companies/1?returnTo=%2Fprojects%2Fp%3Ftab%3Daudience%26q%3Dx')
    expect(withReturnTo('/companies/1?tab=details', '/suppliers')).toBe('/companies/1?tab=details&returnTo=%2Fsuppliers')
  })

  it('replaces an existing returnTo and leaves the href alone when there is nothing to carry', () => {
    expect(withReturnTo('/companies/1?returnTo=%2Fold', '/new')).toBe('/companies/1?returnTo=%2Fnew')
    expect(withReturnTo('/companies/1', null)).toBe('/companies/1')
    expect(withReturnTo('/companies/1?tab=crm', undefined)).toBe('/companies/1?tab=crm')
  })

  it('round-trips through a query string, nested once', () => {
    const list = '/suppliers?source=xtra&q=%D7%90'
    const card = withReturnTo('/companies/1', list)
    const back = new URLSearchParams(card.split('?')[1]).get('returnTo')
    expect(safeReturnTo(back, '/f')).toBe(list)
    const doc = withReturnTo('/documents/9', card)
    const cardAgain = new URLSearchParams(doc.split('?')[1]).get('returnTo')
    expect(safeReturnTo(cardAgain, '/f')).toBe(card)
  })
})

describe('currentUrlFor', () => {
  it('joins pathname and search', () => {
    expect(currentUrlFor('/suppliers', new URLSearchParams('source=xtra&q=a'))).toBe('/suppliers?source=xtra&q=a')
    expect(currentUrlFor('/suppliers', new URLSearchParams())).toBe('/suppliers')
    expect(currentUrlFor('/suppliers', null)).toBe('/suppliers')
  })
})

describe('describeReturn', () => {
  it('names the place from the path prefix', () => {
    expect(describeReturn('/projects/abc?tab=audience&view=waiting')).toBe('חזרה לקמפיין')
    expect(describeReturn('/projects?view=signing')).toBe('חזרה לקמפיינים')
    expect(describeReturn('/suppliers?source=xtra')).toBe('חזרה לספקים')
    expect(describeReturn('/suppliers/reports?source=all')).toBe('חזרה לספקים')
    expect(describeReturn('/customers')).toBe('חזרה ללקוחות')
    expect(describeReturn('/tracking?view=waiting')).toBe('חזרה למעקב')
    expect(describeReturn('/agreements?filter=pending&page=2')).toBe('חזרה להסכמים')
    expect(describeReturn('/documents')).toBe('חזרה להסכמים')
    expect(describeReturn('/documents/9?returnTo=%2Fagreements')).toBe('חזרה להסכם')
    expect(describeReturn('/companies/1?tab=documents')).toBe('חזרה לחברה')
    expect(describeReturn('/templates')).toBe('חזרה לתבניות')
    expect(describeReturn('/')).toBe('חזרה לבית')
  })

  it('does not match on a shared prefix, and has a plain label for the rest', () => {
    expect(describeReturn('/suppliersx')).toBe('חזרה')
    expect(describeReturn('/settings')).toBe('חזרה')
  })
})
