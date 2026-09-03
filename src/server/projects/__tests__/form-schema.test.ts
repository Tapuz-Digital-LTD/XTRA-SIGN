import { describe, expect, it } from 'vitest'
import { normalizeFields, validateSubmission, type FormField } from '../form-schema'

describe('normalizeFields', () => {
  it('falls back to the default fields when nothing is stored', () => {
    const fields = normalizeFields(null)
    expect(fields.map((f) => f.id)).toContain('name')
    expect(fields.every((f) => typeof f.label === 'string' && f.label)).toBe(true)
  })

  it('understands the V1 shape ({key, label, required})', () => {
    const fields = normalizeFields([
      { key: 'name', label: 'שם החברה', required: true },
      { key: 'phone', label: 'טלפון', required: true },
      { key: 'custom_abc', label: 'הערה', required: false },
    ])
    expect(fields.map((f) => f.id)).toEqual(['name', 'phone', 'custom_abc'])
    expect(fields[1].type).toBe('phone') // system fields keep their fixed type
    expect(fields[2].type).toBe('text')
  })

  it('drops selects with no options, duplicates, and unknown ids', () => {
    const fields = normalizeFields([
      { id: 'name', type: 'text', label: 'שם' },
      { id: 'name', type: 'text', label: 'שוב שם' },
      { id: 'custom_a', type: 'select', label: 'ריק', options: [] },
      { id: 'evil"; drop table', type: 'text', label: 'רע' },
      { id: 'custom_b', type: 'select', label: 'אזור', options: ['צפון', 'דרום'] },
    ])
    expect(fields.map((f) => f.id)).toEqual(['name', 'custom_b'])
  })

  it('always keeps a visible company-name field', () => {
    const fields = normalizeFields([{ id: 'custom_x', type: 'text', label: 'משהו' }])
    expect(fields[0].id).toBe('name')
  })

  it('never lets a client override a system field type', () => {
    const fields = normalizeFields([{ id: 'phone', type: 'textarea', label: 'טלפון' }])
    expect(fields.find((f) => f.id === 'phone')?.type).toBe('phone')
  })
})

describe('validateSubmission', () => {
  const fields: FormField[] = [
    { id: 'name', type: 'text', label: 'שם החברה', required: true },
    { id: 'email', type: 'email', label: 'אימייל', required: false },
    { id: 'phone', type: 'phone', label: 'טלפון', required: true },
    { id: 'custom_branches', type: 'number', label: 'מספר סניפים', required: false },
    { id: 'custom_region', type: 'select', label: 'אזור', required: true, options: ['צפון', 'מרכז'] },
    { id: 'custom_kinds', type: 'multiselect', label: 'סוגים', required: false, options: ['א', 'ב'] },
    { id: 'custom_terms', type: 'checkbox', label: 'אישור תנאים', required: true },
    { id: 'custom_hidden', type: 'text', label: 'נסתר', required: true, hidden: true },
  ]

  it('accepts a full valid submission and normalises values', () => {
    const result = validateSubmission(fields, {
      name: '  חברת בדיקה  ',
      email: 'Someone@Example.COM',
      phone: '050-123-4567',
      custom_branches: '12',
      custom_region: 'צפון',
      custom_kinds: ['א', 'ב', 'לא-קיים'],
      custom_terms: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.name).toBe('חברת בדיקה')
    expect(result.data.email).toBe('someone@example.com')
    expect(result.data.phone).toBe('+972501234567')
    expect(result.data.custom_kinds).toBe('א, ב')
    expect(result.data.custom_terms).toBe('כן')
    // Hidden fields are neither required nor accepted.
    expect(result.data.custom_hidden).toBeUndefined()
  })

  it('reports errors per field', () => {
    const result = validateSubmission(fields, {
      email: 'not-an-email',
      custom_region: 'לא-ברשימה',
      custom_branches: 'abc',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.fields).sort()).toEqual(
      ['custom_branches', 'custom_region', 'custom_terms', 'email', 'name', 'phone'].sort(),
    )
  })

  it('ignores keys the form never asked for', () => {
    const result = validateSubmission(fields, {
      name: 'חברה',
      phone: '0501234567',
      custom_region: 'מרכז',
      custom_terms: 'on',
      organizationId: 'evil',
      status: 'approved',
      companyId: 'evil',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.organizationId).toBeUndefined()
    expect(result.data.status).toBeUndefined()
    expect(result.data.companyId).toBeUndefined()
  })

  it('caps value length', () => {
    const result = validateSubmission(
      [{ id: 'name', type: 'text', label: 'שם', required: true }],
      { name: 'א'.repeat(5000) },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.name.length).toBeLessThanOrEqual(300)
  })
})
