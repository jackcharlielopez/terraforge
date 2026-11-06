import { describe, expect, it } from 'vitest'
import { buildDictionary, matchDescription } from './codes.ts'
import { countCrossings } from './geometry.ts'
import { buildLinework } from './linework.ts'
import type { CodeDef, SurveyPoint } from './types.ts'

const def = (code: string, layer: string, extra: Partial<CodeDef> = {}): CodeDef => ({ code, label: code, layer, connect: true, ...extra })
const dict = buildDictionary([
  def('CONC', 'V-WALK', { rectilinear: true }),
  def('DIT', 'V-DITCH'),
  def('EP', 'V-EDGE'),
  def('PP', 'V-POWER', { mayCross: true }),
])
const P = (no: number, e: number, n: number, desc: string): SurveyPoint => ({ no: String(no), e, n, z: 0, desc, line: no })
/** strict discipline with an interruption between every pair so shot order alone joins nothing; then gap filling decides. */
const build = (pts: SurveyPoint[], fill = 30, over: Record<string, unknown> = {}) =>
  buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, { maxGap: 100, maxSkip: 0, fillGaps: fill, ...over })
/** Shots of another kind between each, far away, to break shot order. */
const apart = (specs: Array<[number, number, string]>): SurveyPoint[] => {
  const out: SurveyPoint[] = []
  specs.forEach(([e, n, d], i) => {
    out.push(P(out.length + 1, e, n, d))
    if (i < specs.length - 1) out.push(P(out.length + 1, 5000 + i, 5000, 'EP')) // filler, never near anything
  })
  return out
}

describe('fillGaps (connect by layer, then by position)', () => {
  it('joins two close points of the same layer that shot order left open', () => {
    const lines = build(apart([[0, 0, 'DIT'], [10, 0, 'DIT']]))
    expect(lines.filter((l) => l.layer === 'V-DITCH')).toHaveLength(1)
    expect(lines.find((l) => l.layer === 'V-DITCH')!.vertices.map((v) => v.e)).toEqual([0, 10])
  })
  it('does not join beyond the distance, or when switched off', () => {
    expect(build(apart([[0, 0, 'DIT'], [31, 0, 'DIT']])).filter((l) => l.layer === 'V-DITCH')).toEqual([])
    expect(build(apart([[0, 0, 'DIT'], [10, 0, 'DIT']]), 0).filter((l) => l.layer === 'V-DITCH')).toEqual([])
  })
  it('only joins points of the same layer (the same "colour")', () => {
    const lines = build(apart([[0, 0, 'DIT'], [10, 0, 'EP']]))
    expect(lines.filter((l) => l.layer === 'V-DITCH' || (l.layer === 'V-EDGE' && l.vertices.some((v) => v.e === 0)))).toEqual([])
  })
  it('joins in order of distance and never gives a point more than two neighbours or closes a loop', () => {
    const lines = build(apart([[0, 0, 'DIT'], [5, 0, 'DIT'], [10, 0, 'DIT'], [5, 4, 'DIT']]))
    const ditch = lines.filter((l) => l.layer === 'V-DITCH')
    const degree = new Map<string, number>()
    for (const l of ditch) l.vertices.forEach((v, i) => degree.set(`${v.e},${v.n}`, (degree.get(`${v.e},${v.n}`) ?? 0) + (i === 0 || i === l.vertices.length - 1 ? 1 : 2)))
    for (const d of degree.values()) expect(d).toBeLessThanOrEqual(2)
    expect(ditch.every((l) => !l.closed)).toBe(true)
  })
  it('goes to the point in between instead of running over it: A, C and B on a line join A-B and B-C, never A-C', () => {
    const pts = [P(1, 0, 0, 'DIT'), P(2, 5000, 5000, 'EP'), P(3, 20, 0, 'DIT'), P(4, 5001, 5000, 'EP'), P(5, 10, 0, 'DIT')]
    const ditch = build(pts).filter((l) => l.layer === 'V-DITCH')
    expect(ditch).toHaveLength(1)
    expect(ditch[0].vertices.map((v) => v.e)).toEqual([0, 10, 20])
  })
  it('never crosses a line that is already drawn', () => {
    const wall = [P(1, 5, -20, 'EP'), P(2, 5, 20, 'EP')]            // an EP line straight across between the two ditch points
    const pts = [...wall, P(3, 0, 0, 'DIT'), P(4, 5000, 5000, 'EP'), P(5, 10, 0, 'DIT')]
    const lines = build(pts)
    expect(lines.filter((l) => l.layer === 'V-DITCH')).toEqual([])
    expect(countCrossings(lines)).toBe(0)
  })
  it('lines flagged mayCross (power, pipes, property) may cross', () => {
    const wall = [P(1, 5, -20, 'EP'), P(2, 5, 20, 'EP')]
    const lines = build([...wall, P(3, 0, 0, 'PP'), P(4, 5000, 5000, 'EP'), P(5, 10, 0, 'PP')])
    expect(lines.filter((l) => l.layer === 'V-POWER')).toHaveLength(1)
  })
  it('merges a new join into the line it meets, giving one long line', () => {
    // 1-2 joined by shot order, point 4 is separated by a filler shot, then gap filling extends the line to it
    const pts = [P(1, 0, 0, 'DIT'), P(2, 10, 0, 'DIT'), P(3, 5000, 5000, 'EP'), P(4, 20, 0, 'DIT')]
    const ditch = build(pts).filter((l) => l.layer === 'V-DITCH')
    expect(ditch).toHaveLength(1)
    expect(ditch[0].vertices.map((v) => v.e)).toEqual([0, 10, 20])
  })
})

describe('fillGaps on man-made (rectilinear) layers', () => {
  // a sidewalk running along the x axis gives the site its direction
  const axisWalk = [0, 10, 20, 30, 40].map((x, i) => P(i + 1, x, 0, 'CONC'))
  const diagonal = (code: string) => [P(10, 200, 0, code), P(11, 5000, 5000, 'EP'), P(12, 207, 7, code)] // 45 degrees, 10 ft apart

  it('refuses a diagonal join on a man-made layer', () => {
    const lines = build([...axisWalk, ...diagonal('CONC')])
    expect(lines.filter((l) => l.layer === 'V-WALK' && l.vertices.some((v) => v.e === 207))).toEqual([])
  })
  it('allows the same diagonal on a natural layer', () => {
    const lines = build([...axisWalk, ...diagonal('DIT')])
    expect(lines.filter((l) => l.layer === 'V-DITCH')).toHaveLength(1)
  })
  it('allows a join square to the site, and one a few degrees off', () => {
    const square = build([...axisWalk, P(10, 200, 0, 'CONC'), P(11, 5000, 5000, 'EP'), P(12, 200, 10, 'CONC')])
    expect(square.some((l) => l.layer === 'V-WALK' && l.vertices.some((v) => v.n === 10))).toBe(true)
    const nearly = build([...axisWalk, P(10, 200, 0, 'CONC'), P(11, 5000, 5000, 'EP'), P(12, 210, 1.5, 'CONC')])
    expect(nearly.some((l) => l.layer === 'V-WALK' && l.vertices.some((v) => v.e === 210))).toBe(true)
  })
  it('with too few man-made lines to know the site axis, applies no squareness test', () => {
    const lines = build([P(1, 0, 0, 'CONC'), P(2, 5000, 5000, 'EP'), P(3, 7, 7, 'CONC')])
    expect(lines.filter((l) => l.layer === 'V-WALK')).toHaveLength(1)
  })
})

describe('fillGaps respects explicit markers and large inputs', () => {
  it('does not join across a BEG or END marker the surveyor wrote', () => {
    const lines = build([P(1, 0, 0, 'EP'), P(2, 5, 0, 'EP END'), P(3, 10, 0, 'EP BEG'), P(4, 15, 0, 'EP')], 30, { maxSkip: 0 })
    expect(lines.map((l) => l.vertices.map((v) => v.e))).toEqual([[0, 5], [10, 15]])
  })
  it('does nothing in explicit mode (the file says where lines go)', () => {
    const lines = build(apart([[0, 0, 'DIT'], [10, 0, 'DIT']]), 30, { explicitLines: true })
    expect(lines).toEqual([])
  })
  it('gives up on a huge number of candidate joins rather than freezing, leaving the lines as they were', () => {
    const grid: SurveyPoint[] = []
    for (let i = 0; i < 400; i++) { grid.push(P(grid.length + 1, i % 20, Math.floor(i / 20), 'DIT')); grid.push(P(grid.length + 1, 9000 + i, 9000, 'EP')) }
    const withFill = build(grid, 100)
    const without = build(grid, 0)
    expect(withFill.length).toBe(without.length)
  })
})

import { SCRAMBLED_BELOW, orderliness } from './gapfill.ts'

describe('orderliness and joining by position', () => {
  // eight ditch points along a line, ten feet apart
  const along = (order: number[]): SurveyPoint[] => order.map((x, i) => P(i + 1, x * 10, 0, 'DIT'))
  const matchesOf = (pts: SurveyPoint[]) => pts.map((p) => matchDescription(p.desc, dict))

  it('is high when the numbering follows the ground, low when it does not', () => {
    const ordered = along([0, 1, 2, 3, 4, 5, 6, 7])
    const scrambled = along([5, 1, 7, 3, 0, 6, 2, 4])
    expect(orderliness(ordered, matchesOf(ordered), dict)).toBeGreaterThan(0.9)
    expect(orderliness(scrambled, matchesOf(scrambled), dict)).toBeLessThan(SCRAMBLED_BELOW)
  })
  it('gives 1 (nothing to judge) when there are no connecting points', () => {
    const pts = [P(1, 0, 0, 'XYZ'), P(2, 5, 5, 'XYZ')]
    expect(orderliness(pts, matchesOf(pts), dict)).toBe(1)
  })

  const scrambled = along([5, 1, 7, 3, 0, 6, 2, 4])
  const build = (pts: SurveyPoint[], joinBy: 'order' | 'position', extra: Record<string, unknown> = {}) =>
    buildLinework(pts, matchesOf(pts), dict, { maxGap: 100, maxSkip: 0, joinBy, ...extra })

  it('position mode finds the one line through scrambled points; shot order cannot', () => {
    const pos = build(scrambled, 'position')
    expect(pos).toHaveLength(1)
    const xs = pos[0].vertices.map((v) => v.e)
    const ascending = [...xs].sort((a, b) => a - b)
    expect(xs).toSatisfy((v: number[]) => JSON.stringify(v) === JSON.stringify(ascending) || JSON.stringify(v) === JSON.stringify([...ascending].reverse())) // either direction
    expect(pos[0].vertices).toHaveLength(8)
    // shot order chains the points in numbering order, so it zig-zags back and forth along the ground
    const ox = build(scrambled, 'order')[0].vertices.map((v) => v.e)
    const sorted = [...ox].sort((a, b) => a - b)
    expect(JSON.stringify(ox) === JSON.stringify(sorted) || JSON.stringify(ox) === JSON.stringify([...sorted].reverse())).toBe(false)
  })
  it('position mode uses 40 units by default, and the fill distance when one is set', () => {
    const far = [P(1, 0, 0, 'DIT'), P(2, 50, 0, 'DIT')]
    expect(build(far, 'position')).toEqual([])
    expect(build(far, 'position', { fillGaps: 60 })).toHaveLength(1)
    const near = [P(1, 0, 0, 'DIT'), P(2, 35, 0, 'DIT')]
    expect(build(near, 'position')).toHaveLength(1)
  })
  it('position mode is ignored when the file marks its own lines', () => {
    expect(build(scrambled, 'position', { explicitLines: true })).toEqual([])
  })
})
