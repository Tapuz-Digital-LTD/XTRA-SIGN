import { and, eq, isNull } from 'drizzle-orm'
import { normalizeIsraeliPhone } from '@/lib/phone'
import type { StaffSession } from '@/server/auth/session'
import type { CompanyKind } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { FireberryProvider } from './fireberry'

/**
 * One-way read sync from Fireberry into XTRA Sign.
 *
 * Never writes to Fireberry. For each supplier/customer it upserts by the
 * Fireberry record id, so running it twice never duplicates a company: an
 * existing one is updated in place, a new one is created. Only the
 * customer/supplier details we mapped are imported — no documents, notes or
 * activities.
 */

export type SyncCounts = { added: number; updated: number; unchanged: number; failed: number }
export type SyncResult =
  | { ok: true; counts: SyncCounts; errors: string[] }
  | { ok: false; message: string }

/** The Fireberry object number and field mapping for each kind. */
const MAPPING = {
  customer: {
    objectType: 1,
    idField: 'accountid',
    fields: ['accountid', 'accountname', 'idnumber', 'telephone1', 'emailaddress1', 'billingstreet', 'billingcity', 'billingcountry', 'modifiedon'],
    map: (r: Record<string, unknown>) => ({
      name: str(r.accountname),
      taxId: str(r.idnumber),
      contactName: null as string | null,
      contactPhone: str(r.telephone1),
      contactEmail: str(r.emailaddress1),
      address: joinAddress([str(r.billingstreet), str(r.billingcity), str(r.billingcountry)]),
    }),
  },
  supplier: {
    objectType: 1000,
    idField: 'customobject1000id',
    fields: ['customobject1000id', 'name', 'pcfvatid', 'pcfsystemfield129', 'pcfsystemfield130', 'pcfsystemfield127', 'pcfsystemfield103', 'pcfstreet', 'pcfcity', 'modifiedon'],
    map: (r: Record<string, unknown>) => ({
      name: str(r.name),
      taxId: str(r.pcfvatid),
      contactName: str(r.pcfsystemfield129),
      contactPhone: str(r.pcfsystemfield130) ?? str(r.pcfsystemfield127),
      contactEmail: str(r.pcfsystemfield103),
      address: joinAddress([str(r.pcfstreet), str(r.pcfcity)]),
    }),
  },
} as const

function str(v: unknown): string | null {
  if (typeof v !== 'string') return v == null ? null : String(v)
  const t = v.trim()
  return t === '' ? null : t
}

function joinAddress(parts: (string | null)[]): string | null {
  const joined = parts.filter(Boolean).join(', ')
  return joined === '' ? null : joined
}

/** A phone stored as given unless it is a clean Israeli mobile; contact detail, not a login. */
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
    const cfg = MAPPING[kind]
    const label = kind === 'customer' ? 'לקוחות' : 'ספקים'

    // The high-water mark: only records changed since it are fetched. Its
    // absence (first sync) means a full import.
    const [state] = await db
      .select()
      .from(schema.crmSyncState)
      .where(
        and(
          eq(schema.crmSyncState.organizationId, session.organizationId),
          eq(schema.crmSyncState.objectType, cfg.objectType),
        ),
      )
      .limit(1)
    const watermark = state?.watermark ?? null

    // Existing CRM-linked companies of this kind, by their Fireberry id.
    const existing = await db
      .select()
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, session.organizationId),
          eq(schema.companies.crmObjectType, cfg.objectType),
          isNull(schema.companies.deletedAt),
        ),
      )
    const byCrmId = new Map(existing.filter((c) => c.crmRecordId).map((c) => [c.crmRecordId!, c]))

    let maxModified = watermark
    let kindFailed = false
    let page = 1
    // A hard page cap so a runaway never loops forever.
    for (let guard = 0; guard < 200; guard++) {
      let batch
      try {
        batch = await provider.queryRecords({
          objectType: cfg.objectType,
          fields: [...cfg.fields],
          pageNumber: page,
          // Fireberry compares the raw modifiedon string; ISO order is chronological.
          query: watermark ? `(modifiedon > ${watermark})` : undefined,
          sortBy: 'modifiedon',
        })
      } catch (error) {
        errors.push(`${label}: קריאה מ-CRM נכשלה (עמוד ${page}).`)
        kindFailed = true
        void error
        break
      }

      for (const row of batch.rows) {
        const modified = str(row.modifiedon)
        if (modified && (!maxModified || modified > maxModified)) maxModified = modified
        const crmId = str(row[cfg.idField])
        const mapped = cfg.map(row)
        if (!crmId || !mapped.name) {
          counts.failed += 1
          continue
        }
        const values = {
          name: mapped.name,
          taxId: mapped.taxId,
          contactName: mapped.contactName,
          contactPhone: contactPhone(mapped.contactPhone),
          contactEmail: mapped.contactEmail,
          address: mapped.address,
        }

        try {
          const current = byCrmId.get(crmId)
          if (!current) {
            await db.insert(schema.companies).values({
              organizationId: session.organizationId,
              kind,
              crmRecordId: crmId,
              crmObjectType: cfg.objectType,
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
            await db
              .update(schema.companies)
              .set({ ...values, crmSyncedAt: new Date() })
              .where(eq(schema.companies.id, current.id))
            if (changed) counts.updated += 1
            else counts.unchanged += 1
          }
        } catch (error) {
          counts.failed += 1
          void error
        }
      }

      if (batch.isLastPage) break
      page += 1
    }

    // Advance the watermark so the next run is incremental. Skipped if the read
    // failed partway, so nothing changed is missed on the retry.
    if (!kindFailed) {
      const now = new Date()
      if (state) {
        await db
          .update(schema.crmSyncState)
          .set({ watermark: maxModified, lastSyncedAt: now })
          .where(eq(schema.crmSyncState.id, state.id))
      } else {
        await db.insert(schema.crmSyncState).values({
          organizationId: session.organizationId,
          objectType: cfg.objectType,
          watermark: maxModified,
          lastSyncedAt: now,
        })
      }
    }
  }

  return { ok: true, counts, errors }
}
