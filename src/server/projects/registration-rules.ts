import { sql, type SQL } from 'drizzle-orm'
import { schema } from '@/server/db'

/**
 * What counts as a registration — in one place, used by every list, count,
 * KPI, export and bulk action that says "הרשמות".
 *
 * A registration is a row whose form was actually submitted: the submission
 * writes `form_snapshot` (the fields as they were asked), and nothing else
 * does — an invitation, an import or adding someone to the audience never
 * sets it. A failed submission keeps its snapshot, so it stays visible in
 * הרשמות with its failure; a claim still being processed is not listed yet.
 */
export function submittedRegistration(leads: typeof schema.projectLeads = schema.projectLeads): SQL {
  return sql`(${leads.formSnapshot} is not null and ${leads.status} <> 'pending')`
}
