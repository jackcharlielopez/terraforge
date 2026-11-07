import { describe, expect, it } from 'vitest'
import { overlapFraction, partlyOverlaps } from './overlap.ts'

const box = (e: number, n: number, w: number, h: number) => [
  { e, n },
  { e: e + w, n },
  { e: e + w, n: n + h },
  { e, n: n + h },
]

describe('partlyOverlaps', () => {
  const tract = box(0, 0, 400, 300)
  it('is false for neighbours that only share an edge', () => {
    expect(partlyOverlaps(tract, box(400, 0, 200, 300))).toBe(false)
  })
  it('is false for a lot inside the tract it was cut from', () => {
    expect(partlyOverlaps(tract, box(20, 20, 150, 100))).toBe(false)
    expect(overlapFraction(tract, box(20, 20, 150, 100))).toBeGreaterThan(0.95)
  })
  it('is false for outlines far apart', () => {
    expect(partlyOverlaps(tract, box(5000, 5000, 100, 100))).toBe(false)
  })
  it('is true for one lying half across the other', () => {
    expect(partlyOverlaps(tract, box(300, 100, 300, 300))).toBe(true)
  })
})
