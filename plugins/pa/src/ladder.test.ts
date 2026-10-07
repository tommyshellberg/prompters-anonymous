import { test, expect } from 'claude-code/testing'
import { parseStep, loadLadder, STEP_FILES } from './ladder.ts'

const FILE = `---
number: 2
name: Guess first
line: We came to believe a guess is better than nothing.
measure: guess
window: 10
need: 8
---
Ask for a guess first.
`

test('parses front matter and body', () => {
  expect(parseStep(FILE)).toEqual({
    number: 2, name: 'Guess first', line: 'We came to believe a guess is better than nothing.',
    measure: 'guess', window: 10, need: 8, instructions: 'Ask for a guess first.',
  })
})

test('a missing field is a loud error naming the field', () => {
  expect(() => parseStep(FILE.replace('need: 8\n', ''))).toThrow('need')
})

test('an unknown measure is a loud error', () => {
  expect(() => parseStep(FILE.replace('measure: guess', 'measure: vibes'))).toThrow('measure')
})

// A test has no file access, so loadLadder reads from a map in memory here.
// Task 8's wiring tests read the real step files, through the plugin.
const ROOT = '/plugin'
const stepFile = (n: number) => FILE.replace('number: 2', `number: ${n}`)
const files = (): Map<string, string> => new Map(STEP_FILES.map((file, i) => [`${ROOT}/${file}`, stepFile(i + 1)]))
const reader = (map: Map<string, string>) => async (path: string) => {
  const text = map.get(path)
  if (text === undefined) throw new Error('no such file')
  return text
}

test('loadLadder reads steps/01.md to steps/12.md under the root, in order', async () => {
  const steps = await loadLadder(reader(files()), ROOT)
  expect(STEP_FILES[0]).toBe('steps/01.md')
  expect(STEP_FILES[11]).toBe('steps/12.md')
  expect(steps.map(s => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
})

test('a broken step file fails loudly, naming the file and the field', async () => {
  const map = files()
  map.set(`${ROOT}/steps/07.md`, stepFile(7).replace('need: 8\n', ''))
  await expect(loadLadder(reader(map), ROOT)).rejects.toThrow('steps/07.md: step file: missing field "need"')
})

test('a missing step file fails loudly, naming the file', async () => {
  const map = files()
  map.delete(`${ROOT}/steps/12.md`)
  await expect(loadLadder(reader(map), ROOT)).rejects.toThrow('steps/12.md')
})
