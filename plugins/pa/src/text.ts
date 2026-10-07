import { CATEGORIES, zeroCounts, type Category, type PaEvent } from './events.ts'
import type { StepDef } from './ladder.ts'
import type { Status } from './status.ts'
import { DAY_MS, WEEK_MS, startOfLocalWeek } from './time.ts'

export const NOT_SET_UP_LINE = 'Prompters Anonymous · run /pa setup to begin'
export const NEEDS_A_LOOK_LINE = 'Prompters Anon needs a look, run /pa'

const nameOf = (steps: readonly StepDef[], n: number) => steps.find(s => s.number === n)?.name ?? `Step ${n}`

export function bar(good: number, window: number): string {
  const filled = window === 0 ? 0 : Math.round((good / window) * 10)
  return '▓'.repeat(filled) + '░'.repeat(10 - filled)
}

export function meetingLine(status: Status, steps: readonly StepDef[]): string {
  return `Hi, I'm a prompter. Day ${status.day} · Step ${status.step} · ${nameOf(steps, status.step)}.`
}

export function stepLine(status: Status, steps: readonly StepDef[]): string {
  if (!status.isSetUp) return NOT_SET_UP_LINE
  if (status.isRoughDay) return `Step ${status.step} · Rough day, back tomorrow 💛`
  const head = `Step ${status.step} · ${nameOf(steps, status.step)}`
  const p = status.progress
  const progress = p ? ` · ${bar(p.good, p.window)} ${p.good}/${p.window}` : ''
  const ready = status.isReady ? ` · ready for step ${status.step + 1} ✓` : ''
  return head + progress + ready
}

export function shares(events: readonly PaEvent[], from: number, to: number): Record<Category, number> {
  const counts = zeroCounts()
  for (const e of events) {
    if (e.kind === 'prompt' && e.at >= from && e.at < to) counts[e.category] += 1
    if (e.kind === 'week' && e.weekStart >= from && e.weekStart < to) for (const c of CATEGORIES) counts[c] += e.counts[c]
  }
  const total = CATEGORIES.reduce((sum, c) => sum + counts[c], 0)
  return Object.fromEntries(CATEGORIES.map(c => [c, total === 0 ? 0 : Math.round((counts[c] / total) * 100)])) as Record<Category, number>
}

export function thenVsNow(events: readonly PaEvent[], status: Status, now: number): string | null {
  if (status.day < 14) return null
  // The calendar week of setup, Monday to Monday, the same weeks the roll-up uses.
  // The end is found from 8 days on, so a daylight-saving change can't shift it by an hour.
  const firstWeek = startOfLocalWeek(status.setupAt)
  const then = shares(events, firstWeek, startOfLocalWeek(firstWeek + 8 * DAY_MS))
  const recent = shares(events, now - WEEK_MS, now + 1)
  return `Your first week: ${then.planning}% of your asks were for planning. This week: ${recent.planning}%.`
}

export function report(status: Status, steps: readonly StepDef[], events: readonly PaEvent[], now: number): string {
  if (!status.isSetUp) return `${NOT_SET_UP_LINE}.`
  const step = steps.find(s => s.number === status.step)
  const rows = [
    `Your why: "${status.why}"`,
    '',
    stepLine(status, steps),
    step?.line ? `  ${step.line}` : '',
    `Day ${status.day}.`,
  ]
  const trend = thenVsNow(events, status, now)
  if (trend) rows.push(trend)
  rows.push('', 'Commands: /pa up · /pa down · /pa rough-day')
  return rows.filter((row, i) => row !== '' || rows[i - 1] !== '').join('\n')
}
