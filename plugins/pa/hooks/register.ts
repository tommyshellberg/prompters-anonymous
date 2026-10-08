import type { Caught, EngineInterface as Engine, Register } from 'claude-code'
import { categorize } from '../src/categorize.ts'
import { buildContext, shouldReflect } from '../src/context.ts'
import { EXPLANATION_SCORES, GUESS_SCORES, makeEvent, type EventBody, type PaEvent } from '../src/events.ts'
import { loadLadder, type StepDef } from '../src/ladder.ts'
import { EventRecord, rollUp, type StoreLike } from '../src/record.ts'
import { computeStatus, type Status } from '../src/status.ts'
import { NEEDS_A_LOOK_LINE, meetingLine, report, stepLine } from '../src/text.ts'

/**
 * The Claude Code calls the helpers below need. The mod loader refuses `$` as a
 * function argument: inside a hook, `$` is only ever spelled `$.noun.method(...)`.
 * So each hook builds an `Io` inline, and the helpers take that instead of `$`.
 */
type Io = {
  store: StoreLike
  read: (path: string) => Promise<string>
  root: string
  sessionId: () => Promise<string>
  now: () => Promise<number>
  /** Redraws the band. */
  redraw: () => void
  /** Writes one line to the debug log. */
  log: (text: string) => void
  /** Submits a plugin prompt. It runs once the session is idle. */
  submit: (text: string) => Promise<unknown>
  /** Runs `run` once, `ms` milliseconds later, on the engine's clock. */
  after: (ms: number, run: () => void) => void
}

type Ctx = { steps: StepDef[]; record: EventRecord }

let ready: Promise<Ctx> | null = null
let lastLine = ''
let reflectedThisSession = false
let readyMentioned = false
let admissionAsked = false
let explainPending = false

/** Loads the ladder and opens the record on first use, from whichever hook runs first. */
function ctx(io: Io): Promise<Ctx> {
  ready ??= (async () => {
    const steps = await loadLadder(io.read, io.root)
    return { steps, record: new EventRecord(io.store, await io.sessionId()) }
  })()
  ready.catch(() => {
    ready = null
  })
  return ready
}

async function snapshot(io: Io): Promise<{ c: Ctx; events: PaEvent[]; status: Status; now: number }> {
  const c = await ctx(io)
  const now = await io.now()
  const events = await c.record.all()
  const status = computeStatus(events, c.steps, now)
  lastLine = stepLine(status, c.steps)
  return { c, events, status, now }
}

async function addEvent(io: Io, body: EventBody): Promise<PaEvent> {
  const c = await ctx(io)
  const event = makeEvent(await io.now(), body)
  await c.record.add(event)
  await snapshot(io)
  io.redraw()
  return event
}

/** The one error path. Sets the "needs a look" line and returns the debug log text. */
function failed(where: string, error: unknown): string {
  lastLine = NEEDS_A_LOOK_LINE
  return `pa: ${where} failed: ${error instanceof Error ? error.message : String(error)}`
}

/** `failed`, plus the log line and the redraw, for code that has an `Io`. */
function fail(io: Io, where: string, error: unknown): void {
  io.log(failed(where, error))
  io.redraw()
}

/**
 * How long `ask` waits before it submits. A prompt submitted from inside a
 * command.run hook is refused (the hook holds the turn), so `ask` submits a moment later.
 */
const ASK_DELAY_MS = 50

/** Submits a plugin prompt a moment later, without waiting for it. A failure goes to `fail`. */
function ask(io: Io, text: string): void {
  io.after(ASK_DELAY_MS, () => {
    io.submit(text).catch(error => fail(io, 'prompt.submit', error))
  })
}

// The shared .catch handlers. Every hook below ends with one of them, by name:
// the loader takes only a function literal or a plain name in `.catch(...)`.
// `next.event` names the event, so one handler serves every hook.
type Handled<E, R> = ((e: E) => R) & Caught & { readonly event: string }
const reason = (next: Caught) => next.error.message ?? next.error.kind

/** Logs the failure and lets the event go on as if the plugin were not there. */
function letThrough<E, R>($: Engine, e: E, next: Handled<E, R>): R {
  // On a re-entry the handler's own `$` calls reject, so it only passes the event on.
  if (next.error.kind !== 're-entry') {
    $.ui.log(failed(next.event, reason(next)), { to: 'debug' })
    $.ui.invalidate('ui.render')
  }
  return next(e)
}

const TOOL_PROBLEM = 'Prompters Anonymous hit a problem and saved nothing. Tell the user kindly, and suggest they run /pa to check.'

/** Logs the failure and answers a recording tool with a kind message. */
function toolFailed<E extends { readonly tool: string }>($: Engine, e: E, next: Caught) {
  if (next.error.kind !== 're-entry') {
    $.ui.log(failed(e.tool, reason(next)), { to: 'debug' })
    $.ui.invalidate('ui.render')
  }
  return { result: TOOL_PROBLEM }
}

/** Logs the failure and answers /pa with a kind message. */
function commandFailed($: Engine, _e: unknown, next: Caught) {
  if (next.error.kind !== 're-entry') {
    $.ui.log(failed('/pa', reason(next)), { to: 'debug' })
    $.ui.invalidate('ui.render')
  }
  return { text: 'Prompters Anonymous hit a problem. Details are in the debug log (claude --debug).' }
}

export const SETUP_PROMPT = [
  'Run the Prompters Anonymous setup with the user, warmly and briefly:',
  '1. Welcome them in one line. Everyone starts at step 1, and if they installed this, there is a reason.',
  '2. Ask why they installed it, in their own words. Examples: "I want to pass a system design interview", "I want to debug without panicking". Wait for the answer.',
  '3. Explain the log in two plain sentences: it saves the time, their step, and a rough category for each prompt. It never saves prompt text, and it stays on their machine.',
  '4. Call the mcp__pa__record_setup tool with their why, word for word.',
  '5. Tell them step 1 asks nothing of them except to notice. The line above the prompt shows their progress.',
].join('\n')

const tapePrompt = (status: Status, steps: readonly StepDef[]) =>
  [
    `The user asked to step down from step ${status.step} to step ${status.step - 1} of Prompters Anonymous.`,
    'Play the tape to the end with them, gently and briefly: ask what next week looks like if they step down, then next month, then six months from now.',
    `Remind them why they started, in their words: "${status.why}".`,
    'Then let them decide. Both choices are fine; say so. If they still want to step down, call confirm_step_down. If not, encourage them.',
  ].join('\n')

const tooManyRoughDaysPrompt = (status: Status) =>
  [
    `The user has taken ${status.roughDaysThisWeek} rough days this week in Prompters Anonymous.`,
    `Gently, with no judgment, play the tape with them: what does the next month look like at this pace? Remind them of their why: "${status.why}".`,
    'Then ask whether stepping down one step for a while might fit better. It is a question, not a rule. If they say yes, call confirm_step_down.',
  ].join('\n')

/** `/pa <word>`: the report, setup, and (from Task 12) up, down and rough-day. */
async function paCommand(io: Io, args: string): Promise<{ text: string }> {
  const word = args.trim().toLowerCase()
  const { c, events, status, now } = await snapshot(io)
  if (word === 'setup') {
    if (status.isSetUp) return { text: `You're already set up.\n\n${report(status, c.steps, events, now)}` }
    ask(io, SETUP_PROMPT)
    return { text: 'Welcome to Prompters Anonymous. 💛' }
  }
  if (word === '' || word === 'step') return { text: report(status, c.steps, events, now) }
  if (word === 'up') {
    if (!status.isReady) {
      const p = status.progress
      return { text: `Not yet. ${stepLine(status, c.steps)}${p ? `\nYou need ${p.need} of the last ${p.window}.` : ''}\nYou're doing the work. Keep going. 💛` }
    }
    await addEvent(io, { kind: 'step', to: status.step + 1, how: 'up' })
    const next = c.steps.find(s => s.number === status.step + 1)
    return { text: `🪙 Step ${status.step} coin earned.\n\nWelcome to step ${status.step + 1}: ${next?.name}.\n${next?.line ?? ''}` }
  }
  if (word === 'down') {
    if (status.step <= 1) return { text: "You're on step 1. There's nowhere lower to go, and nothing to prove. 💛" }
    if (!status.canStepDown) return { text: "You've already stepped down this week. Give this step a few more days. If today is just hard, try /pa rough-day." }
    ask(io, tapePrompt(status, c.steps))
    return { text: "Let's think this through together first." }
  }
  if (word === 'rough-day') {
    if (status.effectiveStep === 1 && !status.isRoughDay) return { text: 'Step 1 is already gentle. Take care of yourself today. 💛' }
    if (status.isRoughDay) return { text: "You're already on a rough-day pass. It ends at midnight." }
    await addEvent(io, { kind: 'rough-day' })
    const after = (await snapshot(io)).status
    if (after.roughDaysThisWeek >= 3) ask(io, tooManyRoughDaysPrompt(after))
    return { text: `Rough day. You're at step ${after.effectiveStep} until midnight.\n\nRemember why you started: "${after.why}"\nYou got this. 💛` }
  }
  return { text: `Unknown word "${word}". Try /pa, /pa setup, /pa up, /pa down, or /pa rough-day.` }
}

async function recordSetup(io: Io, input: object): Promise<string> {
  const { status } = await snapshot(io)
  if (status.isSetUp) return 'The user is already set up. Nothing was changed.'
  const why = String((input as { why?: unknown }).why ?? '').trim()
  if (why === '') return 'No why was given. Ask the user for it, then call again.'
  await addEvent(io, { kind: 'setup', why })
  await addEvent(io, { kind: 'step', to: 1, how: 'setup' })
  return 'Saved. The user is on step 1: Admit it.'
}

const SCORES = { guess: GUESS_SCORES, explanation: EXPLANATION_SCORES } as const
const orList = (words: readonly string[]) => `${words.slice(0, -1).join(', ')}, or ${words[words.length - 1]}`

/** A recording tool that takes one score from a fixed list. */
async function recordScore(io: Io, kind: keyof typeof SCORES, input: object): Promise<string> {
  const scores: readonly string[] = SCORES[kind]
  const score = (input as { score?: unknown }).score
  if (typeof score !== 'string' || !scores.includes(score)) return `Score must be one of ${orList(scores)}.`
  // Safe: `score` was just checked against this kind's own list.
  await addEvent(io, { kind, score } as EventBody)
  return `Recorded: ${score}.`
}

async function recordAdmission(io: Io, input: object): Promise<string> {
  const words = String((input as { words?: unknown }).words ?? '').trim()
  if (words === '') return 'No words given. Ask the user to say it in their own words.'
  await addEvent(io, { kind: 'admission', words })
  return 'Saved. Step 1 is complete. The user can run /pa up when they are ready.'
}

async function confirmStepDown(io: Io): Promise<string> {
  const { status } = await snapshot(io)
  if (status.step <= 1) return 'The user is on step 1. Nothing to step down from.'
  if (!status.canStepDown) return 'Not allowed: the user already stepped down this week.'
  await addEvent(io, { kind: 'step', to: status.step - 1, how: 'down' })
  return `Done. The user is on step ${status.step - 1}. Their progress on step ${status.step} is saved for when they return.`
}

/** One hook answers every recording tool. Each task adds its tool here and to the hook's matcher. */
async function paTool(io: Io, e: { readonly tool: string }): Promise<string> {
  switch (e.tool) {
    case 'mcp__pa__record_setup':
      return recordSetup(io, e)
    case 'mcp__pa__record_guess':
      return recordScore(io, 'guess', e)
    case 'mcp__pa__record_admission':
      return recordAdmission(io, e)
    case 'mcp__pa__record_explanation':
      return recordScore(io, 'explanation', e)
    case 'mcp__pa__confirm_step_down':
      return confirmStepDown(io)
    default:
      return `Unknown Prompters Anonymous tool: ${e.tool}.`
  }
}

const EXPLAIN_REQUEST =
  'Step 3 check-in: you just changed code. Ask the user, in one short friendly line, to explain in a sentence or two what changed and why. Wait for their answer, then follow the step 3 instructions.'

async function welcome(io: Io): Promise<string> {
  const { c, status } = await snapshot(io)
  return status.isSetUp ? meetingLine(status, c.steps) : 'Prompters Anonymous is installed. Run /pa setup when you are ready.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Registrations first, before anything that can fail, so /pa works even when a step file is broken.
    await $.command.register({ name: 'pa', description: 'Prompters Anonymous: your step and progress', argumentHint: '[setup | up | down | rough-day]' })
    await $.tool.register({
      name: 'record_setup',
      description: "Prompters Anonymous: save the user's reason for starting, in their own words, and start step 1. Call once, after the user tells you their why.",
      inputSchema: { type: 'object', properties: { why: { type: 'string' } }, required: ['why'] },
    })
    await $.tool.register({
      name: 'record_guess',
      description: `Prompters Anonymous: record how close the user's guess was, after you answer. Scores: ${GUESS_SCORES.join(', ')}.`,
      inputSchema: { type: 'object', properties: { score: { type: 'string', enum: [...GUESS_SCORES] } }, required: ['score'] },
    })
    await $.tool.register({
      name: 'record_admission',
      description: "Prompters Anonymous: save the user's step 1 admission, in their exact words.",
      inputSchema: { type: 'object', properties: { words: { type: 'string' } }, required: ['words'] },
    })
    await $.tool.register({
      name: 'record_explanation',
      description: `Prompters Anonymous: record how well the user explained your code changes. Scores: ${EXPLANATION_SCORES.join(', ')}.`,
      inputSchema: { type: 'object', properties: { score: { type: 'string', enum: [...EXPLANATION_SCORES] } }, required: ['score'] },
    })
    await $.tool.register({
      name: 'confirm_step_down',
      description: 'Prompters Anonymous: step the user down one step. Call only after playing the tape to the end with them and they still want it.',
      inputSchema: { type: 'object', properties: {} },
    })
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
      after: (ms, run) => void $.clock.after(ms, run),
    }
    await ctx(io)
    await rollUp(io.store, await io.sessionId(), await io.now())
    $.ui.log(await welcome(io))
    return next(e)
  }).catch(letThrough)

  // /clear, /resume and /branch don't raise session.start again.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
      after: (ms, run) => void $.clock.after(ms, run),
    }
    reflectedThisSession = false
    readyMentioned = false
    admissionAsked = false
    $.ui.log(await welcome(io))
    return next(e)
  }).catch(letThrough)

  // Not letThrough: it redraws the band, and a band that fails on every draw would loop.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
      after: (ms, run) => void $.clock.after(ms, run),
    }
    if (lastLine === '') await snapshot(io)
    const { Text } = $.ui.resolve(e)
    return Text({ dimColor: true, wrap: 'truncate-end', children: [lastLine] })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pa' }, async ($, e) => {
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
      after: (ms, run) => void $.clock.after(ms, run),
    }
    return paCommand(io, e.args)
  }).catch(commandFailed)

  on('tool.call', { tool: ['mcp__pa__record_setup', 'mcp__pa__record_guess', 'mcp__pa__record_admission', 'mcp__pa__record_explanation', 'mcp__pa__confirm_step_down'] }, async ($, e) => {
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
      after: (ms, run) => void $.clock.after(ms, run),
    }
    return { result: await paTool(io, e) }
  }).catch(toolFailed)

  on('prompt.submit', async ($, e, next) => {
    // Our own prompts (setup, explain-it-back, play-the-tape) are not the user's asks.
    if (e.origin.kind === 'plugin' && e.origin.name === 'pa') return next(e)
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
      after: (ms, run) => void $.clock.after(ms, run),
    }
    const { c, events, status } = await snapshot(io)
    if (!status.isSetUp) return next(e)
    // Count this prompt too, so the tenth prompt is the one that reflects.
    const prompt = await addEvent(io, { kind: 'prompt', step: status.effectiveStep, category: categorize(e.text) })
    const reflectNow = shouldReflect([...events, prompt], status.effectiveStep, reflectedThisSession)
    if (reflectNow) {
      reflectedThisSession = true
      await addEvent(io, { kind: 'reflection' })
    }
    const mentionReady = status.isReady && !readyMentioned
    if (mentionReady) readyMentioned = true
    // buildContext asks for the admission whenever it sees 3 or more reflections. Show it 0 after the first ask, so the user is asked once per session.
    const lifetimeReflections = events.filter(ev => ev.kind === 'reflection').length + (reflectNow ? 1 : 0)
    const askAdmission = lifetimeReflections >= 3 && !status.hasAdmitted && status.effectiveStep === 1 && !admissionAsked
    if (askAdmission) admissionAsked = true
    const reflections = askAdmission ? lifetimeReflections : 0
    const added = buildContext({ status, steps: c.steps, reflectNow, mentionReady, explainPending, reflections })
    explainPending = false
    return next({ ...e, context: [...(e.context ?? []), ...added] })
  }).catch(letThrough)

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const io: Io = {
        store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
        read: path => $.fs.read(path),
        root: $.plugin.root,
        sessionId: () => $.session.id(),
        now: () => $.clock.now(),
        redraw: () => $.ui.invalidate('ui.render'),
        log: text => $.ui.log(text, { to: 'debug' }),
        submit: text => $.prompt.submit({ text }),
        after: (ms, run) => void $.clock.after(ms, run),
      }
      const { status } = await snapshot(io)
      if (status.effectiveStep >= 3) explainPending = true
    }
    return ran
  }).catch(letThrough)

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer' && explainPending) {
      explainPending = false
      $.prompt.submit({ text: EXPLAIN_REQUEST }).catch(() => {
        explainPending = true
      })
    }
    return next(e)
  }).catch(letThrough)
}
