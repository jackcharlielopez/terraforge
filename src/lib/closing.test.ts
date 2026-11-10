import { describe, expect, it } from 'vitest'
import { closingCall, solveUnreadable } from './closing.ts'
import type { Call } from './deedcalls.ts'
import { assess } from './traverse.ts'

const call = (ns: 'N' | 'S', ew: 'E' | 'W', deg: number | null, distance: number, extra: Partial<Call> = {}): Call => ({ ns, ew, deg, min: 0, sec: 0, distance, unsure: deg === null, text: '', ...extra })
// an invented 300 x 400 ft rectangle (120,000 sq ft), walked clockwise
const square = (second: Call) => [call('N', 'E', 0, 400), second, call('S', 'E', 0, 400), call('N', 'W', 90, 300)]
const ACRES = 120000 / 43560

describe('solveUnreadable', () => {
  it('solves the one bearing that could not be read, from the gap the others leave, and marks it inferred', () => {
    const out = solveUnreadable(square(call('N', 'E', null, 300)), ACRES)
    expect(out[1]).toMatchObject({ ns: 'N', ew: 'E', deg: 90, min: 0, unsure: false })
    expect(out[1].inferred).toMatch(/solved from closure/)
    // never "ok" on its own: an inferred call is a check
    expect(assess(out, ACRES).verdict).toBe('check')
  })
  it('does nothing when the printed distance does not fit the gap', () => {
    const calls = square(call('N', 'E', null, 350))
    expect(solveUnreadable(calls, ACRES)).toBe(calls)
  })
  it('does nothing when the area then disagrees with the stated acreage', () => {
    const calls = square(call('N', 'E', null, 300))
    expect(solveUnreadable(calls, 5)).toBe(calls)
  })
  it('does nothing with two unreadable bearings, or none', () => {
    const two = [call('N', 'E', null, 400), call('N', 'E', null, 300), call('S', 'E', 0, 400), call('N', 'W', 90, 300)]
    expect(solveUnreadable(two, null)).toBe(two)
    const none = square(call('N', 'E', 90, 300))
    expect(solveUnreadable(none, null)).toBe(none)
  })
})

describe('closingCall', () => {
  it('gives the missing last call of a description that was never closed', () => {
    const open = [call('N', 'E', 0, 400), call('N', 'E', 90, 300), call('S', 'E', 0, 400)]
    const c = closingCall(open)!
    expect(c).toMatchObject({ ns: 'S', ew: 'W', deg: 90 })
    expect(c.distance).toBeCloseTo(300, 3)
  })
  it('gives nothing when the calls already close', () => {
    expect(closingCall(square(call('N', 'E', 90, 300)))).toBeNull()
  })
})
