import { describe, expect, it } from 'vitest'
import { countCrossings, removeCrossings, removeHairpins, repairZigzags } from './geometry.ts'
import type { Polyline } from './types.ts'

const line = (layer: string, ...pts: Array<[number, number]>): Polyline => ({ layer, key: layer, closed: false, vertices: pts.map(([e, n]) => ({ e, n, z: 0 })) })

describe('countCrossings', () => {
  it('counts an X as one crossing', () => {
    expect(countCrossings([line('A', [0, 0], [10, 10]), line('A', [0, 10], [10, 0])])).toBe(1)
  })
  it('finds a line crossing itself (a bow-tie)', () => {
    expect(countCrossings([line('A', [0, 0], [10, 10], [10, 0], [0, 10])])).toBe(1)
  })
  it('ignores lines that only touch at a shared point or do not meet', () => {
    expect(countCrossings([line('A', [0, 0], [5, 5]), line('A', [5, 5], [10, 0])])).toBe(0)
    expect(countCrossings([line('A', [0, 0], [1, 0]), line('A', [5, 5], [6, 5])])).toBe(0)
  })
  it('counts crossings between different layers too (a ditch cutting a curb is still a crossing)', () => {
    expect(countCrossings([line('A', [0, 0], [10, 10]), line('B', [0, 10], [10, 0])])).toBe(1)
  })
  it('leaves out lines that may legitimately cross (overhead power, pipes, property lines)', () => {
    const power = { ...line('P', [0, 10], [10, 0]), mayCross: true }
    expect(countCrossings([line('A', [0, 0], [10, 10]), power])).toBe(0)
  })
  it('includes the closing segment of a closed line', () => {
    const closed: Polyline = { ...line('A', [0, 0], [10, 0], [10, 10], [0, 10]), closed: true }
    expect(countCrossings([closed])).toBe(0)
    expect(countCrossings([closed, line('A', [5, -5], [5, 15])])).toBe(2)
  })
  it('gives up (null) on very large drawings instead of freezing', () => {
    const many = Array.from({ length: 4100 }, (_, i) => line('A', [i, 0], [i, 1]))
    expect(countCrossings(many)).toBeNull()
  })
})

describe('removeCrossings', () => {
  const total = (ls: Polyline[]) => ls.reduce((n, l) => n + l.vertices.length - 1 + (l.closed ? 1 : 0), 0)

  it('leaves non-crossing lines exactly as they are', () => {
    const lines = [line('A', [0, 0], [10, 0], [20, 0]), line('B', [0, 5], [10, 5])]
    expect(removeCrossings(lines)).toEqual({ lines, removed: 0 })
  })
  it('drops one segment of an X, the longer one, and the result no longer crosses', () => {
    const short = line('A', [0, 5], [10, 5])
    const long = line('B', [5, -100], [5, 100])
    const res = removeCrossings([short, long])
    expect(res.removed).toBe(1)
    expect(res.lines.map((l) => l.layer)).toEqual(['A'])
    expect(countCrossings(res.lines)).toBe(0)
  })
  it('splits a line where its segment was removed', () => {
    const zig = line('A', [0, 0], [10, 0], [10, 10], [0, 10], [0, -5], [-3, -5])
    const wall = line('B', [5, -10], [5, 20])
    const res = removeCrossings([zig, wall])
    expect(countCrossings(res.lines)).toBe(0)
    expect(res.removed).toBeGreaterThan(0)
    expect(res.lines.every((l) => l.vertices.length >= 2)).toBe(true)
  })
  it('removes the segment involved in most crossings first, keeping as much as possible', () => {
    // one long segment crosses three short verticals: removing the long one fixes all three
    const long = line('A', [0, 0], [30, 0])
    const v = [line('B', [5, -5], [5, 5]), line('C', [15, -5], [15, 5]), line('D', [25, -5], [25, 5])]
    const res = removeCrossings([long, ...v])
    expect(res.removed).toBe(1)
    expect(res.lines.map((l) => l.layer).sort()).toEqual(['B', 'C', 'D'])
  })
  it('never touches lines flagged mayCross, and they do not cause removals', () => {
    const power = { ...line('P', [0, 5], [100, 5]), mayCross: true }
    const wall = line('B', [50, -10], [50, 20])
    const res = removeCrossings([power, wall])
    expect(res.removed).toBe(0)
    expect(res.lines).toHaveLength(2)
  })
  it('keeps a closed shape closed when nothing crosses it', () => {
    const closed: Polyline = { ...line('A', [0, 0], [10, 0], [10, 10]), closed: true }
    const res = removeCrossings([closed, line('B', [20, 0], [30, 0])])
    expect(res.lines[0].closed).toBe(true)
  })
  it('opens a closed shape when its closing segment is removed', () => {
    const closed: Polyline = { ...line('A', [0, 0], [10, 0], [10, 10], [0, 10]), closed: true }
    const cutter = line('B', [-5, 5], [3, 5], [3, -20])   // crosses only the left (closing) side and the bottom
    const res = removeCrossings([closed, cutter])
    expect(countCrossings(res.lines)).toBe(0)
    expect(total(res.lines)).toBeLessThan(total([closed, cutter]))
  })
  it('does not remove segments that merely share an end point', () => {
    const a = line('A', [0, 0], [5, 5])
    const b = line('B', [5, 5], [10, 0])
    expect(removeCrossings([a, b]).removed).toBe(0)
  })
  it('is idempotent', () => {
    const lines = [line('A', [0, 0], [10, 10]), line('B', [0, 10], [10, 0]), line('C', [5, -5], [5, 15])]
    const once = removeCrossings(lines)
    expect(removeCrossings(once.lines).removed).toBe(0)
  })
})

describe('repairZigzags (a zig-zag in shot order is put right instead of being cut)', () => {
  const line = (pts: Array<[number, number]>): Polyline => ({ layer: 'L', key: 'k', closed: false, vertices: pts.map(([e, n]) => ({ e, n, z: 0 })) })
  it('reorders a run that folds back, keeping both ends where they were', () => {
    // shot 0, 60, 40, 20 (then on to 100): the middle stretch is in the wrong order
    const out = repairZigzags([line([[0, 0], [60, 0], [40, 0], [20, 0], [100, 0]])], 60)
    expect(out.repaired).toBe(1)
    expect(out.lines[0].vertices.map((v) => v.e)).toEqual([0, 20, 40, 60, 100])
  })
  it('leaves a line that does not fold back alone', () => {
    const l = line([[0, 0], [20, 0], [40, 5], [60, 0]])
    const out = repairZigzags([l], 60)
    expect(out.repaired).toBe(0)
    expect(out.lines[0]).toBe(l)
  })
  it('does not touch closed lines or lines that may cross', () => {
    const closed = { ...line([[0, 0], [60, 0], [40, 0], [20, 0], [100, 0]]), closed: true }
    const power = { ...line([[0, 0], [60, 0], [40, 0], [20, 0], [100, 0]]), mayCross: true }
    expect(repairZigzags([closed, power], 60).repaired).toBe(0)
  })
})

describe('removeHairpins (lines should not double back)', () => {
  it('drops the longer segment of a sharp turn, inside one line', () => {
    // 0,0 -> 100,0 -> 10,10 turns back on itself (about 6 degrees): the long first leg goes
    const r = removeHairpins([line('A', [0, 0], [100, 0], [10, 10])], 60)
    expect(r.removed).toBe(1)
    expect(r.lines.map((l) => l.vertices.map((v) => [v.e, v.n]))).toEqual([[[100, 0], [10, 10]]])
  })
  it('leaves straight runs and square corners alone', () => {
    const lines = [line('A', [0, 0], [10, 0], [20, 0]), line('B', [0, 5], [10, 5], [10, 15])]
    expect(removeHairpins(lines, 60)).toEqual({ lines, removed: 0, repaired: 0 })
  })
  it('keeps a corner just above the threshold and removes one just below', () => {
    const corner = (deg: number) => line('A', [0, 0], [10, 0], [10 - 10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180) + 0])
    expect(removeHairpins([corner(70)], 60).removed).toBe(0)
    expect(removeHairpins([corner(50)], 60).removed).toBe(1)
  })
  it('handles two different lines that meet end to end at a sharp angle', () => {
    const r = removeHairpins([line('A', [0, 0], [50, 0]), line('B', [50, 0], [5, 3])], 60)
    expect(r.removed).toBe(1)
    expect(r.lines).toHaveLength(1)
  })
  it('does not touch lines that may legitimately do anything (power, pipes, property)', () => {
    const power = { ...line('P', [0, 0], [100, 0], [10, 10]), mayCross: true }
    expect(removeHairpins([power], 60)).toEqual({ lines: [power], removed: 0, repaired: 0 })
  })
  it('does not judge a turn made with a very short segment (its direction is survey noise)', () => {
    // a 1 ft spur followed by a long run doubling back: the angle is sharp but untrustworthy
    const noisy = line('A', [0, 0], [30, 0], [29, 0.3])
    expect(removeHairpins([noisy], 60).removed).toBe(0)
    expect(removeHairpins([noisy], 60, 0).removed).toBe(1) // judged when the guard is off
  })
  it('ignores a point where three or more segments meet, and is off at 0 degrees', () => {
    const star = [line('A', [0, 0], [10, 0]), line('B', [0, 0], [10, 1]), line('C', [0, 0], [10, -1])]
    expect(removeHairpins(star, 60).removed).toBe(0)
    expect(removeHairpins([line('A', [0, 0], [100, 0], [10, 10])], 0).removed).toBe(0)
  })
})
