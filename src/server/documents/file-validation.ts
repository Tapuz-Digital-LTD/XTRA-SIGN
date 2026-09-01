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

/**
 * Version 1 accepts PDF and nothing else.
 *
 * DOC and DOCX used to be converted by LibreOffice in a container. That
 * container is gone with the move to Vercel, and the honest thing is to refuse
 * a Word file at the door with a message telling the user to save it as PDF —
 * rather than accept it and fail after they think it worked.
 */
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
  unsupported_type: 'ניתן להעלות קובץ PDF בלבד. אם המסמך ב-Word, שמרו אותו כ-PDF ונסו שוב.',
} as const

/** Present in every non-encrypted .docx, and in nothing else that is a ZIP. */
const DOCX_MARKER = Buffer.from('word/document.xml')

/**
 * OLE2 (`D0CF11E0`) is the container for .doc, .xls, .ppt and .msg alike — the
 * same trap as PK for ZIP. A Word binary document always holds a stream named
 * "WordDocument"; a spreadsheet does not.
 *
 * Stream names live in the OLE2 directory entries as UTF-16LE, so the marker is
 * matched in that encoding against the raw bytes. Nothing is parsed or opened
 * to perform the check.
 */
const DOC_MARKER = Buffer.from('WordDocument', 'utf16le')

export function validateUpload(buffer: Buffer): ValidationOk | ValidationError {
  if (buffer.length === 0) return { ok: false, code: 'empty', message: MESSAGES.empty }
  if (buffer.length > MAX_FILE_BYTES)
    return { ok: false, code: 'too_large', message: MESSAGES.too_large }

  const match = SIGNATURES.find((sig) => sig.bytes.every((byte, i) => buffer[i] === byte))
  if (!match) return { ok: false, code: 'unsupported_type', message: MESSAGES.unsupported_type }

  // PK\x03\x04 only says "a ZIP", not "a Word document". Every ODF file, every
  // JAR, and every zip bomb shares those four bytes. LibreOffice sniffs the
  // real format and will happily open whatever it finds, so without this an
  // arbitrary archive reaches the converter.
  //
  // ZIP stores entry names uncompressed in the local file headers, so the
  // marker is findable in the raw bytes without unpacking anything — which is
  // the point: nothing is decompressed before it has been accepted.
  if (match.kind === 'docx' && !buffer.includes(DOCX_MARKER)) {
    return { ok: false, code: 'unsupported_type', message: MESSAGES.unsupported_type }
  }

  // Same reasoning for the legacy binary format: OLE2 is shared by Word, Excel,
  // PowerPoint and Outlook, and LibreOffice will open any of them.
  if (match.kind === 'doc' && !buffer.includes(DOC_MARKER)) {
    return { ok: false, code: 'unsupported_type', message: MESSAGES.unsupported_type }
  }

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
