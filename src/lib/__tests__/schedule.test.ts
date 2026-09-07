import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { describeCron, REMINDER_CRON } from '@/lib/schedule'

describe('schedule', () => {
  it('mirrors the deployed cron exactly', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: { path: string; schedule: string }[] }
    const reminders = vercel.crons?.find((c) => c.path.includes('reminders'))
    expect(reminders?.schedule).toBe(REMINDER_CRON)
  })
  it('says the hour in Israel time for the day in question', () => {
    // Summer (IDT, UTC+3): 07:00 UTC → 10:00. Winter (IST, UTC+2): → 09:00.
    expect(describeCron('0 7 * * 0-4', new Date('2026-07-01T00:00:00Z')).time).toBe('10:00')
    expect(describeCron('0 7 * * 0-4', new Date('2026-12-01T00:00:00Z')).time).toBe('09:00')
    expect(describeCron('0 7 * * 0-4', new Date('2026-07-01T00:00:00Z')).days).toBe('א׳–ה׳')
    expect(describeCron('30 5 * * *', new Date('2026-07-01T00:00:00Z')).sentence).toBe('כל יום בשעה 08:30 (שעון ישראל)')
  })
})
