import { EVENT_VERSION, makeEvent, zeroCounts, type Category, type PaEvent } from './events.ts'
import { DAY_MS, startOfLocalWeek } from './time.ts'

export type StoreLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

const EVENTS = 'events:'
/** Old sessions' events, after roll-up. The name does not start with EVENTS, so it is never read as a session's key. */
const ARCHIVE = 'archive'
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

/**
 * The archive holds old sessions' events, with their prompts folded into weekly totals.
 * `moved` maps each session key to the newest `at` already copied in. Events in that
 * key at or before it are in the archive, so readers skip them there.
 */
type Archive = { events: PaEvent[]; moved: Record<string, number> }

async function readArchive(store: StoreLike): Promise<Archive> {
  const value = (await store.get(ARCHIVE)) as { events?: unknown; moved?: unknown } | undefined
  const events = Array.isArray(value?.events) ? value.events.filter(isPaEvent) : []
  const raw = value?.moved
  const moved =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
      : {}
  return { events, moved }
}

/** Turns prompts into weekly totals, adding to any totals already there. Other events stay as they are. */
function foldPrompts(events: readonly PaEvent[]): PaEvent[] {
  const byWeek = new Map<number, Record<Category, number>>()
  const add = (week: number, counts: Partial<Record<Category, number>>) => {
    const total = byWeek.get(week) ?? zeroCounts()
    for (const [category, n] of Object.entries(counts) as [Category, number][]) total[category] += n
    byWeek.set(week, total)
  }
  for (const e of events) {
    if (e.kind === 'week') add(e.weekStart, e.counts)
    if (e.kind === 'prompt') add(startOfLocalWeek(e.at), { [e.category]: 1 })
  }
  const weeks = [...byWeek].map(([weekStart, counts]) => makeEvent(weekStart, { kind: 'week', weekStart, counts }))
  const rest = events.filter(e => e.kind !== 'prompt' && e.kind !== 'week')
  return [...rest, ...weeks].sort((a, b) => a.at - b.at)
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
    // The archive first, then the keys. A roll-up that lands in between moves a key the
    // archive read here does not have yet, so that key's events are still read once, from the key.
    const archive = await readArchive(this.store)
    const keys = (await this.store.keys()).filter(k => k.startsWith(EVENTS))
    const lists = await Promise.all(
      keys.map(async k => {
        const moved = archive.moved[k] ?? -Infinity
        return (await listAt(this.store, k)).filter(e => e.at > moved)
      }),
    )
    return [...archive.events, ...lists.flat()].sort((a, b) => a.at - b.at)
  }
}

/**
 * Moves sessions that have been quiet for 30 days into the archive, prompts folded into
 * weekly totals. Runs at session start. Only roll-up writes the archive. Each live session
 * still writes only its own key.
 *
 * A key is copied in first, and deleted at a later roll-up, once the archive read at the
 * start of that roll-up already holds it. The archive's events and `moved` are one value,
 * written together, so every event is counted once: from the archive when `moved` covers
 * it, from its key when not.
 *
 * Two roll-ups at once (two sessions starting together) can both write the archive. Each
 * re-reads it just before its write, but the later write can still drop what the earlier
 * one added. Nothing is lost then: the dropped key is not in `moved`, so it is read from
 * its own key, which still exists, and the next roll-up copies it again. The race we accept:
 * a stale write that drops a key landing after a later roll-up deleted that key. That needs
 * one roll-up's re-read and write to straddle two other session starts.
 */
export async function rollUp(store: StoreLike, ownSessionId: string, now: number): Promise<void> {
  const live = new Set((await store.keys()).filter(k => k.startsWith(EVENTS)))
  const keys = [...live].filter(k => k !== EVENTS + ownSessionId)
  const before = await readArchive(store)
  const toMove = new Map<string, PaEvent[]>()
  for (const key of keys) {
    const moved = before.moved[key] ?? -Infinity
    const fresh = (await listAt(store, key)).filter(e => e.at > moved)
    if (fresh.length === 0) {
      // Everything in it was already in the archive when this roll-up started.
      if (key in before.moved) await store.delete(key)
      continue
    }
    if (Math.max(...fresh.map(e => e.at)) > now - ROLL_UP_AFTER_MS) continue
    toMove.set(key, fresh)
  }
  if (toMove.size === 0) return

  const archive = await readArchive(store)
  // Forget keys deleted at an earlier roll-up. A key deleted just now keeps its mark.
  const moved = Object.fromEntries(Object.entries(archive.moved).filter(([key]) => live.has(key)))
  let events = archive.events
  for (const [key, fresh] of toMove) {
    // Another roll-up may have copied some of these since this one started.
    const copied = archive.moved[key] ?? -Infinity
    const add = fresh.filter(e => e.at > copied)
    events = [...events, ...add]
    moved[key] = Math.max(copied, ...fresh.map(e => e.at))
  }
  await store.set(ARCHIVE, { events: foldPrompts(events), moved })
}
