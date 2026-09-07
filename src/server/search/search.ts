import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'

/**
 * One box in the header: a supplier, a customer, a campaign, a document or
 * a template, by name, number, phone or email. Every result respects the
 * same visibility as the screen it opens: a document only for whoever may
 * open it, everything scoped to the organization, nothing deleted.
 */

export type SearchHit = {
  kind: 'supplier' | 'customer' | 'campaign' | 'agreement' | 'template'
  id: string
  title: string
  subtitle: string | null
  /** Where the data lives, when it matters: the CRM mirror or XTRA Sign. */
  source?: 'crm' | 'xtra'
  href: string
}

const LIMIT_PER_KIND = 5

export async function globalSearch(session: StaffSession, rawQuery: string): Promise<SearchHit[]> {
  const q = rawQuery.trim()
  if (q.length < 2) return []
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const db = getDb()

  const [companies, groups, agreements, templates] = await Promise.all([
    db
      .select({ id: schema.companies.id, name: schema.companies.name, kind: schema.companies.kind, taxId: schema.companies.taxId, phone: schema.companies.contactPhone, email: schema.companies.contactEmail, crm: schema.companies.crmRecordId })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, session.organizationId),
          isNull(schema.companies.deletedAt),
          or(ilike(schema.companies.name, like), ilike(schema.companies.taxId, like), ilike(schema.companies.contactName, like), ilike(schema.companies.contactPhone, like), ilike(schema.companies.contactEmail, like)),
        ),
      )
      .orderBy(schema.companies.name)
      .limit(LIMIT_PER_KIND * 2),
    db
      .select({ id: schema.groups.id, name: schema.groups.name, campaignKind: schema.groups.campaignKind })
      .from(schema.groups)
      .where(and(eq(schema.groups.organizationId, session.organizationId), isNull(schema.groups.deletedAt), isNull(schema.groups.systemKey), ilike(schema.groups.name, like)))
      .orderBy(desc(schema.groups.createdAt))
      .limit(LIMIT_PER_KIND),
    db
      .select({ id: schema.agreements.id, title: schema.agreements.title, status: schema.agreements.status, companyName: schema.companies.name })
      .from(schema.agreements)
      .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
      .where(
        and(
          eq(schema.agreements.organizationId, session.organizationId),
          isNull(schema.agreements.deletedAt),
          session.isAdmin ? undefined : eq(schema.agreements.ownerId, session.userId),
          or(ilike(schema.agreements.title, like), ilike(schema.companies.name, like)),
        ),
      )
      .orderBy(desc(schema.agreements.createdAt))
      .limit(LIMIT_PER_KIND),
    db
      .select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(and(eq(schema.templates.organizationId, session.organizationId), isNull(schema.templates.deletedAt), ilike(schema.templates.name, like)))
      .orderBy(schema.templates.name)
      .limit(LIMIT_PER_KIND),
  ])

  const hits: SearchHit[] = []
  for (const c of companies) {
    hits.push({
      kind: c.kind === 'customer' ? 'customer' : 'supplier',
      id: c.id,
      title: c.name,
      subtitle: [c.taxId, c.phone, c.email].filter(Boolean).join(' · ') || null,
      source: c.crm ? 'crm' : 'xtra',
      href: `/companies/${c.id}`,
    })
  }
  for (const g of groups) hits.push({ kind: 'campaign', id: g.id, title: g.name, subtitle: g.campaignKind === 'public' ? 'קמפיין ציבורי' : 'קמפיין חתימות', href: `/projects/${g.id}` })
  for (const a of agreements) hits.push({ kind: 'agreement', id: a.id, title: a.title, subtitle: a.companyName ?? null, href: `/documents/${a.id}` })
  for (const t of templates) hits.push({ kind: 'template', id: t.id, title: t.name, subtitle: null, href: `/templates/${t.id}` })
  return hits
}
