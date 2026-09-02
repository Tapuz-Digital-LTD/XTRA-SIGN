import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { runAgentTurn, aiConfigured } from '@/server/ai/agent'
import {
  appendMessage,
  createConversation,
  loadMessages,
} from '@/server/ai/conversations'
import type { ScreenContext } from '@/server/ai/registry'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { consume } from '@/server/http/rate-limit'

/**
 * One turn of the assistant, streamed.
 *
 * Server-sent events rather than a single response: a turn that searches, reads
 * and prepares eighty documents takes long enough that a frozen screen would be
 * the whole experience.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    if (!aiConfigured()) {
      return NextResponse.json(
        { error: { message: 'XTRA AI אינו זמין כרגע. שאר המערכת ממשיכה לפעול כרגיל.' } },
        { status: 503 },
      )
    }

    // A language model is expensive to run in a loop; this is the ceiling.
    const gate = await consume('aiTurn', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'יותר מדי בקשות. נסו שוב בעוד רגע.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as {
      message?: unknown
      conversationId?: unknown
      screen?: unknown
    } | null

    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: { message: 'אין מה לשלוח.' } }, { status: 400 })
    }

    const conversationId =
      typeof body?.conversationId === 'string' && body.conversationId
        ? body.conversationId
        : await createConversation(session, message)

    // Reads the history through the authorized loader, which throws if this
    // conversation belongs to someone else.
    const history = await loadMessages(session, conversationId)
    await appendMessage({ conversationId, role: 'user', content: message })

    const screen = readScreen(body?.screen)
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (event: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

        send({ type: 'conversation', conversationId })
        const spoken: string[] = []

        try {
          for await (const event of runAgentTurn({
            session,
            conversationId,
            history: [...history, { role: 'user', content: message }],
            screen,
            ip: request.headers.get('x-forwarded-for'),
            userAgent: request.headers.get('user-agent'),
            signal: request.signal,
          })) {
            if (event.type === 'text') spoken.push(event.text)
            send(event)
          }
        } catch {
          send({ type: 'error', message: 'משהו השתבש. נסו שוב.' })
        } finally {
          // Persist whatever was actually said, even on a cancelled turn, so
          // reopening the conversation shows what happened.
          if (spoken.length) {
            await appendMessage({
              conversationId,
              role: 'assistant',
              content: spoken.join('\n\n'),
            }).catch(() => {})
          }
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    return templateFailure(error)
  }
}

/** The screen hint, taken apart field by field so nothing else rides along. */
function readScreen(raw: unknown): ScreenContext {
  const value = (raw ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null)
  return {
    page: text('page'),
    companyId: text('companyId'),
    documentId: text('documentId'),
    groupId: text('groupId'),
    templateId: text('templateId'),
    selectedIds: Array.isArray(value.selectedIds)
      ? (value.selectedIds.filter((id) => typeof id === 'string') as string[]).slice(0, 200)
      : [],
  }
}
