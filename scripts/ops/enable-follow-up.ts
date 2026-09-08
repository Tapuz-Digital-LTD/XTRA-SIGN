import { and, eq, ilike, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * Turns on the site-product follow-up task for one campaign (by name):
 * `groups.follow_up_config = { afterSign: ['site_product'] }`. Additive, one
 * row, nothing else. Run the backfill afterwards for those who already signed.
 *
 *   CAMPAIGN=התיירות dotenv -e <env> -- tsx scripts/ops/enable-follow-up.ts
 */
const CAMPAIGN = process.env.CAMPAIGN ?? 'התיירות'
async function main() {
  const db = getDb()
  const [g] = await db.select({ id: schema.groups.id, name: schema.groups.name, followUpConfig: schema.groups.followUpConfig }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), ilike(schema.groups.name, `%${CAMPAIGN}%`))).limit(1)
  if (!g) throw new Error('campaign not found')
  const current = (g.followUpConfig as { afterSign?: string[] } | null)?.afterSign ?? []
  if (current.includes('site_product')) {
    console.log(`${g.name}: already on (${JSON.stringify(g.followUpConfig)})`)
    return
  }
  await db.update(schema.groups).set({ followUpConfig: { afterSign: [...new Set([...current, 'site_product'])] } }).where(eq(schema.groups.id, g.id))
  console.log(`${g.name} (${g.id}): follow_up_config → { afterSign: ['site_product'] }`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
