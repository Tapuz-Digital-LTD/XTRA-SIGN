'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type PageGeometry, type PlacedField } from '@/lib/fields'
import { PdfPage } from '@/components/PdfPage'

/**
 * Guided signing.
 *
 * The signer is never asked to hunt. After verification the document opens, and
 * one big button walks them through every action in order — a required field,
 * then the next, then each signature, wherever it is in the document. Progress
 * is always visible ("2 מתוך 5"), a step back is always available, and a missed
 * field takes them straight to it rather than just complaining.
 */

type Step =
  | { kind: 'field'; field: PlacedField }
  | { kind: 'signature'; field: PlacedField }

export function SignerDocument({
  token,
  title,
  pages,
  fields,
  values,
  signatureCaptured,
  error,
  busy,
  onChange,
  onOpenSignature,
  onFinish,
}: {
  token: string
  title: string
  pages: PageGeometry[]
  fields: PlacedField[]
  values: Record<string, string>
  /** True once the signer has drawn their signature at least once. */
  signatureCaptured: boolean
  error: string | null
  busy: boolean
  onChange: (id: string, value: string) => void
  onOpenSignature: () => void
  onFinish: () => void
}) {
  const container = useRef<HTMLDivElement>(null)

  // The ordered list of actions: the signer's required fields and every
  // signature, top-to-bottom through the document.
  const steps = useMemo<Step[]>(() => {
    const mine = fields
      .filter((f) => f.ownedBy === 'signer')
      .filter((f) => f.type === 'signature' || f.required)
      .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    return mine.map((f) => (f.type === 'signature' ? { kind: 'signature', field: f } : { kind: 'field', field: f }))
  }, [fields])

  const isDone = useCallback(
    (step: Step) =>
      step.kind === 'signature' ? signatureCaptured : Boolean(values[step.field.id]?.trim()),
    [signatureCaptured, values],
  )

  const completedCount = steps.filter(isDone).length
  const allDone = completedCount === steps.length

  const [active, setActive] = useState(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const focusStep = useCallback((index: number) => {
    const step = steps[index]
    if (!step) return
    setActive(index)
    setHighlightId(step.field.id)
    const el = container.current?.querySelector<HTMLElement>(`[data-field="${step.field.id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (step.kind === 'field') {
      setTimeout(() => el?.querySelector<HTMLElement>('input, select')?.focus(), 450)
    }
  }, [steps])

  // Land on the first outstanding step once the document has painted. Deferred
  // to the next frame so it does not set state synchronously inside the effect.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const first = steps.findIndex((s) => !isDone(s))
      if (first >= 0) focusStep(first)
    })
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const firstOutstanding = () => steps.findIndex((s) => !isDone(s))

  const goNext = () => {
    const step = steps[active]
    if (step?.kind === 'signature' && !signatureCaptured) {
      onOpenSignature()
      return
    }
    // Move to the next step that still needs doing, else the next in order.
    const nextOutstanding = steps.findIndex((s, i) => i > active && !isDone(s))
    focusStep(nextOutstanding >= 0 ? nextOutstanding : Math.min(active + 1, steps.length - 1))
  }

  const goPrev = () => focusStep(Math.max(0, active - 1))

  const tryFinish = () => {
    const missing = firstOutstanding()
    if (missing >= 0) {
      focusStep(missing)
      return
    }
    onFinish()
  }

  const activeStep = steps[active]
  const nextLabel =
    activeStep?.kind === 'signature' && !signatureCaptured
      ? 'לחתימה'
      : steps[active + 1]?.kind === 'signature'
        ? 'לחתימה הבאה'
        : 'לשדה הבא'

  return (
    <div className="min-h-dvh bg-bg pb-32">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
      </header>

      <div ref={container} className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-4">
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-white"
            style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
          >
            <PdfPage
              url={`/api/sign/${token}/file`}
              pageNumber={page.pageNumber}
              widthPt={page.widthPt}
              heightPt={page.heightPt}
              className="absolute inset-0"
            />
            {fields
              .filter((f) => f.page === page.pageNumber)
              .map((field) => (
                <FieldOverlay
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? ''}
                  signed={field.type === 'signature' && signatureCaptured}
                  highlighted={field.id === highlightId}
                  onChange={(v) => onChange(field.id, v)}
                  onSignatureTap={onOpenSignature}
                />
              ))}
          </div>
        ))}
      </div>

      {/* The guide bar: progress, back, and the one next action. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {error ? (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          ) : null}

          {/* progress */}
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${steps.length ? (completedCount / steps.length) * 100 : 100}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium text-muted">
              {completedCount} מתוך {steps.length} הושלמו
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={active === 0}
              className="min-h-12 rounded-lg border border-line bg-white px-4 text-sm text-fg disabled:opacity-40"
            >
              הקודם
            </button>

            {allDone ? (
              <button
                type="button"
                onClick={tryFinish}
                disabled={busy}
                className="min-h-12 flex-1 rounded-lg bg-brand px-6 text-base font-semibold text-white disabled:opacity-60"
              >
                {busy ? 'שולח…' : 'סיום ושליחת המסמך'}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="min-h-12 flex-1 rounded-lg bg-brand px-6 text-base font-semibold text-white"
              >
                {nextLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FieldOverlay({
  field,
  value,
  signed,
  highlighted,
  onChange,
  onSignatureTap,
}: {
  field: PlacedField
  value: string
  signed: boolean
  highlighted: boolean
  onChange: (value: string) => void
  onSignatureTap: () => void
}) {
  const ours = field.ownedBy === 'sender'
  const style = {
    left: `${field.x * 100}%`,
    top: `${field.y * 100}%`,
    width: `${field.width * 100}%`,
    height: `${field.height * 100}%`,
  }
  const ring = highlighted ? 'ring-4 ring-[var(--color-accent)]/40 ring-offset-1' : ''

  // A field we already filled reads as document text, not as work.
  if (ours) {
    const text =
      field.type === 'checkbox'
        ? field.value === 'true'
          ? '☑'
          : '☐'
        : field.autoFill && field.type === 'date'
          ? 'תאריך החתימה'
          : field.value
    return (
      <div style={style} className="absolute flex items-center justify-end px-1 text-[max(9px,1.4cqw)] text-slate-800">
        <span className="truncate">{text}</span>
      </div>
    )
  }

  if (field.type === 'signature') {
    return (
      <button
        type="button"
        data-field={field.id}
        onClick={onSignatureTap}
        style={style}
        aria-label={`חתימה: ${field.label}`}
        className={`absolute flex items-center justify-center rounded border-2 text-[max(10px,1.3cqw)] font-medium transition-shadow ${ring} ${
          signed
            ? 'border-[var(--status-success)] bg-green-50 text-green-800'
            : 'border-dashed border-[var(--color-accent)] bg-blue-50/70 text-slate-800'
        }`}
      >
        {signed ? '✓ נחתם' : '✍ לחצו לחתימה'}
      </button>
    )
  }

  const common = `absolute rounded border-2 border-[var(--color-accent)] bg-blue-50/80 px-1 text-[max(11px,1.3cqw)] text-slate-900 outline-none focus:bg-white ${ring}`

  if (field.type === 'select') {
    return (
      <div data-field={field.id} style={style} className="absolute">
        <label className="sr-only" htmlFor={`f-${field.id}`}>
          {field.label}
        </label>
        <select
          id={`f-${field.id}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${common} inset-0 h-full w-full`}
        >
          <option value="">{field.placeholder || field.label}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <div data-field={field.id} style={style} className={`absolute flex items-center justify-center ${ring}`}>
        <label className="sr-only" htmlFor={`f-${field.id}`}>
          {field.label}
        </label>
        <input
          id={`f-${field.id}`}
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : '')}
          className="h-full max-h-6 w-full max-w-6"
        />
      </div>
    )
  }

  const inputType =
    field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'

  return (
    <div data-field={field.id} style={style} className="absolute">
      <label className="sr-only" htmlFor={`f-${field.id}`}>
        {field.label}
      </label>
      <input
        id={`f-${field.id}`}
        type={inputType}
        value={value}
        placeholder={field.placeholder || field.label}
        onChange={(e) => onChange(e.target.value)}
        className={`${common} inset-0 h-full w-full`}
      />
    </div>
  )
}
