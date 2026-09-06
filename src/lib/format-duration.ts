/** A span of time as a person would say it: "12 דק׳", "3 שע׳", "2 ימים". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} שנ׳`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} דק׳`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} שע׳`
  return `${Math.round(hours / 24)} ימים`
}
