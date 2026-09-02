import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { notify } from '@/server/notifications/notifications'
import { FireberryProvider } from './fireberry'

const ORDER_OBJECT = 13

/**
 * Fireberry's own value for a quote that has been agreed.
 *
 * The picklist on object 13 offers נשלחה/נכשל/טרם נשלחה/אושרה — there is no
 * literal "נחתם", so the nearest true statement is used rather than a new
 * option invented in someone else's CRM.
 */
const STATUS_APPROVED = 4
/** "תאריך חתימה על ההסכם" on the quote. */
const SIGNED_DATE_FIELD = 'pcfsystemfield115'

/**
 * Reflects the signature on the source record.
 *
 * Best-effort and separate from the upload: the PDF landing is the part that
 * matters, and a picklist that has been reconfigured in the CRM must not turn
 * a successful write-back into a failure.
 */
async function markRecordSigned(
  provider: FireberryProvider,
  objectType: number,
  recordId: string,
): Promise<void> {
  if (objectType !== ORDER_OBJECT) return
  try {
    await provider.updateRecord(objectType, recordId, {
      statuscode: STATUS_APPROVED,
      [SIGNED_DATE_FIELD]: new Date().toISOString(),
    })
  } catch (error) {
    log.error('crm status update failed', { recordId, error: String(error) })
  }
}

/**
 * Pushing a signed PDF back to the CRM record it came from.
 *
 * XTRA Sign is the source of truth for the signature. A failure here is
 * recorded and surfaced, never allowed to un-sign anything or to block the
 * signing flow — the document is signed whether or not Fireberry accepted a
 * copy of it.
 *
 * Idempotent through `crm_writeback_state`: once 'done', a retry is a no-op,
 * so a re-run cannot attach the same PDF twice.
 */
export async function writeBackSignedDocument(agreementId: string): Promise<{ ok: boolean; message?: string }> {
  const db = getDb()

  const [row] = await db
    .select({
      id: schema.agreements.id,
      organizationId: schema.agreements.organizationId,
      title: schema.agreements.title,
      status: schema.agreements.status,
      crmObjectType: schema.agreements.crmObjectType,
      crmRecordId: schema.agreements.crmRecordId,
      state: schema.agreements.crmWritebackState,
      signedFileKey: schema.agreementVersions.signedFileKey,
    })
    .from(schema.agreements)
    .leftJoin(schema.agreementVersions, eq(schema.agreementVersions.id, schema.agreements.currentVersionId))
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)

  if (!row) return { ok: false, message: 'המסמך לא נמצא.' }
  if (row.state === 'done') return { ok: true } // already there
  if (row.status !== 'signed') return { ok: false, message: 'המסמך טרם נחתם.' }
  if (!row.crmObjectType || !row.crmRecordId) return { ok: false, message: 'למסמך אין רשומת מקור ב-CRM.' }
  if (!row.signedFileKey) return { ok: false, message: 'אין קובץ חתום.' }

  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }

  try {
    const { getStorage } = await import('@/server/storage/blob')
    const bytes = await getStorage().get(row.signedFileKey)

    const result = await provider.uploadFile({
      target: { objectType: row.crmObjectType, recordId: row.crmRecordId },
      filename: `${row.title} — חתום.pdf`,
      contentType: 'application/pdf',
      bytes,
    })
    if (!result.ok) throw new Error(result.message)

    // And mark the record itself. The signed PDF sitting on a quote still
    // marked "waiting" is how a CRM stops being believed.
    await markRecordSigned(provider, row.crmObjectType, row.crmRecordId)

    await db
      .update(schema.agreements)
      .set({ crmWritebackState: 'done', crmWritebackAt: new Date(), crmWritebackError: null })
      .where(eq(schema.agreements.id, row.id))

    await db.insert(schema.auditEvents).values({
      agreementId: row.id,
      type: 'crm_uploaded',
      actor: 'system',
      metadata: { objectType: row.crmObjectType, recordId: row.crmRecordId },
    })

    return { ok: true }
  } catch (error) {
    const message = String(error)
    log.error('crm write-back failed', { agreementId, error: message })

    await db
      .update(schema.agreements)
      .set({ crmWritebackState: 'failed', crmWritebackAt: new Date(), crmWritebackError: message.slice(0, 500) })
      .where(and(eq(schema.agreements.id, row.id)))

    await notify({
      organizationId: row.organizationId,
      type: 'crm_failed',
      agreementId: row.id,
      title: `ההעלאה של "${row.title}" ל-Fireberry נכשלה`,
      body: 'ניתן לנסות שוב מעמוד המסמך.',
    })

    return { ok: false, message: 'ההעלאה ל-Fireberry נכשלה.' }
  }
}
