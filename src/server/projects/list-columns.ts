import { eq, sql } from 'drizzle-orm'
import { TOURISM_FORM_COLUMNS, YES_NO, type FormColumn } from '@/lib/form-columns'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'
import { selfServiceOf } from './self-service'

/**
 * Which of the form's answers a campaign shows as columns.
 *
 * The catalogue is the campaign's own form: the self-service form's answers
 * when the project has a campaign page, otherwise the custom questions of its
 * joining form. The choice belongs to the project, not to a browser — it is
 * kept in `groups.landing_config.listColumns`, beside the rest of the public
 * face — so every rep opens the same table, and the file matches it.
 */

const MAX_COLUMNS = 12

export function formColumnsOf(landingConfig: unknown): FormColumn[] {
  if (selfServiceOf(landingConfig).skin) return TOURISM_FORM_COLUMNS
  const raw = (landingConfig && typeof landingConfig === 'object' ? landingConfig : {}) as { fields?: unknown }
  const fields = Array.isArray(raw.fields) ? (raw.fields as { id?: unknown; label?: unknown; type?: unknown; hidden?: unknown }[]) : []
  return fields
    .filter((f) => typeof f.id === 'string' && f.id.startsWith('custom_') && typeof f.label === 'string' && !f.hidden)
    .map((f) => ({ key: f.id as string, label: f.label as string, ...(f.type === 'checkbox' ? { options: YES_NO } : {}) }))
}

/** The chosen columns, in the chosen order — only ones the form still has. */
export function listColumnsOf(landingConfig: unknown): FormColumn[] {
  const raw = (landingConfig && typeof landingConfig === 'object' ? landingConfig : {}) as { listColumns?: unknown }
  const keys = Array.isArray(raw.listColumns) ? raw.listColumns.filter((k): k is string => typeof k === 'string') : []
  const catalogue = formColumnsOf(landingConfig)
  return keys.map((k) => catalogue.find((c) => c.key === k)).filter((c): c is FormColumn => Boolean(c)).slice(0, MAX_COLUMNS)
}

/** Saves the choice: unknown keys are dropped, order is kept. A jsonb merge, so a settings save racing it loses nothing. */
export async function saveListColumns(session: StaffSession, groupId: string, keys: unknown): Promise<FormColumn[]> {
  const group = await authorizeGroup(session, groupId)
  const catalogue = formColumnsOf(group.landingConfig)
  const listColumns = [...new Set((Array.isArray(keys) ? keys : []).filter((k): k is string => typeof k === 'string' && catalogue.some((c) => c.key === k)))].slice(0, MAX_COLUMNS)
  await getDb()
    .update(schema.groups)
    .set({ landingConfig: sql`coalesce(${schema.groups.landingConfig}, '{}'::jsonb) || ${JSON.stringify({ listColumns })}::jsonb` })
    .where(eq(schema.groups.id, group.id))
  return listColumnsOf({ ...((group.landingConfig ?? {}) as object), listColumns })
}
