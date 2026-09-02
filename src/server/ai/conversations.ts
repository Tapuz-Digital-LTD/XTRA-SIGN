import { and, desc, eq, isNull } from 'drizzle-orm'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'

/**
 * Conversations, scoped to the person who had them.
 *
 * A colleague's half-finished instruction to send eighty agreements is not
 * something to hand to someone else, so these are private to their author even
 * within one organization.
 */

const MAX_TITLE = 80

export type ConversationSummary = {
  id: string
  title: string
  updatedAt: Date
}

export async function listConversations(session: StaffSession): Promise<ConversationSummary[]> {
  return getDb()
    .select({
      id: schema.aiConversations.id,
      title: schema.aiConversations.title,
      updatedAt: schema.aiConversations.updatedAt,
    })
    .from(schema.aiConversations)
    .where(
      and(
        eq(schema.aiConversations.userId, session.userId),
        eq(schema.aiConversations.organizationId, session.organizationId),
        isNull(schema.aiConversations.deletedAt),
      ),
    )
    .orderBy(desc(schema.aiConversations.updatedAt))
    .limit(30)
}

/** Throws rather than returning null: a conversation someone else owns is not visible. */
export async function authorizeConversation(session: StaffSession, id: string) {
  const [conversation] = await getDb()
    .select()
    .from(schema.aiConversations)
    .where(
      and(
        eq(schema.aiConversations.id, id),
        eq(schema.aiConversations.userId, session.userId),
        eq(schema.aiConversations.organizationId, session.organizationId),
        isNull(schema.aiConversations.deletedAt),
      ),
    )
    .limit(1)

  if (!conversation) throw new ForbiddenError()
  return conversation
}

export async function createConversation(
  session: StaffSession,
  firstMessage: string,
): Promise<string> {
  // The opening line makes a better name than "שיחה חדשה", and can be renamed.
  const title = firstMessage.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE) || 'שיחה חדשה'

  const [row] = await getDb()
    .insert(schema.aiConversations)
    .values({ organizationId: session.organizationId, userId: session.userId, title })
    .returning({ id: schema.aiConversations.id })

  return row.id
}

export async function loadMessages(
  session: StaffSession,
  conversationId: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  await authorizeConversation(session, conversationId)

  const rows = await getDb()
    .select({ role: schema.aiMessages.role, content: schema.aiMessages.content })
    .from(schema.aiMessages)
    .where(eq(schema.aiMessages.conversationId, conversationId))
    .orderBy(schema.aiMessages.createdAt)
    .limit(100)

  return rows.map((row) => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content }))
}

export async function appendMessage(input: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
}): Promise<string> {
  const db = getDb()
  const [row] = await db
    .insert(schema.aiMessages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content.slice(0, 20_000),
    })
    .returning({ id: schema.aiMessages.id })

  await db
    .update(schema.aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.aiConversations.id, input.conversationId))

  return row.id
}

export async function renameConversation(
  session: StaffSession,
  id: string,
  title: string,
): Promise<void> {
  await authorizeConversation(session, id)
  await getDb()
    .update(schema.aiConversations)
    .set({ title: title.trim().slice(0, MAX_TITLE) || 'שיחה חדשה', updatedAt: new Date() })
    .where(eq(schema.aiConversations.id, id))
}

/** Soft: the actions taken during it stay in the audit trail. */
export async function deleteConversation(session: StaffSession, id: string): Promise<void> {
  await authorizeConversation(session, id)
  await getDb()
    .update(schema.aiConversations)
    .set({ deletedAt: new Date() })
    .where(eq(schema.aiConversations.id, id))
}
