import { test, expect } from 'claude-code/testing'
import { probe } from '../src/probe.ts'

test('a plugin file imports with its .ts extension', () => {
  expect(probe()).toBe('imported')
})

// A test has no real file access, and nothing beneath the plugin answers `fs.read`.
// So the test stands in for the engine and answers `fs.read` itself.
// This proves the plugin asks for steps/probe.md and draws what comes back.
// It does not read the real file.
test('the plugin reads steps/probe.md and draws its text', async ($, on) => {
  const asked: string[] = []
  on('fs.read', async (_$, e) => {
    asked.push(e.path)
    return { value: 'probe file\n' }
  })
  const band = await $.ui.mount({
    plugin: 'pa', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
  })
  expect(asked.length).toBe(1)
  expect(asked[0].endsWith('/steps/probe.md')).toBe(true)
  expect((await band.find({ type: 'Text' }))?.text).toBe('probe file')
})
