import { eq } from 'drizzle-orm'
import { getDb, schema } from '../src/server/db'

/**
 * Creates or updates the "שבוע התיירות 2026" project — the XTRA Sign side of
 * the Ministry of Tourism landing page. Idempotent: run it again to converge
 * the landing config without touching existing leads.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/tourism-project.ts
 *   npx dotenv-cli -e .env.vercel.production -- npx tsx scripts/tourism-project.ts
 *
 * The slug is fixed: the public page (src/app/tourism-2026) refers to it. This
 * project is XTRA Sign only — nothing here syncs to Fireberry.
 */

import { TOURISM_FORM_SLUG } from '../src/app/tourism-2026/config'

export const TOURISM_PROJECT_NAME = 'שבוע התיירות 2026'

const FIELDS = [
  { id: 'name', type: 'text', label: 'שם בית העסק', required: true },
  { id: 'taxId', type: 'text', label: 'ח.פ העסק', required: true },
  {
    id: 'custom_benefit_type',
    type: 'select',
    label: 'סוג ההטבה',
    required: true,
    // GO-LIVE: the benefit list needs the Ministry's final options; the
    // reference screen shows only "25%".
    options: ['25%'],
  },
  { id: 'contactName', type: 'text', label: 'שם איש קשר', required: true },
  { id: 'phone', type: 'phone', label: 'טלפון', required: true },
  { id: 'email', type: 'email', label: 'אימייל', required: true },
]

async function main() {
  const db = getDb()
  const agreementFileKey = process.argv[2] ?? null

  const [org] = await db.select().from(schema.organizations).limit(1)
  if (!org) throw new Error('no organization found — bootstrap the app first')

  const landingConfig = {
    title: TOURISM_PROJECT_NAME,
    description: 'קמפיין שבוע התיירות הישראלית — נובמבר 2026',
    successMessage: 'תודה, הפרטים התקבלו בהצלחה. נציגי הפרויקט יצרו איתכם קשר בהמשך.',
    imageUrl: null,
    fields: FIELDS,
    allowedOrigins: [],
    ...(agreementFileKey ? { agreementFileKey } : {}),
  }

  const [existing] = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.landingSlug, TOURISM_FORM_SLUG))
    .limit(1)

  if (existing) {
    const prevConfig = (existing.landingConfig ?? {}) as Record<string, unknown>
    await db
      .update(schema.groups)
      .set({
        name: TOURISM_PROJECT_NAME,
        kind: 'supplier',
        landingEnabled: true,
        landingConfig: { ...prevConfig, ...landingConfig },
        deletedAt: null,
        archivedAt: null,
      })
      .where(eq(schema.groups.id, existing.id))
    console.log(`updated project ${existing.id} (slug ${TOURISM_FORM_SLUG})`)
  } else {
    const [created] = await db
      .insert(schema.groups)
      .values({
        organizationId: org.id,
        name: TOURISM_PROJECT_NAME,
        description: 'קמפיין משרד התיירות — דף נחיתה ציבורי. XTRA Sign בלבד, ללא Fireberry.',
        kind: 'supplier',
        landingEnabled: true,
        landingSlug: TOURISM_FORM_SLUG,
        landingConfig,
      })
      .returning({ id: schema.groups.id })
    console.log(`created project ${created.id} (slug ${TOURISM_FORM_SLUG})`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
