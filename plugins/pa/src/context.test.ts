import { test, expect, describe } from 'claude-code/testing'
import { makeEvent } from './events.ts'
import type { Status } from './status.ts'
import type { StepDef } from './ladder.ts'
import { buildContext, shouldReflect, REFLECT_NOW, ASK_ADMISSION, EXPLAIN_FIRST } from './context.ts'

const def = (number: number, instructions: string): StepDef => ({
  number, name: `Name ${number}`, line: '', measure: 'guess', window: 10, need: 8, instructions,
})
const STEPS = [def(1, 'ONE'), def(2, 'TWO'), def(3, 'THREE'), def(4, '')]

const status = (over: Partial<Status>): Status => ({
  isSetUp: true, why: '', setupAt: 0, day: 1, step: 1, effectiveStep: 1, isRoughDay: false,
  roughDaysThisWeek: 0, progress: null, isReady: false, canStepDown: false, hasAdmitted: false, ...over,
})
const input = (over: Partial<Parameters<typeof buildContext>[0]>) => ({
  status: status({}), steps: STEPS, reflectNow: false, mentionReady: false, explainPending: false, reflections: 0, ...over,
})

describe('buildContext', () => {
  test('nothing before setup', () => {
    expect(buildContext(input({ status: status({ isSetUp: false }) }))).toEqual([])
  })

  test('step 1 gets step 1 only', () => {
    const text = buildContext(input({})).join('\n')
    expect(text).toContain('ONE')
    expect(text).not.toContain('TWO')
  })

  test('steps stack from 2 up, leaving step 1 out', () => {
    const text = buildContext(input({ status: status({ step: 3, effectiveStep: 3 }) })).join('\n')
    expect(text).toContain('TWO')
    expect(text).toContain('THREE')
    expect(text).not.toContain('ONE')
  })

  test('a rough day uses the effective step', () => {
    const text = buildContext(input({ status: status({ step: 3, effectiveStep: 2, isRoughDay: true }) })).join('\n')
    expect(text).toContain('TWO')
    expect(text).not.toContain('THREE')
  })

  test('reflect now, on step 1', () => {
    expect(buildContext(input({ reflectNow: true })).join('\n')).toContain(REFLECT_NOW)
  })

  test('asks for the admission after 3 reflections, until it is given', () => {
    expect(buildContext(input({ reflections: 3 })).join('\n')).toContain(ASK_ADMISSION)
    expect(buildContext(input({ reflections: 2 })).join('\n')).not.toContain(ASK_ADMISSION)
    expect(buildContext(input({ reflections: 3, status: status({ hasAdmitted: true }) })).join('\n')).not.toContain(ASK_ADMISSION)
  })

  test('mentions readiness with the next step name', () => {
    const text = buildContext(input({ mentionReady: true, status: status({ step: 2, effectiveStep: 2 }) })).join('\n')
    expect(text).toContain('step 3')
    expect(text).toContain('Name 3')
    expect(text).toContain('/pa up')
  })

  test('asks for a pending explanation first', () => {
    expect(buildContext(input({ explainPending: true, status: status({ step: 3, effectiveStep: 3 }) })).join('\n')).toContain(EXPLAIN_FIRST)
  })
})

describe('shouldReflect', () => {
  const prompts = (n: number) => Array.from({ length: n }, (_, i) => makeEvent(i + 10, { kind: 'prompt', step: 1, category: 'code' }))

  test('after 10 prompts on step 1', () => {
    expect(shouldReflect(prompts(10), 1, false)).toBe(true)
    expect(shouldReflect(prompts(9), 1, false)).toBe(false)
  })

  test('counts only prompts since the last reflection', () => {
    const events = [...prompts(15), makeEvent(100, { kind: 'reflection' }), ...prompts(3).map(e => ({ ...e, at: e.at + 200 }))]
    expect(shouldReflect(events, 1, false)).toBe(false)
  })

  test('at most once per session', () => {
    expect(shouldReflect(prompts(30), 1, true)).toBe(false)
  })

  test('never off step 1', () => {
    expect(shouldReflect(prompts(30), 2, false)).toBe(false)
  })
})
