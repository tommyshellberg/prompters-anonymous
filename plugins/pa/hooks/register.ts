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
}

type Ctx = { steps: StepDef[]; record: EventRecord }

let ready: Promise<Ctx> | null = null
let lastLine = ''
let reflectedThisSession = false
let readyMentioned = false
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

/** Submits a plugin prompt without waiting for it. A failure goes to `fail`. */
function ask(io: Io, text: string): void {
  io.submit(text).catch(error => fail(io, 'prompt.submit', error))
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

/** One hook answers every recording tool. Each task adds its tool here and to the hook's matcher. */
async function paTool(io: Io, e: { readonly tool: string }): Promise<string> {
  switch (e.tool) {
    case 'mcp__pa__record_setup':
      return recordSetup(io, e)
    default:
      return `Unknown Prompters Anonymous tool: ${e.tool}.`
  }
}

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
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
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
    }
    reflectedThisSession = false
    readyMentioned = false
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
    }
    return paCommand(io, e.args)
  }).catch(commandFailed)

  on('tool.call', { tool: ['mcp__pa__record_setup'] }, async ($, e) => {
    const io: Io = {
      store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), keys: () => $.store.keys() },
      read: path => $.fs.read(path),
      root: $.plugin.root,
      sessionId: () => $.session.id(),
      now: () => $.clock.now(),
      redraw: () => $.ui.invalidate('ui.render'),
      log: text => $.ui.log(text, { to: 'debug' }),
      submit: text => $.prompt.submit({ text }),
    }
    return { result: await paTool(io, e) }
  }).catch(toolFailed)
}
