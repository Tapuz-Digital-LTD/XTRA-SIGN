import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InforuEmailProvider, InforuSmsProvider } from '../inforu'

const OK = { StatusId: 1, StatusDescription: 'Success', RequestId: 'req-123' }

function mockFetch(impl: (url: string, init: RequestInit) => unknown) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const body = impl(url, init)
    return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response
  })
}

beforeEach(() => {
  process.env.INFORU_API_URL = 'https://capi.inforu.co.il/api'
  process.env.BASE_CREDENTIALS = 'test-credentials'
  delete process.env.SIGN_LOG_NOTIFICATIONS
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('InforuSmsProvider', () => {
  it('sends the 05X national form and returns the RequestId for the Delivery row', async () => {
    let sent: Record<string, unknown> = {}
    const fetchMock = mockFetch((_url, init) => {
      sent = JSON.parse(init.body as string)
      return OK
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new InforuSmsProvider().send({ to: '+972501234567', text: 'קוד: 123456' })

    expect(result).toEqual({ ok: true, providerMessageId: 'req-123' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://capi.inforu.co.il/api/v2/SMS/SendSms')
    expect((sent.Data as Record<string, unknown>).Recipients).toEqual([{ Phone: '0501234567' }])
  })

  it('rejects an unreadable number before spending a provider call', async () => {
    const fetchMock = mockFetch(() => OK)
    vi.stubGlobal('fetch', fetchMock)

    const result = await new InforuSmsProvider().send({ to: 'not-a-phone', text: 'x' })

    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a non-1 StatusId as a failure, not a success', async () => {
    // The response is HTTP 200 — only StatusId distinguishes accepted from rejected.
    vi.stubGlobal('fetch', mockFetch(() => ({ StatusId: -1, StatusDescription: 'Invalid sender' })))

    const result = await new InforuSmsProvider().send({ to: '0501234567', text: 'x' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('Invalid sender')
  })

  it('reports NOT sent when credentials are missing', async () => {
    // A dev environment must not look like a working one.
    delete process.env.BASE_CREDENTIALS
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = mockFetch(() => OK)
    vi.stubGlobal('fetch', fetchMock)

    const provider = new InforuSmsProvider()
    expect(provider.isConfigured()).toBe(false)

    const result = await provider.send({ to: '0501234567', text: 'x' })
    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a 4xx — the same bad request would only fail again', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({}),
    }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await new InforuSmsProvider().send({ to: '0501234567', text: 'x' })

    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transport failure and succeeds on a later attempt', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('network down')
      return { ok: true, status: 200, statusText: 'OK', json: async () => OK } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new InforuSmsProvider().send({ to: '0501234567', text: 'x' })

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  }, 10_000)
})

describe('InforuEmailProvider', () => {
  it('posts to the Umail endpoint with the configured sender', async () => {
    let sent: Record<string, unknown> = {}
    const fetchMock = mockFetch((_url, init) => {
      sent = JSON.parse(init.body as string)
      return OK
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new InforuEmailProvider().send({
      to: 'supplier@example.com',
      subject: 'מסמך לחתימה',
      html: '<p>שלום</p>',
      text: 'שלום',
      recipientName: 'ישראל',
    })

    expect(result).toEqual({ ok: true, providerMessageId: 'req-123' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://capi.inforu.co.il/api/Umail/Message/Send')
    expect(sent.FromAddress).toBe('services@xtra.co.il')
    expect(sent.IncludeContacts).toEqual([{ Email: 'supplier@example.com', FirstName: 'ישראל' }])
  })
})
