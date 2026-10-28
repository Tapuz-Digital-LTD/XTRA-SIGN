import { sql, type SQL } from 'drizzle-orm'
import { CALL_VERSION_LABELS, SKINS_WITH_CALLS } from '@/lib/self-service-skins'

/**
 * The version of the call an agreement or a registration belongs to
 * (CONTEXT.md, גרסת קול קורא), as SQL — one definition for the agreements
 * tab, the ZIP of signed files, the campaign report and the report builder.
 *
 * The agreement's own frozen snapshot decides the 18 ₪ track (the SQL twin of
 * isBenefit18Values); otherwise the invitation it came through says which
 * version it was sent in (`project_leads.meta.call`); anyone else — someone
 * who registered on their own from the general page — is "רגיל". So "מלונות"
 * means invited in the hotels' version, not "a hotel".
 */

export const CALL_VERSION_KEYS = Object.keys(CALL_VERSION_LABELS)
const SENT_VERSIONS = CALL_VERSION_KEYS.filter((key) => key !== 'regular')
const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `)

const benefit18Snapshot = (a: string) =>
  sql`((${sql.raw(a)}.merge_snapshot->'values'->>'withAppendix') = 'true' and coalesce(${sql.raw(a)}.merge_snapshot->'values'->>'redemption', '') = '')`

/** `a` is an agreements alias inside a campaign that has versions. */
export function agreementCallVersion(a: string): SQL {
  return sql`case when ${benefit18Snapshot(a)} then 'benefit18' else coalesce(
    (select cv.meta->>'call' from project_leads cv where cv.agreement_id = ${sql.raw(a)}.id and cv.meta->>'call' in (${list(SENT_VERSIONS)}) limit 1),
    'regular') end`
}

/** `pl` is a project_leads alias: its agreement's track first, as above, then the version it was invited or registered with. */
export function leadCallVersion(pl: string): SQL {
  return sql`case
    when exists (select 1 from agreements ca where ca.id = ${sql.raw(pl)}.agreement_id and ${benefit18Snapshot('ca')}) then 'benefit18'
    when ${sql.raw(pl)}.meta->>'call' in (${list(SENT_VERSIONS)}) then ${sql.raw(pl)}.meta->>'call'
    else 'regular' end`
}

/** Only a campaign whose page has versions gives its rows one; elsewhere the version is empty, not "רגיל". */
export function withinVersionedCampaign(g: string, version: SQL): SQL {
  if (SKINS_WITH_CALLS.length === 0) return sql`null`
  return sql`case when ${sql.raw(g)}.landing_config->'selfService'->>'skin' in (${list(SKINS_WITH_CALLS)}) then ${version} end`
}

/**
 * The campaign a self-service agreement was signed through, from its snapshot.
 * The third way an agreement belongs to a campaign, beside its registration
 * and its bulk send: a business that adds the second track signs a new
 * agreement while its registration row keeps pointing at the first.
 */
export function campaignOfSnapshot(snapshot: SQL): SQL {
  return sql`(${snapshot}->'selfService'->>'projectId')`
}

export function isCallVersion(value: unknown): value is string {
  return typeof value === 'string' && CALL_VERSION_KEYS.includes(value)
}
