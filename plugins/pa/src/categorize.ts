import type { Category } from './events.ts'

// Order matters: the first rule that matches wins.
const RULES: ReadonlyArray<readonly [Category, RegExp]> = [
  ['debugging', /\b(error|errors|bug|bugs|fail|fails|failing|failed|broken|crash(es)?|exception|stack ?trace|not working|doesn'?t work)\b/i],
  ['planning', /\b(plan|planning|design|architect(ure)?|approach|structure|should (i|we)|trade-?offs?|strategy|spec)\b/i],
  ['explaining', /\b(explain|what does|what is|how does|why is|understand)\b/i],
  ['code', /\b(write|implement|add|create|build|refactor|rename|fix|update|change|make)\b/i],
]

export function categorize(text: string): Category {
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other'
}
