import { eq } from 'drizzle-orm'
import { getDb, schema } from '../../src/server/db'
import { mintAdditionalSigningLink, ttlDaysFor } from '../../src/server/documents/send-agreement'
import { currentSlugOf } from '../../src/server/projects/public-slug'

/**
 * A fresh signing link for an agreement that is still waiting: same
 * agreement, same recipient, a new token with the campaign's lifetime. The
 * page it opens still asks for the phone code. Nothing is sent from here.
 *
 *   AGREEMENT_ID=<uuid> npx dotenv-cli -e <env> -- npx tsx scripts/ops/mint-sign-link.ts
 */
const AGREEMENT_ID = process.env.AGREEMENT_ID ?? ''
if (!AGREEMENT_ID) throw new Error('AGREEMENT_ID required')

async function main() {
  const db = getDb()
  const [agreement] = await db.select({ id: schema.agreements.id, status: schema.agreements.status, title: schema.agreements.title }).from(schema.agreements).where(eq(schema.agreements.id, AGREEMENT_ID)).limit(1)
  if (!agreement) throw new Error('agreement not found')
  if (!['sent', 'viewed', 'expired'].includes(agreement.status)) throw new Error(`agreement is ${agreement.status}; only a waiting agreement gets a new link`)
  const [recipient] = await db.select({ id: schema.recipients.id, name: schema.recipients.name }).from(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id)).limit(1)
  if (!recipient) throw new Error('no recipient')
  const [lead] = await db.select({ groupId: schema.projectLeads.groupId }).from(schema.projectLeads).where(eq(schema.projectLeads.agreementId, agreement.id)).limit(1)
  const ttl = await ttlDaysFor(agreement.id)
  const minted = await mintAdditionalSigningLink(recipient.id, new Date(Date.now() + ttl * 24 * 60 * 60 * 1000))
  if (agreement.status === 'expired') await db.update(schema.agreements).set({ status: 'sent' }).where(eq(schema.agreements.id, agreement.id))
  const slug = lead ? await currentSlugOf(lead.groupId) : null
  const base = process.env.SIGN_PUBLIC_URL ?? ''
  console.log(`agreement "${agreement.title}" for ${recipient.name}: new link valid ${ttl} days`)
  console.log(slug ? `${base}/${slug}/sign/${minted.token}` : minted.signingUrl)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
