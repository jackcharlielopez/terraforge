import { describe, expect, it } from 'vitest'
import { buildDictionary, matchDescription } from './codes.ts'
import { removeSkewedStubs } from './layerrules.ts'
import { buildLinework } from './linework.ts'
import type { CodeDef, SurveyPoint } from './types.ts'

const def = (code: string, layer: string, extra: Partial<CodeDef> = {}): CodeDef => ({ code, label: code, layer, connect: true, ...extra })
const P = (no: number, e: number, n: number, desc: string): SurveyPoint => ({ no: String(no), e, n, z: 0, desc, line: no })
const build = (defsList: CodeDef[], pts: SurveyPoint[]) => {
  const dict = buildDictionary(defsList)
  return buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, { maxGap: 100, maxSkip: 0 })
}

describe('spurs off a road edge', () => {
  const edge = def('EP', 'ROAD', { spurLayer: 'DRIVE', spurAngle: 35 })
  // a road running north for 300 ft, with a driveway edge turning off it to the east
  const road = [0, 40, 80, 120, 160, 200].map((n, i) => P(i + 1, 0, n, 'EP'))
  const drive = [P(7, 10, 200, 'EP'), P(8, 20, 201, 'EP'), P(9, 30, 202, 'EP')]

  it('keeps the part along the road on the road layer and moves the part that turns away to the spur layer', () => {
    const lines = build([edge], [...road, ...drive])
    expect(lines.filter((l) => l.layer === 'ROAD').every((l) => l.vertices.every((v) => v.e <= 0.001))).toBe(true)
    const spur = lines.filter((l) => l.layer === 'DRIVE')
    expect(spur.length).toBeGreaterThan(0)
    expect(spur.flatMap((l) => l.vertices).some((v) => v.e >= 10)).toBe(true)
  })
  it('does nothing without a spur layer, or when there is no clear long axis', () => {
    expect(build([def('EP', 'ROAD')], [...road, ...drive]).every((l) => l.layer === 'ROAD')).toBe(true)
    const blob = [P(1, 0, 0, 'EP'), P(2, 10, 0, 'EP'), P(3, 10, 10, 'EP'), P(4, 0, 10, 'EP')] // as wide as it is long
    expect(build([edge], blob).every((l) => l.layer === 'ROAD')).toBe(true)
  })
  it('never re-splits a line the surveyor closed', () => {
    const lines = build([edge], [P(1, 0, 0, 'EP'), P(2, 0, 40, 'EP'), P(3, 0, 80, 'EP'), P(4, 30, 90, 'EP'), P(5, 30, 70, 'EP CLO')])
    expect(lines.every((l) => l.layer === 'ROAD')).toBe(true)
  })
})

describe('a driveway edge does not start at the mouth corner', () => {
  const ep = def('EP', 'ROAD', { line: 'edge', spurLayer: 'DRIVE', spurAngle: 35 })
  const boc = def('BOC', 'ROAD', { line: 'edge', spurLayer: 'DRIVE', spurAngle: 35 })
  const road = [0, 40, 80, 120].map((n, i) => P(i + 1, 0, n, 'EP'))
  const drive = [P(6, 10, 170, 'EP'), P(7, 20, 172, 'EP'), P(8, 30, 174, 'EP')]
  const starts = (corner: string) =>
    build([ep, boc], [...road, P(5, 0, 160, corner), ...drive]).filter((l) => l.layer === 'DRIVE').flatMap((l) => l.vertices.map((v) => `${v.e},${v.n}`))

  it('leaves a corner carrying two codes (EP/BOC) on the road edge', () => {
    expect(starts('EP/BOC')).not.toContain('0,160')
    expect(starts('EP/BOC')).toContain('10,170')
  })
  it('drops a lone short spur segment across the kerb, and a lone one leaving a corner', () => {
    const lone = build([ep, boc], [...road, P(5, 0, 160, 'EP'), P(6, 2, 160, 'EP')])
    expect(lone.filter((l) => l.layer === 'DRIVE')).toHaveLength(0) // 2 ft across: not a driveway edge
    const fromCorner = build([ep, boc], [...road, P(5, 0, 160, 'EP/BOC'), P(6, 30, 175, 'EP')])
    expect(fromCorner.filter((l) => l.layer === 'DRIVE')).toHaveLength(0) // one segment leaving a corner
  })
  it('keeps an ordinary single-code shot as the start of the spur', () => {
    expect(starts('EP')).toContain('0,160')
  })
})

describe('the same segment on two layers', () => {
  // CONC/EP points sit on both the sidewalk and the road edge
  const conc = def('CONC', 'WALK', { priority: 1 })
  const ep = def('EP', 'ROAD')
  const pts = [P(1, 0, 0, 'CONC/EP'), P(2, 10, 0, 'CONC/EP'), P(3, 20, 0, 'CONC/EP')]

  it('keeps it only on the higher-priority layer', () => {
    const lines = build([conc, ep], pts)
    expect(lines.map((l) => l.layer)).toEqual(['WALK'])
  })
  it('keeps both when the priorities are equal (the old behaviour)', () => {
    const layers = build([def('CONC', 'WALK'), ep], pts).map((l) => l.layer).sort()
    expect(layers).toEqual(['ROAD', 'WALK'])
  })
  it('leaves segments that are only on one layer alone', () => {
    const lines = build([conc, ep], [...pts, P(4, 20, 50, 'EP'), P(5, 20, 80, 'EP')])
    expect(lines.some((l) => l.layer === 'ROAD')).toBe(true)
  })
})

describe('short skewed stubs on man-made layers', () => {
  const walk = new Map(buildDict([def('CONC', 'WALK', { rectilinear: true })]))
  const natural = new Map(buildDict([def('DIT', 'DITCH')]))
  function buildDict(list: CodeDef[]): Array<[string, CodeDef]> { return list.map((d) => [d.code, d]) }
  const L = (layer: string, ...pts: Array<[number, number]>) => ({ layer, key: layer, closed: false, vertices: pts.map(([e, n]) => ({ e, n, z: 0 })) })
  // a square wall along the x axis gives the site its direction
  const wall = L('WALK', [0, 0], [10, 0], [20, 0], [30, 0], [40, 0])

  it('drops a segment of 2-10 ft that is well off the site axis, and keeps the rest', () => {
    const lines = [wall, L('WALK', [100, 0], [104, 5])] // 6.4 ft at about 51 degrees
    const out = removeSkewedStubs(walk, lines)
    expect(out).toHaveLength(1)
    expect(out[0].vertices).toHaveLength(5)
  })
  it('keeps very short segments (noisy direction), long diagonals (a real angled path) and square ones', () => {
    const keep = [wall, L('WALK', [100, 0], [100.7, 0.7]), L('WALK', [200, 0], [220, 20]), L('WALK', [300, 0], [300, 8])]
    expect(removeSkewedStubs(walk, keep)).toHaveLength(keep.length)
  })
  it('allows a few degrees of skew (a slightly rotated building)', () => {
    const rot = L('WALK', [100, 0], [108, 1.4]) // about 10 degrees
    expect(removeSkewedStubs(walk, [wall, rot])).toHaveLength(2)
  })
  it('only touches layers of man-made codes, and never closed shapes', () => {
    expect(removeSkewedStubs(natural, [L('DITCH', [0, 0], [10, 0], [20, 0], [30, 0]), L('DITCH', [100, 0], [104, 5])])).toHaveLength(2)
    const closed = { ...L('WALK', [100, 0], [104, 5], [100, 10]), closed: true }
    expect(removeSkewedStubs(walk, [wall, closed])).toHaveLength(2)
  })
  it('does nothing when there are too few man-made lines to know the site direction', () => {
    const few = [L('WALK', [0, 0], [4, 5]), L('WALK', [50, 0], [54, 5])]
    expect(removeSkewedStubs(walk, few)).toHaveLength(2)
  })
})
