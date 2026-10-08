import { EVENT_VERSION, makeEvent, zeroCounts, type Category, type PaEvent } from './events.ts'
import { DAY_MS, startOfLocalWeek } from './time.ts'

export type StoreLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  keys(): Promise<string[]>
}

const EVENTS = 'events:'
const ROLL_UP_AFTER_MS = 30 * DAY_MS
const KINDS = new Set(['setup', 'step', 'prompt', 'reflection', 'admission', 'guess', 'explanation', 'rough-day', 'week'])

export function isPaEvent(value: unknown): value is PaEvent {
  if (typeof value !== 'object' || value === null) return false
  const e = value as { v?: unknown; at?: unknown; kind?: unknown }
  return e.v === EVENT_VERSION && typeof e.at === 'number' && typeof e.kind === 'string' && KINDS.has(e.kind)
}

const listAt = async (store: StoreLike, key: string): Promise<PaEvent[]> => {
  const value = await store.get(key)
  return Array.isArray(value) ? value.filter(isPaEvent) : []
}

export class EventRecord {
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly store: StoreLike, private readonly sessionId: string) {}

  add(event: PaEvent): Promise<void> {
    // Chain writes so two quick adds in one session can't overwrite each other.
    // Re-read the key every time: another session may have rolled it up since our last write.
    const next = this.writing.then(async () => {
      const mine = await listAt(this.store, EVENTS + this.sessionId)
      await this.store.set(EVENTS + this.sessionId, [...mine, event])
    })
    // A failed write goes to this caller only. The chain stays alive for later adds.
    this.writing = next.catch(() => {})
    return next
  }

  async all(): Promise<PaEvent[]> {
    await this.writing
    const keys = (await this.store.keys()).filter(k => k.startsWith(EVENTS))
    const lists = await Promise.all(keys.map(k => listAt(this.store, k)))
    return lists.flat().sort((a, b) => a.at - b.at)
  }
}

export async function rollUp(store: StoreLike, ownSessionId: string, now: number): Promise<void> {
  const keys = (await store.keys()).filter(k => k.startsWith(EVENTS) && k !== EVENTS + ownSessionId)
  for (const key of keys) {
    const events = await listAt(store, key)
    const prompts = events.filter(e => e.kind === 'prompt')
    const newest = Math.max(...events.map(e => e.at))
    if (prompts.length === 0 || newest > now - ROLL_UP_AFTER_MS) continue

    // Start from the totals this key already holds, so a second roll-up adds to them.
    const byWeek = new Map<number, Record<Category, number>>()
    for (const e of events) if (e.kind === 'week') byWeek.set(e.weekStart, { ...e.counts })
    for (const p of prompts) {
      if (p.kind !== 'prompt') continue
      const week = startOfLocalWeek(p.at)
      const counts = byWeek.get(week) ?? zeroCounts()
      counts[p.category] += 1
      byWeek.set(week, counts)
    }
    const weeks = [...byWeek].map(([weekStart, counts]) => makeEvent(weekStart, { kind: 'week', weekStart, counts }))
    const rest = events.filter(e => e.kind !== 'prompt' && e.kind !== 'week')
    // One write: the totals go in and the prompts come out together, so a roll-up is never half done.
    await store.set(key, [...rest, ...weeks].sort((a, b) => a.at - b.at))
  }
}
