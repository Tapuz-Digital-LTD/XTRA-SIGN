import { createHash, randomUUID } from 'node:crypto'

/**
 * Uploaded files are untrusted input.
 *
 * The extension and the browser-supplied Content-Type are both attacker
 * controlled — `contract.pdf` can be an HTML file that runs script the moment
 * something serves it inline. Only the leading bytes are checked.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024

export type AcceptedKind = 'pdf' | 'docx' | 'doc'

type Signature = { kind: AcceptedKind; bytes: number[]; mime: string; ext: string }

const SIGNATURES: Signature[] = [
  // %PDF-
  { kind: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], mime: 'application/pdf', ext: 'pdf' },
  // DOCX is a ZIP container: PK\x03\x04
  {
    kind: 'docx',
    bytes: [0x50, 0x4b, 0x03, 0x04],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
  },
  // Legacy .doc — OLE2 compound file
  {
    kind: 'doc',
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    mime: 'application/msword',
    ext: 'doc',
  },
]

export type ValidationOk = {
  ok: true
  kind: AcceptedKind
  mime: string
  ext: string
  sha256: string
  size: number
}

export type ValidationError = {
  ok: false
  code: 'empty' | 'too_large' | 'unsupported_type'
  message: string
}

/**
 * Hebrew messages, because these surface directly to the user. No file name or
 * byte content is echoed back — an error message is not a place to reflect
 * attacker-supplied strings.
 */
const MESSAGES = {
  empty: 'הקובץ ריק.',
  too_large: 'הקובץ גדול מדי. הגודל המרבי הוא 25MB.',
  unsupported_type: 'סוג הקובץ אינו נתמך. ניתן להעלות PDF, DOC או DOCX.',
} as const

export function validateUpload(buffer: Buffer): ValidationOk | ValidationError {
  if (buffer.length === 0) return { ok: false, code: 'empty', message: MESSAGES.empty }
  if (buffer.length > MAX_FILE_BYTES)
    return { ok: false, code: 'too_large', message: MESSAGES.too_large }

  const match = SIGNATURES.find((sig) => sig.bytes.every((byte, i) => buffer[i] === byte))
  if (!match) return { ok: false, code: 'unsupported_type', message: MESSAGES.unsupported_type }

  return {
    ok: true,
    kind: match.kind,
    mime: match.mime,
    ext: match.ext,
    sha256: sha256(buffer),
    size: buffer.length,
  }
}

/** SHA-256, lowercase hex. The integrity anchor for every stored version. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Storage keys are generated, never derived from the uploaded filename.
 *
 * A user-supplied name carries path traversal (`../../etc/passwd`), null bytes,
 * and unicode that renders as a different extension. None of that can reach the
 * object store if the name is never used to build a key.
 *
 * The organization id is the first segment, so a prefix listing can never span
 * tenants.
 */
export function buildStorageKey(input: {
  organizationId: string
  agreementId: string
  purpose: 'source' | 'rendered' | 'signed' | 'signature'
  ext: string
}): string {
  const safeExt = /^[a-z0-9]{1,5}$/.test(input.ext) ? input.ext : 'bin'
  return `org/${input.organizationId}/agreements/${input.agreementId}/${input.purpose}/${randomUUID()}.${safeExt}`
}

/**
 * A display name for the UI. The original is never trusted as a path, but the
 * user should still recognise their document, so it is sanitised and kept as
 * data in a column — never as part of a key.
 */
export function sanitizeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    // Strip C0/C1 control characters, including the null bytes and newlines
    // that let a name break out of a log line or a header.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Drop the extension: the title is a document name shown in a list, not a
  // filename. Keeping it produced "הסכם ספק.pdf.pdf" on download.
  const withoutExt = cleaned.replace(/\.(pdf|docx?)$/i, '')
  return withoutExt.slice(0, 200) || 'מסמך'
}
