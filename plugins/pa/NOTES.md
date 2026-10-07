# Engine notes

Answers from Task 0. Later tasks rely on these.
Checked on Claude Code 2.1.293.

1. **Import extension.** Use `.ts`. `import { probe } from '../src/probe.ts'` works. Use the `.ts` extension in every import.
2. **`$.plugin.root` and `$.fs.read`.** Both work as typed. `root` is an absolute path string. `read(path)` returns the text. The debug line showed the real root path.
3. **Reading plugin files in tests.** The test kit gives the plugin no file access.
   - Nothing beneath the plugin answers `fs.read`. The plugin's `ui.render` hook is skipped with "no implementation for fs.read".
   - A test cannot read files itself. It cannot import `node:fs`. It cannot import a `.md` file. Only files ending in `.ts`, `.tsx`, `.js` and similar can be imported.
   - A test can stand in for the engine: `on('fs.read', (_$, e) => ({ value: 'text' }))`. The answer must be wrapped as `{ value }`. A bare string is rejected.
   - So a test can prove the plugin asks for the right path and draws what comes back. It cannot prove the real file's content is right.
   - Task 8: tests of the real step files cannot run in the kit. Rely on the by-hand check in Task 13 Step 2.
   - Option: if step text lived in `.ts` modules, a test could import it for real.
4. **Local time.** The mod runtime has the machine's time zone. Under `claude -p --debug`, the line read `tz -120` on a machine at +0200. So `new Date()` gives local time. `time.ts` (Task 1) does not need `date +%z`.
   - `getTimezoneOffset()` is minutes behind UTC, so +0200 shows as -120.
   - Checked headless with `claude -p "hi" --plugin-dir plugins/pa --debug --debug-file <file>`. The `[pa] $.ui.log (to debug): pa probe: ...` line was in the file.
   - Caveat: the machine is on +0200 only. A machine on UTC would also show 0. This run shows the runtime is not forced to UTC.
