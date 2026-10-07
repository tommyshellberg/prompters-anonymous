import { test, expect } from 'claude-code/testing'
import { categorize } from './categorize.ts'

test('debugging words win first', () => {
  expect(categorize('why is this test failing?')).toBe('debugging')
  expect(categorize('I get an error when I save')).toBe('debugging')
})

test('planning words', () => {
  expect(categorize('how should we structure the auth module')).toBe('planning')
  expect(categorize('design a schema for orders')).toBe('planning')
})

test('explaining words', () => {
  expect(categorize('explain this regex')).toBe('explaining')
  expect(categorize('what does useEffect cleanup do')).toBe('explaining')
})

test('writing code words', () => {
  expect(categorize('add a logout button')).toBe('code')
  expect(categorize('refactor this into two functions')).toBe('code')
})

test('anything else', () => {
  expect(categorize('ok')).toBe('other')
  expect(categorize('continue')).toBe('other')
})
