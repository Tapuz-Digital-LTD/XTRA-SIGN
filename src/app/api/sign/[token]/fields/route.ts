import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { hasVerifiedSession, isSignable, resolveSigningToken } from '@/server/signing/session'

/**
 * Saves what the signer typed.
 *
 * Only fields marked as the signer's are writable: a value posted for a field
 * we own would let the signer rewrite the commission rate on the agreement they
 * are signing.
 */
export async function PUT(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request)
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    throw error
  }

  const { token } = await context.params
  const signing = await resolveSigningToken(token)
  if (!signing || !isSignable(signing.status)) {
    return NextResponse.json({ error: { message: 'הקישור אינו זמין.' } }, { status: 404 })
  }

  // Filling in fields requires the verified session, not just the link.
  if (signing.recipientPhone && !(await hasVerifiedSession(signing))) {
    return NextResponse.json({ error: { message: 'נדרש אימות טלפון.' } }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { values?: unknown } | null
  const values = body?.values
  if (typeof values !== 'object' || values === null) {
    return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
  }

  const db = getDb()
  const fields = await db
    .select()
    .from(schema.fields)
    .where(eq(schema.fields.agreementVersionId, signing.versionId))

  const supplied = values as Record<string, unknown>
  let written = 0

  for (const field of fields) {
    if (field.ownedBy !== 'signer') continue
    if (field.type === 'signature') continue

    const raw = supplied[field.id]
    if (typeof raw !== 'string') continue

    const value = raw.slice(0, 500)

    // A select may only carry one of its own options.
    if (field.type === 'select') {
      const options = (field.options as string[] | null) ?? []
      if (value && !options.includes(value)) continue
    }

    await db
      .update(schema.fields)
      .set({ value: value || null, filledAt: value ? new Date() : null })
      .where(eq(schema.fields.id, field.id))
    written++
  }

  if (written > 0) {
    await db.insert(schema.auditEvents).values({
      agreementId: signing.agreementId,
      recipientId: signing.recipientId,
      type: AUDIT_EVENTS.FIELD_COMPLETED,
      actor: 'signer',
      ip: request.headers.get('x-forwarded-for'),
      metadata: { count: written },
    })
  }

  return NextResponse.json({ ok: true, saved: written })
}
