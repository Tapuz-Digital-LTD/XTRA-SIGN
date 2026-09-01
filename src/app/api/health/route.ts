import { NextResponse } from 'next/server'

/**
 * Liveness. Answers "is this process running", nothing more.
 *
 * Deliberately touches no dependency: a liveness probe that checks the database
 * makes ECS kill and restart every healthy task during a brief RDS blip, which
 * turns a recoverable incident into an outage.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true, service: 'xtra-sign' })
}
