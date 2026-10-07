import type { PaEvent } from './events.ts'
import type { StepDef } from './ladder.ts'
import type { Status } from './status.ts'

export const REFLECT_EVERY = 10

export const REFLECT_NOW =
  'Reflect now: after you answer, add one or two gentle sentences noticing what kind of thinking the user just handed to you (planning, debugging, writing code, or understanding). Be warm and never shaming. Close with encouragement, for example: "That\'s OK. We\'ll take it back in small steps."'

export const ASK_ADMISSION =
  'At a natural point in this reply, ask the user if they are ready to admit, in their own words, how much of their thinking they have been handing to AI. If they say it, call the mcp__pa__record_admission tool with their exact words, then congratulate them on finishing step 1.'

export const EXPLAIN_FIRST =
  'Before anything else: you changed code earlier and the user has not explained it yet. Ask them, in one short line, to explain in a sentence or two what changed and why. Then score it with mcp__pa__record_explanation.'

export type ContextInput = {
  status: Status
  steps: readonly StepDef[]
  reflectNow: boolean
  mentionReady: boolean
  explainPending: boolean
  reflections: number
}

export function buildContext(input: ContextInput): string[] {
  const { status, steps } = input
  if (!status.isSetUp) return []
  const current = steps.find(s => s.number === status.effectiveStep)
  const parts: string[] = [
    `Prompters Anonymous: the user is on step ${status.step}${status.isRoughDay ? ` (a rough day, so working at step ${status.effectiveStep} until tomorrow)` : ''}: ${current?.name ?? ''}.`,
  ]

  if (status.effectiveStep === 1) {
    const one = steps.find(s => s.number === 1)
    if (one?.instructions) parts.push(one.instructions)
    if (input.reflectNow) parts.push(REFLECT_NOW)
    if (input.reflections >= 3 && !status.hasAdmitted) parts.push(ASK_ADMISSION)
  } else {
    for (const s of steps) {
      if (s.number >= 2 && s.number <= status.effectiveStep && s.instructions) parts.push(s.instructions)
    }
  }

  if (input.mentionReady) {
    const next = steps.find(s => s.number === status.step + 1)
    parts.push(
      `The user is ready for step ${status.step + 1} (${next?.name ?? ''}). Tell them so warmly in one line, and say they can run /pa up whenever they want. Moving up is their choice.`,
    )
  }
  if (input.explainPending) parts.push(EXPLAIN_FIRST)

  return [parts.join('\n\n')]
}

export function promptsSinceReflection(events: readonly PaEvent[]): number {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const last = sorted.reduce((found, e, i) => (e.kind === 'reflection' ? i : found), -1)
  return sorted.slice(last + 1).filter(e => e.kind === 'prompt').length
}

export function shouldReflect(events: readonly PaEvent[], effectiveStep: number, reflectedThisSession: boolean): boolean {
  return effectiveStep === 1 && !reflectedThisSession && promptsSinceReflection(events) >= REFLECT_EVERY
}
