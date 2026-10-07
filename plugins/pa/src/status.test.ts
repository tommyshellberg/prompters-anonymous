import { test, expect, describe } from 'claude-code/testing'
import { makeEvent, type PaEvent, type GuessScore, type ExplanationScore } from './events.ts'
import { computeStatus, type StepDef } from './status.ts'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const NOW = at(2026, 10, 20)

const def = (number: number, measure: StepDef['measure'], window = 10, need = 8): StepDef => ({
  number, name: `Step ${number}`, line: '', measure, window, need, instructions: measure === 'none' ? '' : 'do it',
})
const STEPS: StepDef[] = [
  def(1, 'reflection', 3, 3), def(2, 'guess'), def(3, 'explanation'),
  ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => def(n, 'none')),
]

const setUp = (step = 1, when = at(2026, 10, 1)): PaEvent[] => [
  makeEvent(when, { kind: 'setup', why: 'debug without panicking' }),
  makeEvent(when, { kind: 'step', to: 1, how: 'setup' }),
  ...(step > 1 ? [makeEvent(when + 1, { kind: 'step', to: step, how: 'up' })] : []),
]
const guesses = (...scores: GuessScore[]) => scores.map((score, i) => makeEvent(at(2026, 10, 10) + i, { kind: 'guess', score }))
const explanations = (...scores: ExplanationScore[]) => scores.map((score, i) => makeEvent(at(2026, 10, 10) + i, { kind: 'explanation', score }))

describe('setup', () => {
  test('nothing recorded means not set up', () => {
    const s = computeStatus([], STEPS, NOW)
    expect(s.isSetUp).toBe(false)
    expect(s.step).toBe(0)
  })

  test('after setup the user is on step 1, day counts from 1, and the why is kept', () => {
    const s = computeStatus(setUp(1, at(2026, 10, 18)), STEPS, NOW)
    expect(s.isSetUp).toBe(true)
    expect(s.step).toBe(1)
    expect(s.day).toBe(3)
    expect(s.why).toBe('debug without panicking')
  })
})

describe('step 1', () => {
  test('progress counts reflections out of 3, and readiness needs the admission', () => {
    const reflections = [1, 2, 3].map(i => makeEvent(at(2026, 10, 10) + i, { kind: 'reflection' }))
    const before = computeStatus([...setUp(), ...reflections], STEPS, NOW)
    expect(before.progress).toEqual({ good: 3, window: 3, need: 3 })
    expect(before.isReady).toBe(false)

    const admitted = [...setUp(), ...reflections, makeEvent(at(2026, 10, 11), { kind: 'admission', words: 'I hand off all my thinking' })]
    expect(computeStatus(admitted, STEPS, NOW).isReady).toBe(true)
  })
})

describe('step 2', () => {
  test('8 of the last 10 scored guesses close or partly means ready', () => {
    const events = [...setUp(2), ...guesses('off', 'off', 'close', 'close', 'partly', 'close', 'close', 'partly', 'close', 'close')]
    const s = computeStatus(events, STEPS, NOW)
    expect(s.progress).toEqual({ good: 8, window: 10, need: 8 })
    expect(s.isReady).toBe(true)
  })

  test('7 of 10 is not ready', () => {
    const events = [...setUp(2), ...guesses('off', 'off', 'off', 'close', 'partly', 'close', 'close', 'partly', 'close', 'close')]
    expect(computeStatus(events, STEPS, NOW).isReady).toBe(false)
  })

  test('skipped guesses do not count either way', () => {
    const events = [...setUp(2), ...guesses('close', 'close', 'close', 'close', 'close', 'close', 'close', 'close', 'skipped', 'skipped', 'skipped')]
    const s = computeStatus(events, STEPS, NOW)
    expect(s.progress).toEqual({ good: 8, window: 10, need: 8 })
  })

  test('only the last 10 scored guesses count', () => {
    // The old guesses are all good, so counting them would change the answer.
    const old = guesses('close', 'close', 'close', 'close', 'close')
    const recent = guesses('off', 'off', 'off', 'off', 'close', 'close', 'close', 'close', 'close', 'close')
      .map(e => ({ ...e, at: e.at + 1000 }))
    expect(computeStatus([...setUp(2), ...old, ...recent], STEPS, NOW).progress?.good).toBe(6)
  })
})

describe('step 3', () => {
  test('counts clear and rough explanations', () => {
    const events = [...setUp(3), ...explanations('clear', 'rough', 'missed')]
    expect(computeStatus(events, STEPS, NOW).progress).toEqual({ good: 2, window: 10, need: 8 })
  })

  test('is never ready while step 4 is unwritten', () => {
    const events = [...setUp(3), ...explanations(...Array<ExplanationScore>(10).fill('clear'))]
    expect(computeStatus(events, STEPS, NOW).isReady).toBe(false)
  })
})

describe('rough days', () => {
  test('a rough day today drops the effective step by one', () => {
    const events = [...setUp(3), makeEvent(at(2026, 10, 20, 9), { kind: 'rough-day' })]
    const s = computeStatus(events, STEPS, NOW)
    expect(s.isRoughDay).toBe(true)
    expect(s.effectiveStep).toBe(2)
    expect(s.step).toBe(3)
  })

  test('the rough day ends at local midnight', () => {
    const events = [...setUp(3), makeEvent(at(2026, 10, 19, 23), { kind: 'rough-day' })]
    const s = computeStatus(events, STEPS, NOW)
    expect(s.isRoughDay).toBe(false)
    expect(s.effectiveStep).toBe(3)
  })

  test('counts rough days in the last 7 days', () => {
    // NOW is 20 Oct at 12:00, so the window starts 13 Oct at 12:00. The 13 Oct 08:00 day falls just outside it.
    const days = [13, 18, 19, 20].map(d => makeEvent(at(2026, 10, d, 8), { kind: 'rough-day' }))
    expect(computeStatus([...setUp(3), ...days], STEPS, NOW).roughDaysThisWeek).toBe(3)
  })
})

describe('stepping down', () => {
  test('not allowed on step 1', () => {
    expect(computeStatus(setUp(1), STEPS, NOW).canStepDown).toBe(false)
  })

  test('allowed on step 3 with no recent step down', () => {
    expect(computeStatus(setUp(3), STEPS, NOW).canStepDown).toBe(true)
  })

  test('only once a week', () => {
    const events = [...setUp(3), makeEvent(at(2026, 10, 15), { kind: 'step', to: 2, how: 'down' })]
    expect(computeStatus(events, STEPS, NOW).canStepDown).toBe(false)
    const later = [...setUp(3), makeEvent(at(2026, 10, 12), { kind: 'step', to: 2, how: 'down' })]
    expect(computeStatus(later, STEPS, NOW).canStepDown).toBe(true)
  })
})
