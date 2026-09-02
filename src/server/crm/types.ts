/**
 * The CRM boundary.
 *
 * One narrow interface so the rest of the app pushes a signed document to "the
 * CRM" without knowing which one. Today that is Fireberry; a future provider is
 * a second implementation of this and nothing above it changes.
 */

export type CrmUploadTarget = {
  /** The CRM's object number for the record (e.g. Fireberry account=1). */
  objectType: number
  /** The record's id/GUID in the CRM. */
  recordId: string
}

export type CrmUploadResult =
  | { ok: true }
  | { ok: false; message: string }

export interface CrmProvider {
  /** Human name, for messages and audit. */
  readonly name: string
  /** Whether a token/credential is configured. A false here hides the button. */
  isConfigured(): boolean
  /**
   * The CRM object number for one of our company kinds, so a caller can derive
   * a target from `kind` alone when the company has no explicit override.
   */
  objectTypeForKind(kind: 'supplier' | 'customer'): number
  /** Pushes a file onto a record. Never throws for an expected API failure. */
  uploadFile(input: {
    target: CrmUploadTarget
    filename: string
    contentType: string
    bytes: Buffer
  }): Promise<CrmUploadResult>
}
