import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'

/**
 * Finds a company we already hold that is plainly the same business.
 *
 * The same order of confidence the CRM check uses: a tax id is an identity, an
 * email or phone is strong, and an exact name is the weakest thing worth
 * acting on. Anything less certain than these is left for a person to judge.
 */
export async function findLocalDuplicate(
  session: StaffSession,
  details: { name: string; taxId?: string | null; contactPhone?: string | null; contactEmail?: string | null },
): Promise<{ id: string; name: string } | null> {
  const db = getDb()
  const attempts = [
    details.taxId?.trim() ? eq(schema.companies.taxId, details.taxId.trim()) : null,
    details.contactEmail?.trim() ? sql`lower(${schema.companies.contactEmail}) = lower(${details.contactEmail.trim()})` : null,
    details.contactPhone?.trim() ? eq(schema.companies.contactPhone, details.contactPhone.trim()) : null,
    details.name.trim() ? sql`lower(${schema.companies.name}) = lower(${details.name.trim()})` : null,
  ].filter(Boolean)

  for (const attempt of attempts) {
    const [row] = await db
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, session.organizationId),
          isNull(schema.companies.deletedAt),
          attempt!,
        ),
      )
      .limit(1)
    if (row) return row
  }
  return null
}
