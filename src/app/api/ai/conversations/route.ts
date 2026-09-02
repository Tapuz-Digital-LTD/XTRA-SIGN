import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { listConversations } from '@/server/ai/conversations'
import { templateFailure } from '@/server/http/template-errors'

/** The current user's own conversations, newest first. */
export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ ok: true, conversations: await listConversations(session) })
  } catch (error) {
    return templateFailure(error)
  }
}
