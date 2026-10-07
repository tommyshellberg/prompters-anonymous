import type { Register } from 'claude-code'
import { probe } from '../src/probe.ts'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.ui.log(`pa probe: ${probe()} · root ${$.plugin.root} · tz ${new Date().getTimezoneOffset()}`, { to: 'debug' })
    return next(e)
  })

  // The band draws the probe file's text, so a test can see whether the plugin read it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const text = await $.fs.read(`${$.plugin.root}/steps/probe.md`)
    const { Text } = $.ui.resolve(e)
    return Text({ children: [text.trim()] })
  })
}
