import type { JoiningProgress } from '@/lib/joining-progress'

/**
 * Where a supplier really got to, in one block a person can read without
 * knowing a single system word: the business state, one sentence explaining
 * it, what to do next, and the steps that actually have a record. A step with
 * no record is shown as not-yet, never as done — and a sent message is never
 * called delivered.
 */
const time = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const TONE: Record<JoiningProgress['tone'], string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-green-200 bg-green-50 text-green-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  neutral: 'border-line bg-bg text-fg',
}

/** The one short line under a status chip in a table or a card. */
export function ProgressLine({ progress, className = '' }: { progress: JoiningProgress; className?: string }) {
  if (!progress.secondary) return null
  return <span className={`block text-xs text-muted ${className}`}>{progress.secondary}</span>
}

export function JoiningProgressPanel({ progress }: { progress: JoiningProgress }) {
  return (
    <section aria-label="מצב ההצטרפות">
      <div className={`rounded-xl border px-4 py-3 ${TONE[progress.tone]}`}>
        <p className="text-base font-semibold">{progress.headline}</p>
        <p className="mt-1 text-sm">{progress.explain}</p>
        {progress.next ? <p className="mt-2 text-sm font-medium">מה עושים עכשיו: {progress.next}</p> : null}
      </div>
      {progress.steps.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1.5">
          {progress.steps.map((step) => (
            <li key={step.key} className="flex items-start gap-2 text-sm">
              <span aria-hidden="true" className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? 'bg-green-100 text-green-800' : 'border border-dashed border-line text-muted'}`}>
                {step.done ? '✓' : ''}
              </span>
              <span className="min-w-0">
                <span className={step.done ? 'text-fg' : 'text-muted'}>
                  {step.label}
                  {step.done ? '' : ' — טרם'}
                </span>
                {step.at ? <span className="text-muted"> · {time.format(new Date(step.at))}</span> : null}
                {step.note ? <span className="block text-xs text-muted">{step.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
