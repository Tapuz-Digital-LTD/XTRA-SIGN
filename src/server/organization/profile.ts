import { eq } from 'drizzle-orm'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'

/**
 * "Our" side of every agreement.
 *
 * Read by templates and by the assistant so the company's own details are never
 * typed into a prompt or frozen into code: correcting the registration number
 * here corrects every document produced afterwards.
 */

export type OrganizationProfile = {
  name: string
  legalName: string | null
  taxId: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  logoUrl: string | null
  brandPrimary: string | null
  brandAccent: string | null
  brandFont: string | null
  footerText: string | null
}

export async function getOrganizationProfile(session: StaffSession): Promise<OrganizationProfile> {
  const [row] = await getDb()
    .select({
      name: schema.organizations.name,
      legalName: schema.organizations.legalName,
      taxId: schema.organizations.taxId,
      address: schema.organizations.address,
      phone: schema.organizations.phone,
      email: schema.organizations.email,
      website: schema.organizations.website,
      logoUrl: schema.organizations.logoUrl,
      brandPrimary: schema.organizations.brandPrimary,
      brandAccent: schema.organizations.brandAccent,
      brandFont: schema.organizations.brandFont,
      footerText: schema.organizations.footerText,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, session.organizationId))
    .limit(1)

  if (!row) throw new ForbiddenError()
  return row
}

const clean = (value: string | null | undefined, max = 300): string | null =>
  value?.trim().slice(0, max) || null

/** Only a plain hex colour; anything else would end up inside a style attribute. */
const hexOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : null
}

export async function updateOrganizationProfile(
  session: StaffSession,
  input: Partial<OrganizationProfile>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Company details are what a counterparty relies on; changing them is an
  // administrator's job, not everyone's.
  if (!session.isAdmin) throw new ForbiddenError()

  const name = clean(input.name, 200)
  if (input.name !== undefined && !name) return { ok: false, message: 'יש להזין שם ארגון.' }

  await getDb()
    .update(schema.organizations)
    .set({
      ...(name ? { name } : {}),
      legalName: clean(input.legalName, 200),
      taxId: clean(input.taxId, 40),
      address: clean(input.address),
      phone: clean(input.phone, 40),
      email: clean(input.email, 200),
      website: clean(input.website, 200),
      logoUrl: clean(input.logoUrl, 1000),
      // Colours are validated so a stray value cannot become raw CSS in a
      // rendered document.
      brandPrimary: hexOrNull(input.brandPrimary),
      brandAccent: hexOrNull(input.brandAccent),
      brandFont: clean(input.brandFont, 80),
      footerText: clean(input.footerText, 500),
    })
    .where(eq(schema.organizations.id, session.organizationId))

  return { ok: true }
}

/** The profile as the lines that go at the top of a document. */
export function letterhead(profile: OrganizationProfile): string[] {
  return [
    profile.legalName ?? profile.name,
    profile.taxId ? `ח.פ ${profile.taxId}` : null,
    profile.address,
    [profile.phone, profile.email].filter(Boolean).join(' · ') || null,
  ].filter((line): line is string => Boolean(line))
}
