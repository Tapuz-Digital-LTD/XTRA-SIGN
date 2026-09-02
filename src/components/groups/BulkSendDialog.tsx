'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { BulkPlan, BulkResult } from '@/server/groups/bulk-send'

type Step = 'template' | 'review' | 'sending' | 'done'

/**
 * Sending one template to a whole group.
 *
 * Three deliberate stops before anything is created: pick the template, look at
 * exactly who will and will not receive it and why, and confirm a number out
 * loud. Each company gets its own agreement — the review screen says so,
 * because "send to 76 companies" and "send one document to 76 people" are very
 * different things and only one of them is legally meaningful.
 */
export function BulkSendDialog({
  groupId,
  groupName,
  templates,
}: {
  groupId: string
  groupName: string
  templates: { id: string; name: string; signatureCount: number }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('template')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [plan, setPlan] = useState<BulkPlan | null>(null)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reset() {
    setStep('template')
    setTemplateId(null)
    setPlan(null)
    setResult(null)
    setError(null)
  }

  async function loadPlan(id: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/groups/${groupId}/send?template=${id}`)
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'לא הצלחנו להכין את הרשימה.')
        return
      }
      setPlan(data)
      setTemplateId(id)
      setStep('review')
    } finally {
      setBusy(false)
    }
  }

  async function send(retryBatch?: string) {
    if (!templateId || !plan) return
    setStep('sending')
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/groups/${groupId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          companyIds: plan.rows.filter((r) => r.ready).map((r) => r.companyId),
          ...(retryBatch ? { batchId: retryBatch } : {}),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error?.message ?? 'השליחה נכשלה.')
        setStep('review')
        return
      }
      setResult(data)
      setStep('done')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          reset()
          setOpen(true)
        }}
        className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand"
      >
        שליחת הסכם לחתימה
      </button>
    )
  }

  const ready = plan?.rows.filter((r) => r.ready) ?? []
  const blocked = plan?.rows.filter((r) => !r.ready) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-surface sm:rounded-2xl">
        <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-semibold text-fg">שליחת הסכם — {groupName}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="סגירה" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-bg">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

          {step === 'template' ? (
            templates.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">
                אין תבניות מוכנות לשימוש. שומרים מסמך כתבנית מעמוד המסמך, ומציבים עליה שדה חתימה.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted">בחרו את התבנית שתישלח לכל חברה בקבוצה.</p>
                <ul className="mt-3 divide-y divide-line">
                  {templates.map((template) => (
                    <li key={template.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void loadPlan(template.id)}
                        className="flex min-h-14 w-full items-center justify-between gap-3 px-1 text-start transition hover:bg-bg disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{template.name}</span>
                          <span className="block text-xs text-muted">
                            {template.signatureCount === 1 ? 'חתימה אחת' : `${template.signatureCount} חתימות`}
                          </span>
                        </span>
                        <span aria-hidden="true" className="text-muted">←</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}

          {step === 'review' && plan ? (
            <>
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-fg">
                ייווצרו וישלחו <strong>{ready.length} מסמכים נפרדים</strong> — אחד לכל חברה, כל אחד משויך אליה.
                {blocked.length > 0 ? <> {blocked.length} חברות לא יישלחו.</> : null}
              </div>

              <table className="mt-3 w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th className="py-2 text-start font-medium">חברה</th>
                    <th className="py-2 text-start font-medium">חותם</th>
                    <th className="py-2 text-start font-medium">יעד</th>
                    <th className="py-2 text-start font-medium">מצב</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.companyId} className="border-b border-line last:border-0">
                      <td className="max-w-[12rem] py-2"><span className="block truncate">{row.companyName}</span></td>
                      <td className="max-w-[8rem] py-2"><span className="block truncate text-muted">{row.contactName ?? '—'}</span></td>
                      <td className="max-w-[10rem] py-2" dir="ltr"><span className="block truncate text-muted">{row.contactPhone ?? row.contactEmail ?? '—'}</span></td>
                      <td className="py-2">
                        {row.ready ? (
                          <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">מוכנה</span>
                        ) : (
                          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{row.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          {step === 'sending' ? (
            <p role="status" className="py-12 text-center text-sm text-muted">
              שולח {ready.length} מסמכים… זה עשוי לקחת מספר שניות.
            </p>
          ) : null}

          {step === 'done' && result ? (
            <div className="py-4 text-center">
              <p className="text-2xl" aria-hidden="true">✓</p>
              <p className="mt-2 text-lg font-semibold text-fg">{result.sent} נשלחו</p>
              {result.skipped > 0 ? <p className="mt-1 text-sm text-muted">{result.skipped} כבר נשלחו קודם ולא נשלחו שוב.</p> : null}
              {result.failed.length > 0 ? (
                <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-start">
                  <p className="text-sm font-medium text-amber-900">{result.failed.length} נכשלו</p>
                  <ul className="mt-1 text-xs text-amber-900">
                    {result.failed.slice(0, 8).map((f, i) => (
                      <li key={i}>{f.companyName} — {f.reason}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(result.batchId)}
                    className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm text-fg disabled:opacity-50"
                  >
                    נסה שוב רק את שנכשלו
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-16 items-center justify-between gap-3 border-t border-line px-4">
          {step === 'review' ? (
            <>
              <button type="button" onClick={reset} className="text-sm text-muted hover:text-fg">חזרה</button>
              <button
                type="button"
                disabled={busy || ready.length === 0}
                onClick={() => void send()}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                שליחת {ready.length} הסכמים
              </button>
            </>
          ) : step === 'done' ? (
            <button type="button" onClick={() => setOpen(false)} className="ms-auto inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              סיום
            </button>
          ) : (
            <span className="text-xs text-muted">כל חברה מקבלת מסמך נפרד משלה.</span>
          )}
        </div>
      </div>
    </div>
  )
}
