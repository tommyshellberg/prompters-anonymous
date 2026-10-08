import { test, expect, mock, type Engine, type MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { SETUP_PROMPT } from './register.ts'
import { makeEvent, type PaEvent } from '../src/events.ts'
import { EXPLAIN_FIRST } from '../src/context.ts'

/** A stand-in for one step file, in the same format as steps/NN.md. */
const stepFile = (number: number, name: string, measure: string, window: number, need: number, body = '') =>
  `---\nnumber: ${number}\nname: ${name}\nline: The line for ${name}.\nmeasure: ${measure}\nwindow: ${window}\nneed: ${need}\n---\n${body}\n`

/**
 * The ladder the plugin reads in tests. The kit gives a plugin no file access
 * (NOTES.md, item 3), so `seed` answers the plugin's `fs.read` from this map.
 * Steps 1 to 3 copy the names and numbers of the real files. Steps 4 to 12 are unwritten.
 */
const LADDER: ReadonlyMap<string, string> = new Map([
  ['steps/01.md', stepFile(1, 'Admit it', 'reflection', 3, 3, 'Notice what you hand to AI.')],
  ['steps/02.md', stepFile(2, 'Guess first', 'guess', 10, 8, 'Ask the user for a guess before you answer.')],
  ['steps/03.md', stepFile(3, 'Explain it back', 'explanation', 10, 8, 'Ask the user to explain your changes.')],
  ...Array.from({ length: 9 }, (_, i) => {
    const n = i + 4
    return [`steps/${String(n).padStart(2, '0')}.md`, stepFile(n, `Step ${n}`, 'none', 0, 0)] as const
  }),
])

/**
 * Stands in for the engine beneath the plugin, set up on `step` (0 means not set up).
 * It answers the plugin's `$.store` from a map the test can read, its session id,
 * its clock (a mock clock fixed at now, which the test can move or settle), and
 * its `fs.read` from `ladder`. A test's own `$` has none of these, so the test
 * hooks the calls beneath the plugin instead. Call it before the first call on `$`.
 */
const seed = (on: On, step: number, extra: PaEvent[] = [], ladder = LADDER): { store: Map<string, unknown>; clock: MockClock } => {
  const now = Date.now()
  const clock = mock.clock(on, { now })
  const data = new Map<string, unknown>()
  if (step > 0) {
    data.set('events:seed', [
      makeEvent(now - 1000, { kind: 'setup', why: 'debug without panicking' }),
      makeEvent(now - 1000, { kind: 'step', to: 1, how: 'setup' }),
      ...(step > 1 ? [makeEvent(now - 900, { kind: 'step', to: step, how: 'up' })] : []),
      ...extra,
    ])
  }
  // Copy on write, as the real store does: a later change to the plugin's array must not leak in.
  on('store.get', async (_$, e) => ({ value: data.get(e.key) }))
  on('store.set', async (_$, e) => (data.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', async (_$, e) => (data.delete(e.key), { value: undefined }))
  on('store.keys', async () => ({ value: [...data.keys()] }))
  on('session.id', async () => ({ value: 'this-session' }))
  on('fs.read', async (_$, e) => {
    const text = [...ladder].find(([file]) => e.path.endsWith(`/${file}`))?.[1]
    if (text === undefined) throw new Error(`no such file: ${e.path}`)
    return { value: text }
  })
  return { store: data, clock }
}

// What the user typing does: a command or prompt from the composer, the prompt box.
const TYPED = { kind: 'composer' } as const
/** Runs `/pa <args>` as if the user typed it. */
const pa = ($: Engine, args = '') =>
  $.command.run({ command: 'pa', args, origin: TYPED, presentation: { isFullscreen: false, columns: 80 } })
/** Submits a prompt as if the user typed it. */
const userPrompt = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: TYPED })

/**
 * Starts the session the way Claude Code does. The kit never raises `session.start`
 * on its own, so a test that needs it calls this before any other call on `$`.
 * The hook beneath stands for the engine.
 */
const startSession = async ($: Engine, on: On) => {
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

/** Draws the band the way the terminal does and returns its text. */
const bandText = async ($: Engine): Promise<string> => {
  const band = await $.ui.mount({
    plugin: 'pa', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
  })
  return (await band.find({ type: 'Text' }))?.text ?? ''
}

test('the band shows the step line once set up', async ($, on) => {
  seed(on, 2)
  expect(await bandText($)).toContain('Step 2 · Guess first')
})

test('the band invites setup before it', async ($, on) => {
  seed(on, 0)
  expect(await bandText($)).toContain('/pa setup')
})

test('a full bar on step 3 does not say ready while step 4 is unwritten', async ($, on) => {
  const explanations = Array.from({ length: 10 }, (_, i) => makeEvent(Date.now() - 800 + i, { kind: 'explanation', score: 'clear' }))
  seed(on, 3, explanations)
  // A full bar but no "ready for step 4": step 3 measures explanations out of 10, and step 4 is unwritten.
  expect(await bandText($)).toBe('Step 3 · Explain it back · ▓▓▓▓▓▓▓▓▓▓ 10/10')
})

test('step 1 starts with an empty bar out of 3', async ($, on) => {
  seed(on, 1)
  expect(await bandText($)).toBe('Step 1 · Admit it · ░░░░░░░░░░ 0/3')
})

// Every hook loads all 12 step files first. One missing file fails session.start,
// and its .catch handler turns the band into the "needs a look" line.
test('a missing step file shows the needs-a-look line', async ($, on) => {
  const broken = new Map(LADDER)
  broken.delete('steps/07.md')
  seed(on, 2, [], broken)
  await startSession($, on)
  expect(await bandText($)).toBe('Prompters Anon needs a look, run /pa')
})

test('/pa shows the report with the why first', async ($, on) => {
  seed(on, 2)
  const { text } = await pa($)
  expect(String(text).split('\n')[0]).toContain('debug without panicking')
})

test('record_setup starts step 1 and keeps the why', async ($, on) => {
  seed(on, 0)
  await $.tool.call({ tool: 'mcp__pa__record_setup', why: 'pass a system design interview' })
  const { text } = await pa($)
  expect(String(text)).toContain('pass a system design interview')
  expect(String(text)).toContain('Step 1 · Admit it')
})

test('record_setup twice does not reset progress', async ($, on) => {
  seed(on, 2)
  const result = await $.tool.call({ tool: 'mcp__pa__record_setup', why: 'again' })
  expect(JSON.stringify(result)).toContain('already')
  const { text } = await pa($)
  expect(String(text)).toContain('Step 2')
})

test('the setup prompt tells Claude to call the tool by its full name', () => {
  expect(SETUP_PROMPT).toContain('mcp__pa__record_setup')
})

test('record_setup works after session.start and the band built the context first', async ($, on) => {
  seed(on, 0)
  on('ui.log', async () => ({ value: undefined }) as never)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async (_$, e) => ({ value: { tool: e.name } }) as never)
  await startSession($, on)
  expect(await bandText($)).toContain('/pa setup')
  await $.tool.call({ tool: 'mcp__pa__record_setup', why: 'ship without fear' })
  const { text } = await pa($)
  expect(String(text)).toContain('ship without fear')
  expect(await bandText($)).toContain('Step 1 · Admit it')
})

test('/pa setup submits the setup prompt a moment later, not inside the command', async ($, on) => {
  const { clock } = seed(on, 0)
  const sent: string[] = []
  on('prompt.submit', async (_$, e, next) => (sent.push(e.text), next(e)))
  await pa($, 'setup')
  expect(sent).toEqual([])
  await clock.advance(100)
  expect(sent).toEqual([SETUP_PROMPT])
  expect(SETUP_PROMPT).toContain('mcp__pa__record_setup')
})

// A test registers its own hooks before its first call on `$`: the plugins load at that call.
test('a prompt on step 2 carries the step 2 instructions, and no prompt text is stored', async ($, on) => {
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  const { store } = seed(on, 2)
  const result = await userPrompt($, 'why is my secret-token test failing?')
  expect((result.context ?? []).join('\n')).toContain('guess')
  const stored = JSON.stringify([...store.values()])
  expect(stored).not.toContain('secret-token')
  expect(stored).toContain('"category":"debugging"')
})

test('the tenth prompt on step 1 asks Claude to reflect, once per session', async ($, on) => {
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  seed(on, 1)
  const results = []
  for (let i = 0; i < 25; i++) results.push(await userPrompt($, `ask ${i}`))
  const reflects = results.map(r => (r.context ?? []).join('\n').includes('Reflect now'))
  expect(reflects.indexOf(true)).toBe(9) // the tenth prompt, counting from 0
  expect(reflects.filter(Boolean).length).toBe(1)
})

test('record_guess moves the step line', async ($, on) => {
  seed(on, 2)
  await $.tool.call({ tool: 'mcp__pa__record_guess', score: 'close' })
  const { text } = await pa($)
  expect(String(text)).toContain('1/10')
})

test('a recording tool that cannot save answers calmly', async ($, on) => {
  // A missing step file makes every recording tool fail.
  const broken = new Map(LADDER)
  broken.delete('steps/07.md')
  seed(on, 2, [], broken)
  const result = JSON.stringify(await $.tool.call({ tool: 'mcp__pa__record_guess', score: 'close' }))
  expect(result).toContain("couldn't save this one")
  expect(result).toContain("The user's code and chat are fine.")
})

test('record_guess rejects an unknown score', async ($, on) => {
  seed(on, 2)
  const result = await $.tool.call({ tool: 'mcp__pa__record_guess', score: 'amazing' })
  expect(JSON.stringify(result)).toContain('close, partly, off, or skipped')
})

test('a step 1 user who has not admitted is asked for the admission once per session', async ($, on) => {
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  const now = Date.now()
  seed(on, 1, [1, 2, 3].map(i => makeEvent(now - 800 + i, { kind: 'reflection' })))
  let asks = 0
  for (let i = 0; i < 40; i++) {
    const r = await userPrompt($, `ask ${i}`)
    if ((r.context ?? []).join('\n').includes('mcp__pa__record_admission')) asks++
  }
  expect(asks).toBe(1)
})

const EDIT = { tool: 'Edit', file_path: '/tmp/x.ts', old_string: 'a', new_string: 'b' } as const
const TURN_END = { answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

// Hooks beneath the plugin: an edit tool, a turn end, and a prompt catcher.
// The plugin submits the explain request without waiting, and it runs once the session is idle.
// So each test settles the clock `seed` hands back before it looks at what was submitted.
function explainHarness(on: On) {
  const submitted: string[] = []
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)
    return { text: e.text, context: e.context }
  })
  on('tool.call', async () => ({ result: 'edited' }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  const explains = () => submitted.filter(t => t.includes('explain')).length
  return { explains }
}

test('an edit on step 3 leads to an explain-it-back prompt at turn end', async ($, on) => {
  const { explains } = explainHarness(on)
  const { clock } = seed(on, 3)
  await $.tool.call(EDIT)
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(explains()).toBe(1)
})

test('one batch of edits is explained once, however many turns end', async ($, on) => {
  const { explains } = explainHarness(on)
  const { clock } = seed(on, 3)
  await $.tool.call(EDIT)
  await $.turn.complete(TURN_END)
  await clock.settle()
  await $.turn.complete({ ...TURN_END, turnId: 't2' })
  await clock.settle()
  expect(explains()).toBe(1)
})

test('no edit, no explain prompt', async ($, on) => {
  const { explains } = explainHarness(on)
  const { clock } = seed(on, 3)
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(explains()).toBe(0)
})

test('edits on step 2 are not marked', async ($, on) => {
  const { explains } = explainHarness(on)
  const { clock } = seed(on, 2)
  await $.tool.call(EDIT)
  await $.turn.complete(TURN_END)
  await clock.settle()
  expect(explains()).toBe(0)
})

test('/clear drops an edit the user was never asked to explain', async ($, on) => {
  const { explains } = explainHarness(on)
  on('classic.SessionStart', async () => ({}))
  on('ui.log', async () => ({ value: undefined }) as never)
  seed(on, 3)
  // The turn with the edit is interrupted: no turn end, so the explain request is still waiting.
  await $.tool.call(EDIT)
  await $.classic.SessionStart({ source: 'clear' })
  const result = await userPrompt($, 'start something new')
  expect((result.context ?? []).join('\n')).not.toContain(EXPLAIN_FIRST)
  expect(explains()).toBe(0)
})

test('record_explanation rejects an unknown score', async ($, on) => {
  explainHarness(on)
  seed(on, 3)
  const result = await $.tool.call({ tool: 'mcp__pa__record_explanation', score: 'perfect' })
  expect(JSON.stringify(result)).toContain('clear, rough, or missed')
})

test('/pa up refuses when not ready', async ($, on) => {
  seed(on, 2)
  const { text } = await pa($, 'up')
  expect(String(text)).toContain('Not yet')
})

test('/pa up with a full bar on step 3 says step 4 is not written yet', async ($, on) => {
  const explanations = Array.from({ length: 10 }, (_, i) => makeEvent(Date.now() - 800 + i, { kind: 'explanation', score: 'clear' }))
  seed(on, 3, explanations)
  const { text } = await pa($, 'up')
  expect(text).toBe("You've earned this one. Step 4 isn't written yet, so stay here for now. 💛")
})

test('/pa up on step 3 with a short bar still says not yet', async ($, on) => {
  const explanations = Array.from({ length: 10 }, (_, i) => makeEvent(Date.now() - 800 + i, { kind: 'explanation', score: i < 7 ? 'clear' : 'missed' }))
  seed(on, 3, explanations)
  const { text } = await pa($, 'up')
  expect(String(text)).toContain('Not yet')
})

test('/pa up moves up when ready', async ($, on) => {
  seed(on, 1)
  // Step 1 is ready on the admission alone. Reflections only fill the bar.
  await $.tool.call({ tool: 'mcp__pa__record_admission', words: 'I hand everything to AI' })
  const { text } = await pa($, 'up')
  expect(String(text)).toContain('Welcome to step 2')
  const after = await pa($)
  expect(String(after.text)).toContain('Step 2 · Guess first')
})

test('/pa down on step 1 explains kindly and changes nothing', async ($, on) => {
  seed(on, 1)
  const { text } = await pa($, 'down')
  expect(String(text)).toContain('step 1')
})

test('confirm_step_down moves down one step, once a week', async ($, on) => {
  seed(on, 3)
  await $.tool.call({ tool: 'mcp__pa__confirm_step_down' })
  const second = await $.tool.call({ tool: 'mcp__pa__confirm_step_down' })
  expect(JSON.stringify(second)).toContain('week')
  const { text } = await pa($)
  expect(String(text)).toContain('Step 2')
})

test('/pa rough-day drops one step for today', async ($, on) => {
  seed(on, 3)
  const { text } = await pa($, 'rough-day')
  expect(String(text)).toContain('debug without panicking')
  const after = await pa($)
  expect(String(after.text)).toContain('Rough day')
})

test('/pa rough-day on step 1 records nothing', async ($, on) => {
  const { store } = seed(on, 1)
  await pa($, 'rough-day')
  const stored = JSON.stringify([...store.values()])
  expect(stored).not.toContain('rough-day')
})

// `ask` submits the prompt 50 ms later (a command hook may not submit inside itself).
// So these tests move the clock `seed` hands back before they look at what was sent.
const DAY = 24 * 60 * 60 * 1000
const roughDaysAgo = (...days: number[]) => days.map(d => makeEvent(Date.now() - d * DAY, { kind: 'rough-day' }))

test('/pa down starts the play-the-tape turn a moment later, not inside the command', async ($, on) => {
  const { clock } = seed(on, 3)
  const sent: string[] = []
  on('prompt.submit', async (_$, e, next) => (sent.push(e.text), next(e)))
  await pa($, 'down')
  expect(sent).toEqual([])
  await clock.advance(100)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('step 3 to step 2')
  expect(sent[0]).toContain('call mcp__pa__confirm_step_down')
})

test('the third rough day this week starts a gentle turn, the second does not', async ($, on) => {
  const { clock } = seed(on, 3, roughDaysAgo(2, 3))
  const sent: string[] = []
  on('prompt.submit', async (_$, e, next) => (sent.push(e.text), next(e)))
  await pa($, 'rough-day')
  expect(sent).toEqual([])
  await clock.advance(100)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('3 rough days this week')
  expect(sent[0]).toContain('call mcp__pa__confirm_step_down')
})

test('the second rough day this week starts no turn', async ($, on) => {
  const { clock } = seed(on, 3, roughDaysAgo(2))
  const sent: string[] = []
  on('prompt.submit', async (_$, e, next) => (sent.push(e.text), next(e)))
  await pa($, 'rough-day')
  await clock.advance(100)
  expect(sent).toEqual([])
})

const SET_UP_FIRST = 'Run /pa setup first. It takes a minute. 💛'

test('/pa rough-day before setup stores nothing and asks for setup', async ($, on) => {
  const { store } = seed(on, 0)
  const { text } = await pa($, 'rough-day')
  expect(text).toBe(SET_UP_FIRST)
  expect(JSON.stringify([...store.values()])).not.toContain('rough-day')
})

test('/pa up and /pa down before setup ask for setup', async ($, on) => {
  seed(on, 0)
  expect((await pa($, 'up')).text).toBe(SET_UP_FIRST)
  expect((await pa($, 'down')).text).toBe(SET_UP_FIRST)
})
