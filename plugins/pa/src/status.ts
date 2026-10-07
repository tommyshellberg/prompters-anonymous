import type { PaEvent } from './events.ts'
import type { StepDef } from './ladder.ts'
import { DAY_MS, WEEK_MS, localDay, startOfLocalDay } from './time.ts'

export type { Measure, StepDef } from './ladder.ts'

export type Progress = { good: number; window: number; need: number }

export type Status = {
  isSetUp: boolean
  why: string
  setupAt: number
  day: number
  step: number
  effectiveStep: number
  isRoughDay: boolean
  roughDaysThisWeek: number
  progress: Progress | null
  isReady: boolean
  canStepDown: boolean
  hasAdmitted: boolean
}

const GOOD = {
  guess: new Set(['close', 'partly']),
  explanation: new Set(['clear', 'rough']),
}

function windowed(events: readonly PaEvent[], measure: 'guess' | 'explanation', def: { window: number; need: number }): Progress {
  const scored = events
    .flatMap(e => (e.kind === measure && e.score !== 'skipped' ? [e.score] : []))
    .slice(-def.window)
  const good = scored.filter(score => GOOD[measure].has(score)).length
  return { good, window: def.window, need: def.need }
}

export function computeStatus(events: readonly PaEvent[], steps: readonly StepDef[], now: number): Status {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const setup = [...sorted].reverse().find(e => e.kind === 'setup')
  const lastStep = [...sorted].reverse().find(e => e.kind === 'step')
  const isSetUp = setup !== undefined
  const step = isSetUp && lastStep?.kind === 'step' ? lastStep.to : 0
  const def = steps.find(s => s.number === step)
  const next = steps.find(s => s.number === step + 1)

  const today = localDay(now)
  const isRoughDay = sorted.some(e => e.kind === 'rough-day' && localDay(e.at) === today)
  const roughDaysThisWeek = sorted.filter(e => e.kind === 'rough-day' && e.at > now - WEEK_MS).length
  const hasAdmitted = sorted.some(e => e.kind === 'admission')

  let progress: Progress | null = null
  let measureMet = false
  if (def?.measure === 'reflection') {
    const count = sorted.filter(e => e.kind === 'reflection').length
    progress = { good: Math.min(count, def.need), window: def.need, need: def.need }
    measureMet = hasAdmitted
  } else if (def?.measure === 'guess' || def?.measure === 'explanation') {
    progress = windowed(sorted, def.measure, def)
    measureMet = progress.good >= progress.need
  }
  const isNextWritten = next !== undefined && next.measure !== 'none'

  const recentDown = sorted.some(e => e.kind === 'step' && e.how === 'down' && e.at > now - WEEK_MS)

  return {
    isSetUp,
    why: setup?.kind === 'setup' ? setup.why : '',
    setupAt: setup?.at ?? 0,
    day: isSetUp ? Math.round((startOfLocalDay(now) - startOfLocalDay(setup.at)) / DAY_MS) + 1 : 0,
    step,
    effectiveStep: isRoughDay ? Math.max(1, step - 1) : step,
    isRoughDay,
    roughDaysThisWeek,
    progress,
    isReady: measureMet && isNextWritten,
    canStepDown: step > 1 && !recentDown,
    hasAdmitted,
  }
}
