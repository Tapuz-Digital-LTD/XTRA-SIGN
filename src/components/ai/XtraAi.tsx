'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApprovalCard } from './ApprovalCard'
import { ResultCards } from './ResultCards'

/**
 * XTRA AI — the assistant, available from every screen.
 *
 * It reads which screen you are on so that "send him the last agreement" has a
 * "him". That context is a hint sent with the question, never a permission: the
 * server re-checks access to every record it touches.
 */

type Turn =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'progress'; text: string }
  | { kind: 'result'; summary: string; data?: unknown }
  | {
      kind: 'approval'
      actionId: string
      payloadHash: string
      label: string
      approvalsRequired: number
    }
  | { kind: 'error'; text: string }

const QUICK_ACTIONS = [
  'מה דורש טיפול?',
  'מי עדיין לא חתם?',
  'צור קבוצה חדשה',
  'הראה לי את המסמכים האחרונים',
]

/** The current screen, as the few ids a question might refer to. */
function useScreenContext(): Record<string, unknown> {
  const pathname = usePathname()
  const params = useSearchParams()

  const segments = pathname.split('/').filter(Boolean)
  const [section, id] = segments
  const context: Record<string, unknown> = { page: section ?? 'home' }

  if (section === 'companies' && id) context.companyId = id
  if (section === 'documents' && id) context.documentId = id
  if (section === 'groups' && id) context.groupId = id
  if (section === 'suppliers' || section === 'customers') {
    const group = params.get('group')
    if (group) context.groupId = group
  }
  return context
}

export function XtraAi() {
  const screen = useScreenContext()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<{ id: string; title: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/conversations')
      const data = await response.json().catch(() => null)
      setHistory(data?.conversations ?? [])
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    if (open) void loadHistory()
  }, [open, loadHistory])

  async function openConversation(id: string) {
    setShowHistory(false)
    setConversationId(id)
    try {
      const response = await fetch(`/api/ai/conversations/${id}`)
      const data = await response.json().catch(() => null)
      const messages = (data?.messages ?? []) as { role: string; content: string }[]
      setTurns(
        messages.map((message) =>
          message.role === 'user'
            ? { kind: 'user' as const, text: message.content }
            : { kind: 'assistant' as const, text: message.content },
        ),
      )
    } catch {
      setTurns([{ kind: 'error', text: 'לא הצלחנו לטעון את השיחה.' }])
    }
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return

    setInput('')
    setTurns((current) => [...current, { kind: 'user', text: question }])
    setBusy(true)

    const controller = new AbortController()
    abort.current = controller

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, conversationId, screen }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null)
        setTurns((current) => [
          ...current,
          { kind: 'error', text: data?.error?.message ?? 'XTRA AI אינו זמין כרגע.' },
        ])
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Server-sent events arrive in whatever chunks the network gives; the
        // buffer is drained only on a complete event.
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>

          if (event.type === 'conversation') {
            setConversationId(String(event.conversationId))
          } else if (event.type === 'text') {
            setTurns((current) => [...current, { kind: 'assistant', text: String(event.text) }])
          } else if (event.type === 'tool_start') {
            setTurns((current) => [...current, { kind: 'progress', text: String(event.label) }])
          } else if (event.type === 'tool_result') {
            setTurns((current) => [
              ...current.filter((turn) => turn.kind !== 'progress'),
              { kind: 'result', summary: String(event.summary), data: event.data },
            ])
          } else if (event.type === 'approval') {
            setTurns((current) => [
              ...current.filter((turn) => turn.kind !== 'progress'),
              {
                kind: 'approval',
                actionId: String(event.actionId),
                payloadHash: String(event.payloadHash),
                label: String(event.label),
                approvalsRequired: Number(event.approvalsRequired ?? 1),
              },
            ])
          } else if (event.type === 'error') {
            setTurns((current) => [...current, { kind: 'error', text: String(event.message) }])
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        setTurns((current) => [...current, { kind: 'error', text: 'משהו השתבש. נסו שוב.' }])
      }
    } finally {
      setTurns((current) => current.filter((turn) => turn.kind !== 'progress'))
      setBusy(false)
      abort.current = null
      void loadHistory()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="פתיחת XTRA AI"
        className="fixed bottom-5 end-5 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
      >
        <span aria-hidden="true">✨</span> XTRA AI
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/30" onClick={() => setOpen(false)}>
      <aside
        dir="rtl"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col bg-surface shadow-2xl sm:w-[30rem]"
        aria-label="XTRA AI"
      >
        <header className="flex min-h-14 items-center gap-2 border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">
            <span aria-hidden="true">✨</span> XTRA AI
          </h2>
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            className="ms-auto min-h-11 rounded-lg px-2 text-sm text-muted hover:text-fg"
          >
            שיחות
          </button>
          <button
            type="button"
            onClick={() => {
              setTurns([])
              setConversationId(null)
              setShowHistory(false)
            }}
            className="min-h-11 rounded-lg px-2 text-sm text-brand"
          >
            + חדשה
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="סגירה"
            className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg"
          >
            ✕
          </button>
        </header>

        {showHistory ? (
          <div className="flex-1 overflow-y-auto p-3">
            {history.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted">אין עדיין שיחות.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {history.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation.id)}
                      className="w-full truncate rounded-lg px-3 py-3 text-start text-sm text-fg transition hover:bg-bg"
                    >
                      {conversation.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {turns.length === 0 ? (
              <div className="pt-6">
                <p className="text-sm text-muted">
                  אפשר לבקש ממני לחפש, ליצור, להכין מסמכים ולשלוח אותם — בעברית רגילה.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => void send(action)}
                      className="min-h-11 rounded-lg border border-line bg-bg px-3 text-start text-sm text-fg transition hover:border-brand"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {turns.map((turn, index) => {
                  if (turn.kind === 'user') {
                    return (
                      <p key={index} className="self-start rounded-2xl bg-brand px-3 py-2 text-sm text-white">
                        {turn.text}
                      </p>
                    )
                  }
                  if (turn.kind === 'assistant') {
                    return (
                      <p key={index} className="whitespace-pre-wrap text-sm text-fg">
                        {turn.text}
                      </p>
                    )
                  }
                  if (turn.kind === 'progress') {
                    return (
                      <p key={index} className="flex items-center gap-2 text-sm text-muted">
                        <span className="size-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
                        {turn.text}…
                      </p>
                    )
                  }
                  if (turn.kind === 'result') {
                    return (
                      <div key={index}>
                        <p className="text-sm text-fg">{turn.summary}</p>
                        <ResultCards data={turn.data} />
                      </div>
                    )
                  }
                  if (turn.kind === 'approval') {
                    return (
                      <ApprovalCard
                        key={index}
                        actionId={turn.actionId}
                        payloadHash={turn.payloadHash}
                        label={turn.label}
                        approvalsRequired={turn.approvalsRequired}
                        screen={screen}
                        onResolved={(summary) =>
                          setTurns((current) => [...current, { kind: 'assistant', text: summary }])
                        }
                      />
                    )
                  }
                  return (
                    <p key={index} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                      {turn.text}
                    </p>
                  )
                })}
                <div ref={endRef} />
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void send(input)
          }}
          className="flex items-end gap-2 border-t border-line p-3"
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send(input)
              }
            }}
            rows={2}
            placeholder="מה תרצו שאעשה?"
            aria-label="הודעה ל-XTRA AI"
            className="min-h-11 flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="min-h-11 rounded-lg border border-line px-3 text-sm text-muted"
            >
              עצור
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              שלח
            </button>
          )}
        </form>
      </aside>
    </div>
  )
}
