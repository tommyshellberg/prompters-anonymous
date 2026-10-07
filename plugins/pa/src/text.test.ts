import { test, expect, describe } from 'claude-code/testing'
import { makeEvent, type Category } from './events.ts'
import type { Status } from './status.ts'
import type { StepDef } from './ladder.ts'
import { bar, meetingLine, stepLine, shares, thenVsNow, report, NOT_SET_UP_LINE } from './text.ts'

const STEPS: StepDef[] = [
  { number: 1, name: 'Admit it', line: '', measure: 'reflection', window: 3, need: 3, instructions: '' },
  { number: 2, name: 'Guess first', line: '', measure: 'guess', window: 10, need: 8, instructions: '' },
  { number: 3, name: 'Explain it back', line: '', measure: 'explanation', window: 10, need: 8, instructions: '' },
]
const status = (over: Partial<Status>): Status => ({
  isSetUp: true, why: 'debug without panicking', setupAt: 0, day: 23, step: 2, effectiveStep: 2, isRoughDay: false,
  roughDaysThisWeek: 0, progress: { good: 6, window: 10, need: 8 }, isReady: false, canStepDown: true, hasAdmitted: true, ...over,
})

test('bar fills in proportion', () => {
  expect(bar(6, 10)).toBe('▓▓▓▓▓▓░░░░')
  expect(bar(2, 3)).toBe('▓▓▓▓▓▓▓░░░')
  expect(bar(0, 0)).toBe('░░░░░░░░░░')
})

test('the meeting line', () => {
  expect(meetingLine(status({}), STEPS)).toBe("Hi, I'm a prompter. Day 23 · Step 2 · Guess first.")
})

describe('stepLine', () => {
  test('normal', () => {
    expect(stepLine(status({}), STEPS)).toBe('Step 2 · Guess first · ▓▓▓▓▓▓░░░░ 6/10')
  })
  test('ready', () => {
    expect(stepLine(status({ isReady: true, progress: { good: 8, window: 10, need: 8 } }), STEPS)).toBe(
      'Step 2 · Guess first · ▓▓▓▓▓▓▓▓░░ 8/10 · ready for step 3 ✓',
    )
  })
  test('rough day', () => {
    expect(stepLine(status({ step: 6, isRoughDay: true }), STEPS)).toBe('Step 6 · Rough day, back tomorrow 💛')
  })
  test('not set up', () => {
    expect(stepLine(status({ isSetUp: false }), STEPS)).toBe(NOT_SET_UP_LINE)
  })
})

describe('then vs now', () => {
  const DAY = 86_400_000
  const p = (at: number, category: Category) => makeEvent(at, { kind: 'prompt', step: 1, category })

  test('shares are whole percents of prompts in the range', () => {
    const events = [p(1, 'planning'), p(2, 'planning'), p(3, 'code'), p(4, 'debugging'), p(50, 'code')]
    expect(shares(events, 0, 10)).toEqual({ planning: 50, code: 25, debugging: 25, explaining: 0, other: 0 })
  })

  test('weekly roll-ups count too', () => {
    const counts = { planning: 3, code: 1, debugging: 0, explaining: 0, other: 0 }
    const events = [makeEvent(5, { kind: 'week', weekStart: 5, counts })]
    expect(shares(events, 0, 10).planning).toBe(75)
  })

  test('says nothing before day 14', () => {
    expect(thenVsNow([], status({ day: 13 }), 13 * DAY)).toBeNull()
  })

  // Local dates, so these pass in any time zone. 7 Oct 2026 is a Wednesday; its week starts Monday 5 Oct.
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
  const setupAt = at(2026, 10, 7)
  const now = at(2026, 11, 6)
  const thisWeek = [p(at(2026, 11, 3), 'planning'), ...[0, 1, 2, 3].map(i => p(at(2026, 11, 4) + i, 'code'))]

  test('compares the first calendar week with the last 7 days', () => {
    const events = [
      p(at(2026, 10, 7), 'planning'), p(at(2026, 10, 8), 'planning'), p(at(2026, 10, 10), 'code'),
      // Monday 12 Oct is in the next calendar week. Counting 7 days from setup would wrongly include it.
      p(at(2026, 10, 12), 'code'),
      ...thisWeek,
    ]
    // First week: 2 of 3 planning. This week: 1 of 5 planning.
    expect(thenVsNow(events, status({ day: 31, setupAt }), now)).toBe('Your first week: 67% of your asks were for planning. This week: 20%.')
  })

  test('the first week reads the same after its prompts are rolled up', () => {
    const counts = { planning: 2, code: 1, debugging: 0, explaining: 0, other: 0 }
    const weekStart = at(2026, 10, 5, 0)
    const events = [makeEvent(weekStart, { kind: 'week', weekStart, counts }), p(at(2026, 10, 12), 'code'), ...thisWeek]
    expect(thenVsNow(events, status({ day: 31, setupAt }), now)).toBe('Your first week: 67% of your asks were for planning. This week: 20%.')
  })
})

test('the report shows the why first', () => {
  const text = report(status({}), STEPS, [], 0)
  expect(text.split('\n')[0]).toContain('debug without panicking')
  expect(text).toContain('Step 2 · Guess first')
})
