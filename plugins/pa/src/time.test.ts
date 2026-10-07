import { test, expect } from 'claude-code/testing'
import { localDay, startOfLocalDay, startOfLocalWeek } from './time.ts'

// Dates are built from local parts, so these tests pass in any time zone.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

test('localDay names the local calendar day', () => {
  expect(localDay(at(2026, 10, 7, 23, 59))).toBe('2026-10-07')
  expect(localDay(at(2026, 10, 8, 0, 1))).toBe('2026-10-08')
})

test('startOfLocalDay is local midnight', () => {
  expect(startOfLocalDay(at(2026, 10, 7, 15))).toBe(at(2026, 10, 7, 0))
})

test('startOfLocalWeek is the Monday of that week', () => {
  // 2026-10-07 is a Wednesday; 2026-10-05 is the Monday.
  expect(startOfLocalWeek(at(2026, 10, 7))).toBe(at(2026, 10, 5, 0))
  // A Sunday belongs to the week that started six days earlier.
  expect(startOfLocalWeek(at(2026, 10, 11))).toBe(at(2026, 10, 5, 0))
})
