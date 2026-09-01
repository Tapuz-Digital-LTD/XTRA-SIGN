import { STATUS_LABELS, STATUS_TONE, type AgreementStatus } from '@/lib/status'

/**
 * Status is carried by an icon shape AND a word, not by colour. Colour alone
 * fails colour-blind users and disappears entirely in print.
 */
const TONE_CLASS = {
  neutral: 'text-slate-600 bg-slate-100',
  pending: 'text-amber-800 bg-amber-100',
  success: 'text-green-800 bg-green-100',
  danger: 'text-red-800 bg-red-100',
} as const

const TONE_ICON = {
  neutral: '○',
  pending: '◐',
  success: '✓',
  danger: '✕',
} as const

export function StatusBadge({ status }: { status: AgreementStatus }) {
  const tone = STATUS_TONE[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden="true">{TONE_ICON[tone]}</span>
      {STATUS_LABELS[status]}
    </span>
  )
}
