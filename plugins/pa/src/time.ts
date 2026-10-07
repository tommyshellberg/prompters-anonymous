export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day holding `ms`, as YYYY-MM-DD. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight at the start of the day holding `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local midnight on the Monday of the week holding `ms`. */
export function startOfLocalWeek(ms: number): number {
  const d = new Date(startOfLocalDay(ms))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}
