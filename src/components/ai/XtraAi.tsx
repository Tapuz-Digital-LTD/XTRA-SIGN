'use client'

import {
  History,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApprovalCard } from './ApprovalCard'
import { ResultCards } from './ResultCards'

/**
 * XTRA AI — the assistant, available from every internal screen.
 *
 * It reads which screen you are on so that "send him the last agreement" has a
 * "him". That context is a hint sent with the question, never a permission: the
 * server re-checks access to every record it touches.
 *
 * The panel keeps running when it is closed. A question asked and then dismissed
 * still finishes, and the launcher reports that an answer is waiting — closing a
 * drawer is not the same as cancelling the work.
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
  'הראה לי את המסמכים האחרונים',
  'צור קבוצה חדשה',
]

/** The current screen, as the few ids a question might refer to. */
function useScreenContext(): Record<string, unknown> {
  const pathname = usePathname()
  const params = useSearchParams()

  const [section, id] = pathname.split('/').filter(Boolean)
  const context: Record<string, unknown> = { page: section ?? 'home' }

  if (section === 'companies' && id) context.companyId = id
  if (section === 'documents' && id && id !== 'new') context.documentId = id
  if (section === 'groups' && id) context.groupId = id
  if (section === 'suppliers' || section === 'customers') {
    const group = params.get('group')
    if (group) context.groupId = group
  }
  return context
}

/** The assistant's mark, used in the launcher, the header and beside each answer. */
function Mark({ size = 16 }: { size?: number }) {
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
      <Sparkles size={size} strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

export function XtraAi() {
  const screen = useScreenContext()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [history, setHistory] = useState<{ id: string; title: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const abort = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Read inside the stream loop, where a stale closure would otherwise decide
  // whether an arriving answer counts as unseen.
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, thinking])

  useEffect(() => {
    if (!open) return
    setUnseen(0)
    inputRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

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

  function startNew() {
    abort.current?.abort()
    setTurns([])
    setConversationId(null)
    setShowHistory(false)
    setThinking(false)
    inputRef.current?.focus()
  }

  async function send(text: string) {
    const question = text.trim()
    if (!question || thinking) return

    setInput('')
    setShowHistory(false)
    setTurns((current) => [...current, { kind: 'user', text: question }])
    setThinking(true)

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

        // Events arrive in whatever chunks the network gives; drain only whole ones.
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>

          if (event.type === 'conversation') {
            setConversationId(String(event.conversationId))
          } else if (event.type === 'text') {
            // The first words arriving are what end the "thinking" state.
            setThinking(false)
            setTurns((current) => [
              ...current.filter((turn) => turn.kind !== 'progress'),
              { kind: 'assistant', text: String(event.text) },
            ])
          } else if (event.type === 'tool_start') {
            setTurns((current) => [
              ...current.filter((turn) => turn.kind !== 'progress'),
              { kind: 'progress', text: String(event.label) },
            ])
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

      // Finished while the panel was shut: say so on the launcher rather than
      // letting the answer sit unseen.
      if (!openRef.current) setUnseen((count) => count + 1)
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        setTurns((current) => [...current, { kind: 'error', text: 'משהו השתבש. נסו שוב.' }])
      }
    } finally {
      setTurns((current) => current.filter((turn) => turn.kind !== 'progress'))
      setThinking(false)
      abort.current = null
      void loadHistory()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unseen ? `פתיחת XTRA AI — ${unseen} תשובות חדשות` : 'פתיחת XTRA AI'}
        className="fixed bottom-5 end-5 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand ps-4 pe-5 text-sm font-semibold text-white shadow-lg ring-1 ring-black/5 transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {thinking ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles size={16} aria-hidden="true" />
        )}
        XTRA AI
        {unseen > 0 ? (
          <span className="xtra-pop absolute -top-1 -end-1 inline-flex size-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white ring-2 ring-white">
            {unseen}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-start bg-black/25 backdrop-blur-[1px]"
      onClick={() => setOpen(false)}
    >
      <aside
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="XTRA AI"
        onClick={(event) => event.stopPropagation()}
        className="xtra-panel flex h-full w-full flex-col bg-surface shadow-2xl sm:w-[32rem]"
      >
        <header className="flex min-h-16 items-center gap-2.5 border-b border-line px-4">
          <Mark size={17} />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-fg">XTRA AI</h2>
            <p className="truncate text-xs text-muted">
              {thinking ? 'עובד על זה…' : 'עוזר חכם — התשובות נוצרות אוטומטית'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            aria-label="שיחות קודמות"
            aria-pressed={showHistory}
            className={`inline-flex size-10 items-center justify-center rounded-lg transition ${
              showHistory ? 'bg-bg text-fg' : 'text-muted hover:bg-bg hover:text-fg'
            }`}
          >
            <History size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={startNew}
            aria-label="שיחה חדשה"
            className="inline-flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-bg hover:text-fg"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="סגירה"
            className="inline-flex size-10 items-center justify-center rounded-lg text-muted transition hover:bg-bg hover:text-fg"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {showHistory ? (
          <div className="flex-1 overflow-y-auto p-3">
            {history.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">אין עדיין שיחות.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {history.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation.id)}
                      className={`w-full truncate rounded-lg px-3 py-3 text-start text-sm transition hover:bg-bg ${
                        conversation.id === conversationId ? 'bg-bg font-medium text-fg' : 'text-fg'
                      }`}
                    >
                      {conversation.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-5">
            {turns.length === 0 ? (
              <div className="pt-4">
                <Mark size={18} />
                <p className="mt-3 text-sm text-fg">
                  אפשר לבקש ממני לחפש, ליצור מסמכים, להכין שליחות ולעקוב — בעברית רגילה.
                </p>
                <p className="mt-1 text-xs text-muted">
                  פעולות שמשנות נתונים או שולחות מסמכים תמיד יוצגו לאישור לפני שאבצע אותן.
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => void send(action)}
                      className="min-h-11 rounded-xl border border-line bg-bg px-3.5 text-start text-sm text-fg transition hover:border-brand hover:bg-surface"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {turns.map((turn, index) => {
                  if (turn.kind === 'user') {
                    return (
                      <div key={index} className="flex justify-start">
                        <p className="max-w-[85%] rounded-2xl rounded-se-md bg-brand px-3.5 py-2 text-sm leading-relaxed text-white">
                          {turn.text}
                        </p>
                      </div>
                    )
                  }
                  if (turn.kind === 'assistant') {
                    return (
                      <div key={index} className="flex gap-2.5">
                        <Mark />
                        <p className="min-w-0 flex-1 whitespace-pre-wrap pt-1 text-sm leading-relaxed text-fg">
                          {turn.text}
                        </p>
                      </div>
                    )
                  }
                  if (turn.kind === 'progress') {
                    return (
                      <div key={index} className="flex items-center gap-2.5">
                        <Mark />
                        <span className="text-sm text-muted">{turn.text}…</span>
                      </div>
                    )
                  }
                  if (turn.kind === 'result') {
                    return (
                      <div key={index} className="flex gap-2.5">
                        <Mark />
                        <div className="min-w-0 flex-1 pt-1">
                          <p className="text-sm leading-relaxed text-fg">{turn.summary}</p>
                          <ResultCards data={turn.data} />
                        </div>
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
                    <p
                      key={index}
                      role="alert"
                      className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
                    >
                      {turn.text}
                    </p>
                  )
                })}

                {/* Never a frozen panel: while there is nothing else to show,
                    this says the assistant is working. */}
                {thinking ? (
                  <div className="flex items-center gap-2.5" aria-live="polite">
                    <Mark />
                    <span className="flex items-center gap-1" aria-label="חושב">
                      {[0, 1, 2].map((dot) => (
                        <span key={dot} className="xtra-dot size-1.5 rounded-full bg-muted" />
                      ))}
                    </span>
                  </div>
                ) : null}

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
          className="border-t border-line p-3"
        >
          <div className="flex items-end gap-2 rounded-xl border border-line bg-bg p-1.5 focus-within:border-brand">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              placeholder="מה תרצו שאעשה?"
              aria-label="הודעה ל-XTRA AI"
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-fg outline-none"
            />
            {thinking ? (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                aria-label="עצירת התשובה"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-bg text-muted ring-1 ring-line transition hover:text-fg"
              >
                <Square size={14} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="שליחה"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:opacity-90 disabled:opacity-30"
              >
                <Send size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </form>
      </aside>
    </div>
  )
}
