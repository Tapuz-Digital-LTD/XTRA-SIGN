import { and, eq, isNull } from 'drizzle-orm'
import { normalizeIsraeliPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import type { CompanyKind } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { FireberryProvider } from './fireberry'

/**
 * One-way read sync from Fireberry into XTRA Sign.
 *
 * Never writes to Fireberry. Upserts each supplier/customer by its Fireberry
 * record id, so a second run never duplicates. Incremental: a per-object
 * high-water mark of the newest `modifiedon` seen means later runs fetch only
 * what changed. Only the customer/supplier details mapped below are imported —
 * no documents, notes or activities.
 */

export type SyncCounts = { added: number; updated: number; unchanged: number; failed: number }
export type SyncResult =
  | { ok: true; counts: SyncCounts; errors: string[] }
  | { ok: false; message: string }

const CUSTOMER_OBJECT = 1
const SUPPLIER_OBJECT = 1000
const CONTACT_OBJECT = 2

type Mapped = {
  name: string | null
  taxId: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
}

function str(v: unknown): string | null {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

function joinAddress(parts: (string | null)[]): string | null {
  const joined = parts.filter(Boolean).join(', ')
  return joined === '' ? null : joined
}

function contactPhone(v: string | null): string | null {
  if (!v) return null
  return normalizeIsraeliPhone(v) ?? v
}

export async function syncFromFireberry(session: StaffSession): Promise<SyncResult> {
  const provider = new FireberryProvider()
  if (!provider.isConfigured()) return { ok: false, message: 'החיבור ל-CRM אינו מוגדר.' }

  const db = getDb()
  const counts: SyncCounts = { added: 0, updated: 0, unchanged: 0, failed: 0 }
  const errors: string[] = []

  for (const kind of ['customer', 'supplier'] as CompanyKind[]) {
    const objectType = kind === 'customer' ? CUSTOMER_OBJECT : SUPPLIER_OBJECT
    const label = kind === 'customer' ? 'לקוחות' : 'ספקים'

    const [state] = await db
      .select()
      .from(schema.crmSyncState)
      .where(
        and(
          eq(schema.crmSyncState.organizationId, session.organizationId),
          eq(schema.crmSyncState.objectType, objectType),
        ),
      )
      .limit(1)
    const watermark = state?.watermark ?? null

    const fields =
      kind === 'customer'
        ? ['accountid', 'accountname', 'idnumber', 'telephone1', 'emailaddress1', 'billingstreet', 'billingcity', 'billingcountry', 'primarycontactid', 'modifiedon']
        : ['customobject1000id', 'name', 'pcfvatid', 'pcfsystemfield100', 'pcfsystemfield104', 'pcfsystemfield125', 'pcfsystemfield130', 'pcfsystemfield127', 'pcfsystemfield103', 'pcfstreet', 'pcfcity', 'modifiedon']

    // Phase 1: read every changed record.
    let rows: Record<string, unknown>[]
    let maxModified = watermark
    try {
      const collected: Record<string, unknown>[] = []
      let page = 1
      for (let guard = 0; guard < 300; guard++) {
        const batch = await provider.queryRecords({
          objectType,
          fields,
          pageNumber: page,
          query: watermark ? `(modifiedon > ${watermark})` : undefined,
          sortBy: 'modifiedon',
        })
        for (const r of batch.rows) {
          const m = str(r.modifiedon)
          if (m && (!maxModified || m > maxModified)) maxModified = m
        }
        collected.push(...batch.rows)
        if (batch.isLastPage) break
        page += 1
      }
      rows = collected
    } catch (error) {
      errors.push(`${label}: קריאה מ-CRM נכשלה.`)
      void error
      continue // Leave the watermark untouched so nothing is skipped next time.
    }

    // Phase 2 (customers only): resolve the primary contact from the linked
    // Contact object, so the contact name/phone/email come from the real person.
    const contactById = new Map<string, { firstname: string | null; emailaddress1: string | null; telephone1: string | null }>()
    if (kind === 'customer') {
      const ids = [...new Set(rows.map((r) => str(r.primarycontactid)).filter(Boolean) as string[])]
      try {
        for (let i = 0; i < ids.length; i += 25) {
          const chunk = ids.slice(i, i + 25)
          const filter = chunk.map((id) => `(contactid = ${id})`).join(' OR ')
          const batch = await provider.queryRecords({
            objectType: CONTACT_OBJECT,
            fields: ['contactid', 'firstname', 'emailaddress1', 'telephone1'],
            pageNumber: 1,
            pageSize: 50,
            query: filter,
          })
          for (const c of batch.rows) {
            const cid = str(c.contactid)
            if (cid) contactById.set(cid, { firstname: str(c.firstname), emailaddress1: str(c.emailaddress1), telephone1: str(c.telephone1) })
          }
        }
      } catch (error) {
        errors.push(`${label}: חלק מפרטי אנשי הקשר לא נטענו.`)
        void error
      }
    }

    const mapRow = (r: Record<string, unknown>): { crmId: string | null; values: Mapped } => {
      if (kind === 'customer') {
        const contact = contactById.get(str(r.primarycontactid) ?? '')
        return {
          crmId: str(r.accountid),
          values: {
            name: str(r.accountname),
            taxId: str(r.idnumber),
            contactName: contact?.firstname ?? null,
            contactPhone: contact?.telephone1 ?? str(r.telephone1),
            contactEmail: contact?.emailaddress1 ?? str(r.emailaddress1),
            address: joinAddress([str(r.billingstreet), str(r.billingcity), str(r.billingcountry)]),
          },
        }
      }
      return {
        crmId: str(r.customobject1000id),
        values: {
          name: str(r.name),
          taxId: str(r.pcfvatid),
          contactName: str(r.pcfsystemfield100),
          contactPhone: str(r.pcfsystemfield104) ?? str(r.pcfsystemfield130) ?? str(r.pcfsystemfield127),
          contactEmail: str(r.pcfsystemfield125) ?? str(r.pcfsystemfield103),
          address: joinAddress([str(r.pcfstreet), str(r.pcfcity)]),
        },
      }
    }

    const existing = await db
      .select()
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, session.organizationId),
          eq(schema.companies.crmObjectType, objectType),
          isNull(schema.companies.deletedAt),
        ),
      )
    const byCrmId = new Map(existing.filter((c) => c.crmRecordId).map((c) => [c.crmRecordId!, c]))

    // Phase 3: upsert.
    for (const r of rows) {
      const { crmId, values: raw } = mapRow(r)
      const name = raw.name
      if (!crmId || !name) {
        counts.failed += 1
        continue
      }
      const values = { ...raw, name, contactPhone: contactPhone(raw.contactPhone) }
      try {
        const current = byCrmId.get(crmId)
        if (!current) {
          await db.insert(schema.companies).values({
            organizationId: session.organizationId,
            kind,
            crmRecordId: crmId,
            crmObjectType: objectType,
            source: 'crm',
            crmSyncedAt: new Date(),
            ...values,
          })
          counts.added += 1
        } else {
          const changed =
            current.name !== values.name ||
            current.taxId !== values.taxId ||
            current.contactName !== values.contactName ||
            current.contactPhone !== values.contactPhone ||
            current.contactEmail !== values.contactEmail ||
            current.address !== values.address
          await db.update(schema.companies).set({ ...values, crmSyncedAt: new Date() }).where(eq(schema.companies.id, current.id))
          if (changed) counts.updated += 1
          else counts.unchanged += 1
        }
      } catch (error) {
        counts.failed += 1
        void error
      }
    }

    // Advance the watermark as an upsert — no read-then-insert race.
    await db
      .insert(schema.crmSyncState)
      .values({ organizationId: session.organizationId, objectType, watermark: maxModified, lastSyncedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.crmSyncState.organizationId, schema.crmSyncState.objectType],
        set: { watermark: maxModified, lastSyncedAt: new Date() },
      })
  }

  return { ok: true, counts, errors }
}
