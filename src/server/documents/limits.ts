/**
 * Hard limits for document processing.
 *
 * Every number here exists because the alternative is an unbounded one. A
 * conversion is the one place in this system where untrusted bytes are handed
 * to a large third-party binary (LibreOffice), so the assumption is that any
 * given input may be hostile, malformed, or a decompression bomb — and that the
 * process must die on a schedule rather than be trusted to finish.
 *
 * These are enforced in two places on purpose: in the code, so a caller gets a
 * clear Hebrew error, and in the container (docker-compose `worker`), so a
 * process that ignores the code limit still cannot take the host down.
 */

export const LIMITS = {
  /** Also enforced at the route before the body is buffered. */
  MAX_UPLOAD_BYTES: 25 * 1024 * 1024,

  /**
   * A 400-page scan is a legitimate PDF and an illegitimate thing to render to
   * images on request. Refused with an explanation rather than attempted.
   */
  MAX_PAGES: 50,

  /** DOC/DOCX to PDF. Beyond this the input is pathological, not slow. */
  CONVERSION_TIMEOUT_MS: 60_000,

  /** Rasterising the PDF to page images. */
  RENDER_TIMEOUT_MS: 30_000,

  /** Guards against a small file that expands to gigabytes. */
  MAX_RENDERED_BYTES: 60 * 1024 * 1024,

  /** Per-page PNG. A page that renders larger than this is not a document page. */
  MAX_PAGE_IMAGE_BYTES: 4 * 1024 * 1024,

  /** Horizontal pixels per rendered page. Enough to read, bounded in memory. */
  RENDER_WIDTH_PX: 1240,

  /** Concurrent conversions per worker; the rest queue. */
  MAX_CONCURRENT_CONVERSIONS: 2,
} as const

export type ProcessingFailure =
  | 'timeout'
  | 'too_many_pages'
  | 'output_too_large'
  | 'conversion_failed'
  | 'unreadable'

/**
 * What the user sees. Every failure mode has its own sentence: "משהו השתבש"
 * tells someone holding a 300-page scan nothing about what to do next.
 *
 * No path, command output, or library error is ever surfaced — those leak
 * internals and are meaningless to an office worker.
 */
export const FAILURE_MESSAGES: Record<ProcessingFailure, string> = {
  timeout: 'עיבוד המסמך ארך זמן רב מדי. נסו שוב, או העלו קובץ קטן יותר.',
  too_many_pages: `המסמך ארוך מדי. ניתן להעלות עד ${LIMITS.MAX_PAGES} עמודים.`,
  output_too_large: 'המסמך כבד מדי לעיבוד. נסו לשמור אותו מחדש ולהעלות שוב.',
  conversion_failed: 'לא הצלחנו להכין את המסמך. נסו לשמור אותו כ-PDF ולהעלות שוב.',
  unreadable: 'לא הצלחנו לקרוא את המסמך. ייתכן שהקובץ פגום.',
}

export class ProcessingError extends Error {
  constructor(readonly failure: ProcessingFailure) {
    super(failure)
  }

  get userMessage(): string {
    return FAILURE_MESSAGES[this.failure]
  }
}
