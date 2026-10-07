export const EVENT_VERSION = 1

export const GUESS_SCORES = ['close', 'partly', 'off', 'skipped'] as const
export type GuessScore = (typeof GUESS_SCORES)[number]

export const EXPLANATION_SCORES = ['clear', 'rough', 'missed'] as const
export type ExplanationScore = (typeof EXPLANATION_SCORES)[number]

export const CATEGORIES = ['planning', 'code', 'debugging', 'explaining', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

/** A count for every category, all 0. */
export const zeroCounts = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map(c => [c, 0])) as Record<Category, number>

type Base = { v: typeof EVENT_VERSION; at: number }

export type PaEvent = Base &
  (
    | { kind: 'setup'; why: string }
    | { kind: 'step'; to: number; how: 'setup' | 'up' | 'down' }
    | { kind: 'prompt'; step: number; category: Category }
    | { kind: 'reflection' }
    | { kind: 'admission'; words: string }
    | { kind: 'guess'; score: GuessScore }
    | { kind: 'explanation'; score: ExplanationScore }
    | { kind: 'rough-day' }
    | { kind: 'week'; weekStart: number; counts: Record<Category, number> }
  )

export type EventBody = PaEvent extends infer E ? (E extends PaEvent ? Omit<E, 'v' | 'at'> : never) : never

export function makeEvent(at: number, body: EventBody): PaEvent {
  return { v: EVENT_VERSION, at, ...body } as PaEvent
}
