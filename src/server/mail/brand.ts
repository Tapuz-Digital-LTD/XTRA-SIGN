import { eq } from 'drizzle-orm'
import { skinByKey } from '@/lib/self-service-skins'
import { getDb, schema } from '@/server/db'
import { publicBaseUrl } from '@/server/http/public-url'

/**
 * What dresses an email: a name, an optional logo, one colour, and where
 * to write with questions. A campaign with a page of its own brings its
 * colours; otherwise the organization's; otherwise XTRA Sign's.
 */
export type EmailBrand = {
  name: string
  logoUrl?: string | null
  /** The accent: buttons, links. */
  color?: string | null
  /** The header's own background when the logo needs a plain one (a red logo on white). */
  headerBackground?: string | null
  supportEmail?: string | null
}

/** XTRA's red wordmark on a white header; red for the buttons. */
export const DEFAULT_BRAND: EmailBrand = { name: 'XTRA Sign', logoUrl: null, color: '#cb3e45', headerBackground: '#ffffff', supportEmail: null }

function defaultBrand(name?: string | null, supportEmail?: string | null): EmailBrand {
  return { ...DEFAULT_BRAND, name: name ?? DEFAULT_BRAND.name, logoUrl: `${publicBaseUrl()}/xtra-logo.png`, supportEmail: supportEmail ?? null }
}

export async function brandFor(input: { organizationId: string; skin?: string | null }): Promise<EmailBrand> {
  const skin = skinByKey(input.skin)
  const [org] = await getDb()
    .select({ name: schema.organizations.name, logoUrl: schema.organizations.logoUrl, brandPrimary: schema.organizations.brandPrimary, email: schema.organizations.email })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, input.organizationId))
    .limit(1)
  if (skin) return { name: skin.label, logoUrl: `${publicBaseUrl()}${skin.assetsPath}/email-logo.png`, color: skin.brandColor, supportEmail: org?.email ?? null }
  if (org?.logoUrl || org?.brandPrimary) return { name: org.name, logoUrl: org.logoUrl, color: org.brandPrimary ?? DEFAULT_BRAND.color, supportEmail: org.email }
  return defaultBrand(org?.name, org?.email)
}
