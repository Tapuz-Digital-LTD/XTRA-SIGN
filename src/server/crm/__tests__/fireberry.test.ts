import { afterEach, describe, expect, it } from 'vitest'
import { FireberryProvider } from '../fireberry'

describe('FireberryProvider', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('is unconfigured without a token, configured with one', () => {
    delete process.env.FIREBERRY_API_TOKEN
    expect(new FireberryProvider().isConfigured()).toBe(false)
    process.env.FIREBERRY_API_TOKEN = 'x'
    expect(new FireberryProvider().isConfigured()).toBe(true)
  })

  it('maps kinds to the standard Fireberry object numbers by default', () => {
    delete process.env.FIREBERRY_SUPPLIER_OBJECT
    delete process.env.FIREBERRY_CUSTOMER_OBJECT
    const p = new FireberryProvider()
    // Account = 1 (customer), the common custom vendor object = 1000 (supplier).
    expect(p.objectTypeForKind('customer')).toBe(1)
    expect(p.objectTypeForKind('supplier')).toBe(1000)
  })

  it('honours per-deployment object overrides', () => {
    process.env.FIREBERRY_CUSTOMER_OBJECT = '7'
    process.env.FIREBERRY_SUPPLIER_OBJECT = '1042'
    const p = new FireberryProvider()
    expect(p.objectTypeForKind('customer')).toBe(7)
    expect(p.objectTypeForKind('supplier')).toBe(1042)
  })

  it('reports a clear failure when no token is set, without a network call', async () => {
    delete process.env.FIREBERRY_API_TOKEN
    const result = await new FireberryProvider().uploadFile({
      target: { objectType: 1, recordId: 'r' },
      filename: 'f.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7'),
    })
    expect(result).toMatchObject({ ok: false })
  })
})
