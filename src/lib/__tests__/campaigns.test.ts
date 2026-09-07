import { describe, expect, it } from 'vitest'
import { audienceLabel, closedState, COMPARISON_ROWS, describeCampaign, hasForm, kindForEntry, registrationsOpen, tabsFor } from '@/lib/campaigns'

describe('registrationsOpen', () => {
  const now = new Date('2026-09-07T10:00:00Z')
  it('is open while active with no end date', () => {
    expect(registrationsOpen({ endsAt: null, registrationsAfterEnd: false, status: 'active' }, now)).toBe(true)
  })
  it('closes at the end date unless asked to stay open', () => {
    expect(registrationsOpen({ endsAt: '2026-09-01T00:00:00Z', registrationsAfterEnd: false, status: 'active' }, now)).toBe(false)
    expect(registrationsOpen({ endsAt: '2026-09-01T00:00:00Z', registrationsAfterEnd: true, status: 'active' }, now)).toBe(true)
  })
  it('a paused or ended campaign is closed whatever the dates say, and reopens when set active', () => {
    expect(registrationsOpen({ endsAt: null, registrationsAfterEnd: true, status: 'paused' }, now)).toBe(false)
    expect(registrationsOpen({ endsAt: null, registrationsAfterEnd: true, status: 'ended' }, now)).toBe(false)
    expect(registrationsOpen({ endsAt: null, registrationsAfterEnd: true, status: 'active' }, now)).toBe(true)
  })
  it('rows without a status (older campaigns) behave as active', () => {
    expect(registrationsOpen({ endsAt: null, registrationsAfterEnd: false }, now)).toBe(true)
  })
  it('names why the page is closed', () => {
    expect(closedState({ endsAt: null, registrationsAfterEnd: false, status: 'paused' }, now)).toBe('paused')
    expect(closedState({ endsAt: '2026-09-01T00:00:00Z', registrationsAfterEnd: false, status: 'active' }, now)).toBe('ended')
    expect(closedState({ endsAt: null, registrationsAfterEnd: false, status: 'active' }, now)).toBeNull()
  })
})

describe('campaign shape', () => {
  it('derives goal and entry for rows that predate the columns', () => {
    expect(describeCampaign({ campaignKind: 'signature' })).toEqual({ goal: 'signing', entry: 'audience' })
    expect(describeCampaign({ campaignKind: 'public', landingEnabled: true })).toEqual({ goal: 'inquiries', entry: 'form' })
    expect(describeCampaign({ campaignKind: 'public', selfServiceEnabled: true, selfServiceSkin: 'tourism-2026' })).toEqual({ goal: 'signing', entry: 'custom' })
    expect(describeCampaign({ goal: 'inquiries', entryMethod: 'api' })).toEqual({ goal: 'inquiries', entry: 'api' })
  })
  it('shows the registrations tab only where a form brings people in; invitations everywhere, in the agreed order', () => {
    expect(tabsFor('audience')).not.toContain('registrations')
    for (const e of ['form', 'embed', 'api', 'custom'] as const) expect(tabsFor(e)).toContain('registrations')
    expect(tabsFor('form')).toEqual(['overview', 'audience', 'invitations', 'registrations', 'agreements', 'distributions', 'reports', 'settings'])
    expect(tabsFor('audience')).toEqual(['overview', 'audience', 'invitations', 'agreements', 'distributions', 'reports', 'settings'])
    expect(hasForm('audience')).toBe(false)
    expect(kindForEntry('embed')).toBe('public')
    expect(kindForEntry('audience')).toBe('signature')
  })
})

describe('the wizard\'s words', () => {
  it('names the audience, and both when the row has none', () => {
    expect(audienceLabel('supplier')).toBe('ספקים')
    expect(audienceLabel('customer')).toBe('לקוחות')
    expect(audienceLabel(null)).toBe('ספקים ולקוחות')
  })
  it('compares the two goals row by row with both columns filled', () => {
    expect(COMPARISON_ROWS).toHaveLength(7)
    for (const row of COMPARISON_ROWS) {
      expect(row.label.trim()).not.toBe('')
      expect(row.inquiries.trim()).not.toBe('')
      expect(row.signing.trim()).not.toBe('')
    }
  })
})
