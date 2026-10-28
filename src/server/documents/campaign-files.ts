import { and, eq, sql } from 'drizzle-orm'
import { CALL_VERSION_LABELS, callVersionsOf } from '@/lib/self-service-skins'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'
import { selfServiceOf } from '@/server/projects/self-service'
import { agreementCallVersion } from '@/server/self-service/call-version'
import { documentsWhere, type ListFilter } from './queries'

export type CampaignFile = { id: string; fileName: string }

/** A business name as a file name that opens on Windows too: its quotes become gershayim, its slashes dashes. */
function fileBase(name: string): string {
  return name
    .replace(/"/g, '״')
    .replace(/[\\/:*?<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/**
 * The signed files behind the campaign's agreements tab, as it is filtered:
 * the same rows (documentsWhere), signed ones only, one file each, named by
 * the business. A business with two signed agreements in the view — both
 * tracks — gets its version beside its name. The bytes are not read here:
 * the browser fetches each file through the route that authorizes it.
 */
export async function signedCampaignFiles(
  session: StaffSession,
  groupId: string,
  options: { filter?: ListFilter; callVersion?: string },
): Promise<CampaignFile[]> {
  const group = await authorizeGroup(session, groupId)
  const versioned = callVersionsOf(selfServiceOf(group.landingConfig).skin).length > 0
  const rows = await getDb()
    .select({
      id: schema.agreements.id,
      title: schema.agreements.title,
      company: schema.companies.name,
      version: sql<string>`${agreementCallVersion('agreements')}`,
    })
    .from(schema.agreements)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(
      and(
        documentsWhere(session, { groupId, filter: options.filter, callVersion: options.callVersion }),
        eq(schema.agreements.status, 'signed'),
        sql`exists (select 1 from ${schema.agreementVersions} v where v.agreement_id = ${schema.agreements.id} and v.signed_file_key is not null)`,
      ),
    )
    // Oldest signature first, so a "(2)" always lands on the same file.
    .orderBy(schema.agreements.completedAt, schema.agreements.id)

  const named = rows.map((row) => ({ ...row, base: fileBase(row.company ?? row.title) || 'הסכם' }))
  const repeats = new Map<string, number>()
  for (const row of named) repeats.set(row.base, (repeats.get(row.base) ?? 0) + 1)

  const taken = new Set<string>()
  return named
    .map((row) => {
      const stem = versioned && (repeats.get(row.base) ?? 0) > 1 ? fileBase(`${row.base} — ${CALL_VERSION_LABELS[row.version] ?? row.version}`) : row.base
      let fileName = `${stem}.pdf`
      for (let n = 2; taken.has(fileName); n++) fileName = `${stem} (${n}).pdf`
      taken.add(fileName)
      return { id: row.id, fileName }
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName, 'he'))
}
