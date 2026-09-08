import { describe, expect, it } from 'vitest'
import type { FieldMeta, RunRequest } from '@/server/reports/engine/types'
import { conditionComplete, decodeRequest, encodeRequest, shapeOf } from '../shared'

const request: RunRequest = {
  entity: 'people',
  clauses: [{ any: [{ field: 'name', op: 'contains', value: 'משה כהן' }, { field: 'follow_up_at', op: 'before', value: 'tomorrow' }] }, { any: [{ field: 'campaign', op: 'one_of', value: ['a-b-c'] }] }],
  columns: ['name', 'phone'],
  sort: { field: 'name', dir: 'asc' },
  page: 3,
  pageSize: 50,
}

describe('the definition in the URL', () => {
  it('round-trips Hebrew, lists and paging through base64url', () => {
    const encoded = encodeRequest(request)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeRequest(encoded)).toEqual(request)
  })
  it('refuses garbage and unknown entities, and repairs paging', () => {
    expect(decodeRequest('not base64!')).toBeNull()
    expect(decodeRequest(encodeRequest({ ...request, entity: 'x' as RunRequest['entity'] }))).toBeNull()
    expect(decodeRequest(encodeRequest({ ...request, page: -1, pageSize: 7 }))).toMatchObject({ page: 1, pageSize: 25 })
  })
})

describe('conditions', () => {
  const fields: FieldMeta[] = [
    { key: 'name', label: 'שם', type: 'text', defaultVisible: true, filterable: true, sortable: true, group: 'פרטים' },
    { key: 'signed_at', label: 'נחתם', type: 'date', defaultVisible: true, filterable: true, sortable: true, group: 'חתימה' },
    { key: 'tags', label: 'תגים', type: 'tags', defaultVisible: false, filterable: true, sortable: false, group: 'פרטים' },
  ]
  it('picks the control by type and operator', () => {
    expect(shapeOf('date', 'between')).toBe('dateRange')
    expect(shapeOf('date', 'last_days')).toBe('days')
    expect(shapeOf('enum', 'one_of')).toBe('many')
    expect(shapeOf('text', 'is_empty')).toBe('none')
  })
  it('knows when a condition says something', () => {
    expect(conditionComplete(fields, { field: 'name', op: 'contains', value: '' })).toBe(false)
    expect(conditionComplete(fields, { field: 'name', op: 'is_empty' })).toBe(true)
    expect(conditionComplete(fields, { field: 'signed_at', op: 'between', value: { from: '2026-01-01' } })).toBe(true)
    expect(conditionComplete(fields, { field: 'signed_at', op: 'last_days', value: { days: 0 } })).toBe(false)
    expect(conditionComplete(fields, { field: 'tags', op: 'contains_any', value: [] })).toBe(false)
    expect(conditionComplete(fields, { field: '', op: 'is' })).toBe(false)
  })
})
