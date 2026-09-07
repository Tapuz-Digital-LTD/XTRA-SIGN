import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { templateFailure } from '@/server/http/template-errors'

/**
 * The people a task can be handed to: the organization's active users, by
 * name. Not the admin listing — no phones, no roles — just enough for a
 * "who handles this" select that anyone on the team may use.
 */
export async function GET() {
  try {
    const session = await requireSession()
    const users = await getDb()
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.organizationId, session.organizationId), isNull(schema.users.disabledAt)))
      .orderBy(schema.users.name)
    return NextResponse.json({ users })
  } catch (error) {
    return templateFailure(error)
  }
}
