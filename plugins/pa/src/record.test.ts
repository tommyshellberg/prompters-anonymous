import { test, expect } from 'claude-code/testing'
import { makeEvent, type Category, type PaEvent } from './events.ts'
import { EventRecord, rollUp, type StoreLike } from './record.ts'

const memoryStore = (): StoreLike & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async key => data.get(key),
    set: async (key, value) => void data.set(key, JSON.parse(JSON.stringify(value))),
    keys: async () => [...data.keys()],
  }
}
const DAY = 86_400_000

test('a session writes only its own key', async () => {
  const store = memoryStore()
  await new EventRecord(store, 'a').add(makeEvent(1, { kind: 'reflection' }))
  await new EventRecord(store, 'b').add(makeEvent(2, { kind: 'reflection' }))
  expect([...store.data.keys()].sort()).toEqual(['events:a', 'events:b'])
})

test('all() merges every session, sorted by time', async () => {
  const store = memoryStore()
  const a = new EventRecord(store, 'a')
  const b = new EventRecord(store, 'b')
  await b.add(makeEvent(2, { kind: 'reflection' }))
  await a.add(makeEvent(1, { kind: 'rough-day' }))
  expect((await a.all()).map(e => e.at)).toEqual([1, 2])
})

test('two quick adds in one session both land', async () => {
  const store = memoryStore()
  const a = new EventRecord(store, 'a')
  await Promise.all([a.add(makeEvent(1, { kind: 'reflection' })), a.add(makeEvent(2, { kind: 'reflection' }))])
  expect(((await store.get('events:a')) as PaEvent[]).length).toBe(2)
})

test('a fresh record object picks up what its session already wrote', async () => {
  const store = memoryStore()
  await new EventRecord(store, 'a').add(makeEvent(1, { kind: 'reflection' }))
  await new EventRecord(store, 'a').add(makeEvent(2, { kind: 'reflection' }))
  expect(((await store.get('events:a')) as PaEvent[]).length).toBe(2)
})

test('unknown or broken entries are skipped, not fatal', async () => {
  const store = memoryStore()
  await store.set('events:old', [{ v: 99, at: 1, kind: 'mystery' }, 'junk', makeEvent(3, { kind: 'reflection' })])
  expect((await new EventRecord(store, 'a').all()).length).toBe(1)
})

const prompt = (at: number, category: Category = 'planning') => makeEvent(at, { kind: 'prompt', step: 1, category })
// Totals for one category, summed over every week event the store holds.
const weekly = async (store: StoreLike, category: Category) =>
  (await new EventRecord(store, 'me').all()).reduce((sum, e) => sum + (e.kind === 'week' ? e.counts[category] : 0), 0)
const promptsIn = async (store: StoreLike) => (await new EventRecord(store, 'me').all()).filter(e => e.kind === 'prompt').length

test('roll-up turns old prompt events into weekly totals and keeps the rest', async () => {
  const store = memoryStore()
  await store.set('events:old', [prompt(1 * DAY), prompt(1 * DAY + 1, 'code'), makeEvent(1 * DAY + 2, { kind: 'guess', score: 'close' })])
  await rollUp(store, 'me', 40 * DAY)
  const kept = (await store.get('events:old')) as PaEvent[]
  expect(kept.filter(e => e.kind === 'prompt').length).toBe(0)
  expect(kept.filter(e => e.kind === 'guess').length).toBe(1)
  expect(await weekly(store, 'planning')).toBe(1)
  expect(await weekly(store, 'code')).toBe(1)
})

test('a later roll-up of the same key adds to the earlier totals', async () => {
  const store = memoryStore()
  await store.set('events:old', [prompt(1 * DAY)])
  await rollUp(store, 'me', 40 * DAY)
  // The old session wrote one more prompt, then went quiet again.
  await new EventRecord(store, 'old').add(prompt(2 * DAY))
  await rollUp(store, 'me', 40 * DAY)
  expect(await weekly(store, 'planning')).toBe(2)
  expect(await promptsIn(store)).toBe(0)
})

test('a session that wakes after its roll-up does not write old prompts back', async () => {
  const store = memoryStore()
  const sleeper = new EventRecord(store, 'old')
  await sleeper.add(prompt(1 * DAY))
  await rollUp(store, 'me', 40 * DAY)
  await sleeper.add(makeEvent(41 * DAY, { kind: 'reflection' }))
  expect(await promptsIn(store)).toBe(0)
  expect(await weekly(store, 'planning')).toBe(1)
})

test('roll-up leaves recent sessions and its own session alone', async () => {
  const store = memoryStore()
  const recent = [makeEvent(35 * DAY, { kind: 'prompt', step: 1, category: 'code' })]
  await store.set('events:recent', recent)
  await store.set('events:me', [makeEvent(1 * DAY, { kind: 'prompt', step: 1, category: 'code' })])
  await rollUp(store, 'me', 40 * DAY)
  expect(((await store.get('events:recent')) as PaEvent[]).length).toBe(1)
  expect(((await store.get('events:me')) as PaEvent[]).length).toBe(1)
})

test('running roll-up twice gives the same totals', async () => {
  const store = memoryStore()
  await store.set('events:old', [prompt(1 * DAY)])
  await rollUp(store, 'me', 40 * DAY)
  await rollUp(store, 'me', 40 * DAY)
  expect(await weekly(store, 'planning')).toBe(1)
})
