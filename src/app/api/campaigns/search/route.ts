import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { templateFailure } from '@/server/http/template-errors'
import { DIRECT_SIGNING_KEY } from '@/server/invitations/invitations'

/**
 * Campaigns by name, for the combobox: a page of matches, never the whole
 * list. Ended and archived campaigns are included (an admin sees archived
 * ones), and the internal direct-signing context appears as "חתימה ישירה".
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') ?? 12) || 12))
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
    const rows = await getDb()
      .select({ id: schema.groups.id, name: schema.groups.name, goal: schema.groups.goal, status: schema.groups.status, archivedAt: schema.groups.archivedAt, systemKey: schema.groups.systemKey, endsAt: schema.groups.endsAt })
      .from(schema.groups)
      .where(
        and(
          eq(schema.groups.organizationId, session.organizationId),
          isNull(schema.groups.deletedAt),
          session.isAdmin ? undefined : isNull(schema.groups.archivedAt),
          like ? or(ilike(schema.groups.name, like), sql`${schema.groups.systemKey} = ${DIRECT_SIGNING_KEY} and ${'חתימה ישירה'} ilike ${like}`) : undefined,
        ),
      )
      .orderBy(desc(schema.groups.createdAt))
      .limit(limit)
    return NextResponse.json({
      campaigns: rows.map((r) => ({
        id: r.id,
        name: r.systemKey === DIRECT_SIGNING_KEY ? 'חתימה ישירה' : r.name,
        kind: r.systemKey === DIRECT_SIGNING_KEY ? 'direct' : r.goal === 'inquiries' ? 'inquiries' : 'signing',
        status: r.archivedAt ? 'archived' : r.status === 'ended' || (r.endsAt && r.endsAt < new Date()) ? 'ended' : r.status === 'paused' ? 'paused' : 'active',
      })),
    })
  } catch (error) {
    return templateFailure(error)
  }
}
