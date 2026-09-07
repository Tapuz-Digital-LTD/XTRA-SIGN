/**
 * When the scheduled work runs — read from the one place that decides it
 * (`vercel.json` → `crons`), never typed by hand elsewhere. The screen that
 * says "the daily summary goes out at 10:00" gets the hour from here, in
 * Israel time, for today's offset.
 */

/** Mirrors vercel.json. A test keeps the two identical. */
export const REMINDER_CRON = '0 7 * * 0-4'

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

export type ScheduleDescription = {
  /** e.g. "10:00" in Asia/Jerusalem for the given date. */
  time: string
  /** e.g. "א׳–ה׳". */
  days: string
  timeZoneLabel: string
  /** "ימים א׳–ה׳ בשעה 10:00 (שעון ישראל)" */
  sentence: string
}

/** Cron in UTC → words in Israel time. Supports the shapes we use: "M H * * D-D" and "M H * * *". */
export function describeCron(cron: string, on: Date = new Date(), timeZone = 'Asia/Jerusalem'): ScheduleDescription {
  const [minute, hour, , , dow] = cron.trim().split(/\s+/)
  const utc = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), Number(hour), Number(minute)))
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(utc)
  let days = 'כל יום'
  if (dow && dow !== '*') {
    const parts = dow.split(',').map((p) => p.split('-').map(Number))
    const names = parts.map(([a, b]) => (b !== undefined && b !== a ? `${DAY_NAMES[a]}–${DAY_NAMES[b]}` : DAY_NAMES[a]))
    days = names.join(', ')
  }
  const timeZoneLabel = 'שעון ישראל'
  return { time, days, timeZoneLabel, sentence: `${days === 'כל יום' ? 'כל יום' : `ימים ${days}`} בשעה ${time} (${timeZoneLabel})` }
}
