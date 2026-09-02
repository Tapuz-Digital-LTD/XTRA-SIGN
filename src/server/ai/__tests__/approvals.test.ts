import { describe, expect, it } from 'vitest'
import { APPROVALS_REQUIRED, hashPayload } from '@/server/ai/approvals'
import { allTools, getTool } from '@/server/ai/registry'
import '@/server/ai/tools'

describe('approval hashing', () => {
  it('is stable regardless of key order', () => {
    expect(hashPayload('send', { b: 2, a: 1 })).toBe(hashPayload('send', { a: 1, b: 2 }))
  })

  it('changes when any argument changes', () => {
    const before = hashPayload('run_bulk_send', { companyIds: ['a', 'b'] })
    const after = hashPayload('run_bulk_send', { companyIds: ['a', 'c'] })
    // This is what stops an approval for one batch authorising another.
    expect(before).not.toBe(after)
  })

  it('distinguishes two tools called with the same arguments', () => {
    expect(hashPayload('send_document', { id: 'x' })).not.toBe(hashPayload('cancel_document', { id: 'x' }))
  })

  it('ignores undefined so an omitted optional does not change the hash', () => {
    expect(hashPayload('t', { a: 1, b: undefined })).toBe(hashPayload('t', { a: 1 }))
  })
})

describe('tool risk levels', () => {
  it('asks twice before anything leaves the building', () => {
    for (const name of ['run_bulk_send', 'send_document', 'remind_all_unsigned', 'retry_bulk_failures']) {
      expect(APPROVALS_REQUIRED[getTool(name)!.risk], name).toBe(2)
    }
  })

  it('asks once before changing real data', () => {
    for (const name of ['update_company', 'update_group', 'remove_companies_from_group', 'send_reminder']) {
      expect(APPROVALS_REQUIRED[getTool(name)!.risk], name).toBe(1)
    }
  })

  it('never exposes a tool that runs arbitrary code or queries', () => {
    const names = allTools().map((tool) => tool.name)
    for (const forbidden of ['execute_sql', 'query', 'http_request', 'fetch', 'eval', 'run_shell']) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('takes no organization, user or role from the model', () => {
    // Tenant identity comes from the session. A tool that accepted it as an
    // argument would be a way to read another organization's data.
    for (const tool of allTools()) {
      const properties = Object.keys(
        ((tool.input as { properties?: Record<string, unknown> }).properties ?? {}),
      )
      for (const forbidden of ['organizationId', 'userId', 'role', 'organization_id', 'user_id']) {
        expect(properties, tool.name).not.toContain(forbidden)
      }
    }
  })
})
