export type Measure = 'reflection' | 'guess' | 'explanation' | 'none'

export type StepDef = {
  number: number
  name: string
  line: string
  measure: Measure
  window: number
  need: number
  instructions: string
}

const MEASURES: readonly Measure[] = ['reflection', 'guess', 'explanation', 'none']

export const STEP_FILES: readonly string[] = Array.from({ length: 12 }, (_, i) => `steps/${String(i + 1).padStart(2, '0')}.md`)

export function parseStep(text: string): StepDef {
  // Git for Windows may check the step files out with \r\n line endings.
  text = text.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) throw new Error('step file: missing --- front matter')
  const fields = new Map(
    match[1].split('\n').flatMap(row => {
      const at = row.indexOf(':')
      return at === -1 ? [] : [[row.slice(0, at).trim(), row.slice(at + 1).trim()] as const]
    }),
  )
  const field = (key: string): string => {
    const value = fields.get(key)
    if (value === undefined) throw new Error(`step file: missing field "${key}"`)
    return value
  }
  const whole = (key: string): number => {
    const value = field(key)
    const number = Number(value)
    // Number('') is 0, so a blank value must be rejected on its own.
    if (value === '' || !Number.isInteger(number)) throw new Error(`step file: field "${key}" is not a number`)
    return number
  }
  const measure = field('measure') as Measure
  if (!MEASURES.includes(measure)) throw new Error(`step file: unknown measure "${measure}"`)
  return {
    number: whole('number'),
    name: field('name'),
    line: field('line'),
    measure,
    window: whole('window'),
    need: whole('need'),
    instructions: match[2].trim(),
  }
}

export async function loadLadder(readText: (path: string) => Promise<string>, root: string): Promise<StepDef[]> {
  const steps = await Promise.all(
    STEP_FILES.map(async file => {
      try {
        return parseStep(await readText(`${root}/${file}`))
      } catch (error) {
        // Name the file, so the debug log says which step file to fix.
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
  return steps.sort((a, b) => a.number - b.number)
}
