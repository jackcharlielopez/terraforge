import { describe, expect, it } from 'vitest'
import { STARTER_CODES, buildDictionary, matchDescription } from './codes.ts'
import { countCrossings } from './geometry.ts'
import { DEFAULT_LINEWORK, buildLinework } from './linework.ts'
import type { SurveyPoint } from './types.ts'

const dict = buildDictionary(STARTER_CODES)
const pt = (no: number, e: number, n: number, desc: string): SurveyPoint => ({ no: String(no), e, n, z: 0, desc, line: no })
const run = (pts: SurveyPoint[], maxGap = 100) =>
  buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, { maxGap })

describe('buildLinework', () => {
  it('chains points sharing a code in point-number order', () => {
    const lines = run([pt(3, 20, 0, 'CLD'), pt(1, 0, 0, 'CLD'), pt(2, 10, 0, 'CLD')])
    expect(lines).toHaveLength(1)
    expect(lines[0].vertices.map((v) => v.e)).toEqual([0, 10, 20])
    expect(lines[0].layer).toBe('V-DTCH-CNTR')
  })

  it('chains EP, FOC and BOC together as one road edge', () => {
    const lines = run([pt(1, 0, 0, 'EP'), pt(2, 10, 0, 'FOC'), pt(3, 20, 0, 'BOC')])
    expect(lines).toHaveLength(1)
    expect(lines[0].vertices).toHaveLength(3)
  })

  it('does not connect codes that are not set to connect', () => {
    expect(run([pt(1, 0, 0, 'WV'), pt(2, 10, 0, 'WV')])).toEqual([])
  })

  it('starts a new line across a gap bigger than maxGap', () => {
    const lines = run([pt(1, 0, 0, 'CLD'), pt(2, 10, 0, 'CLD'), pt(3, 500, 0, 'CLD'), pt(4, 510, 0, 'CLD')])
    expect(lines).toHaveLength(2)
  })

  // (the next piece is off to the side: a piece straight ahead would be bridged again by the continuation step)
  it('END finishes the line after including that point', () => {
    const lines = run([pt(1, 0, 0, 'EP'), pt(2, 10, 0, 'END /EP'), pt(3, 10, 50, 'EP'), pt(4, 20, 50, 'EP')])
    expect(lines.map((l) => l.vertices.length)).toEqual([2, 2])
  })

  it('ignores offset shots', () => {
    const lines = run([pt(1, 0, 0, 'EP'), pt(2, 5, 0, "3'O/S EP"), pt(3, 10, 0, 'EP')])
    expect(lines[0].vertices.map((v) => v.e)).toEqual([0, 10])
  })

  it('drops single-point runs and closes closed codes', () => {
    expect(run([pt(1, 0, 0, 'CLD')])).toEqual([])
    const tank = run([pt(1, 0, 0, 'S-TANK'), pt(2, 5, 0, 'S-TANK'), pt(3, 5, 5, 'S-TANK')])
    expect(tank[0].closed).toBe(true)
  })

  it('uses a per-code gap: power poles stay connected 150 units apart, other codes do not', () => {
    const poles = run([pt(1, 0, 0, 'PP E-T'), pt(2, 150, 0, 'PP E-T'), pt(3, 300, 0, 'PP E-T')])
    expect(poles).toHaveLength(1)
    expect(poles[0].vertices).toHaveLength(3)
    expect(run([pt(1, 0, 0, 'CLD'), pt(2, 150, 0, 'CLD')])).toEqual([])
  })

  it('connects concrete by default', () => {
    expect(run([pt(1, 0, 0, 'CONC'), pt(2, 10, 0, 'CONC')])).toHaveLength(1)
  })

  it('lets a multi-code point join several lines', () => {
    const lines = run([pt(1, 0, 0, 'CLD/EP'), pt(2, 10, 0, 'CLD/EP')])
    expect(lines.map((l) => l.layer).sort()).toEqual(['V-DTCH-CNTR', 'V-ROAD-ASPH'])
  })
})

describe('line discipline (maxSkip)', () => {
  // three EP shots with a different kind of shot (WV) in between each pair
  const interleaved = [pt(1, 0, 0, 'EP'), pt(2, 5, 0, 'WV'), pt(3, 10, 0, 'EP'), pt(4, 15, 0, 'WV'), pt(5, 20, 0, 'EP')]
  const opts = (maxSkip: number) => ({ maxGap: 100, maxSkip })
  const runSkip = (pts: SurveyPoint[], maxSkip: number) =>
    buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, opts(maxSkip))

  it('strict: a line breaks when another kind of shot comes between', () => {
    expect(runSkip(interleaved, 0)).toEqual([])
  })
  it('relaxed: tolerates the given number of interruptions', () => {
    expect(runSkip(interleaved, 1)).toHaveLength(1)
    expect(runSkip(interleaved, 1)[0].vertices).toHaveLength(3)
  })
  it('loose (default when unset): joins the same code anywhere', () => {
    expect(run(interleaved)[0].vertices).toHaveLength(3)
  })
  it('a code can override the setting', () => {
    const custom = new Map(dict)
    custom.set('EP', { ...dict.get('EP')!, maxSkip: 5 })
    const lines = buildLinework(interleaved, interleaved.map((p) => matchDescription(p.desc, custom)), custom, opts(0))
    expect(lines[0].vertices).toHaveLength(3)
  })
  it('default options are strict about shot order; only gap filling (by position, opt-in) joins these, since the points are close', () => {
    const m = interleaved.map((p) => matchDescription(p.desc, dict))
    expect(buildLinework(interleaved, m, dict)).toEqual([]) // default: gap filling is off
    expect(buildLinework(interleaved, m, dict, { ...DEFAULT_LINEWORK, fillGaps: 30 })[0].vertices).toHaveLength(3)
  })
})

describe('control tokens and numbered lines', () => {
  const strict = (pts: SurveyPoint[]) => buildLinework(pts, pts.map((p) => matchDescription(p.desc, dict)), dict, { maxGap: 100, maxSkip: 0 })

  it('BEG starts a new line at that point', () => {
    const lines = strict([pt(1, 0, 0, 'EP'), pt(2, 10, 0, 'EP'), pt(3, 20, 0, 'EP BEG'), pt(4, 30, 0, 'EP')])
    expect(lines.map((l) => l.vertices.map((v) => v.e))).toEqual([[0, 10], [20, 30]])
  })
  it('END finishes the line after that point', () => {
    const lines = strict([pt(1, 0, 0, 'EP'), pt(2, 10, 0, 'EP END'), pt(3, 10, 50, 'EP'), pt(4, 20, 50, 'EP')])
    expect(lines.map((l) => l.vertices.length)).toEqual([2, 2])
  })
  it('CLO closes the line back to its first point', () => {
    const lines = strict([pt(1, 0, 0, 'S-TANK'), pt(2, 5, 0, 'S-TANK'), pt(3, 5, 5, 'S-TANK CLO')])
    expect(lines).toHaveLength(1)
    expect(lines[0].closed).toBe(true)
    const open = strict([pt(1, 0, 0, 'EP'), pt(2, 5, 0, 'EP'), pt(3, 5, 5, 'EP CLO'), pt(4, 9, 9, 'EP')])
    expect(open[0].closed).toBe(true)
    expect(open[0].vertices).toHaveLength(3)
  })
  it('a number after a code makes separate lines, and a numbered BLDG closes into a polygon', () => {
    const lines = strict([
      pt(1, 0, 0, 'BLDG1'), pt(2, 10, 0, 'BLDG1'), pt(3, 10, 10, 'BLDG1'),
      pt(4, 50, 0, 'BLDG2'), pt(5, 60, 0, 'BLDG2'), pt(6, 60, 10, 'BLDG2'),
    ])
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.closed && l.vertices.length === 3)).toBe(true)
  })
  it('a bare BLDG (no number) is not closed', () => {
    const lines = strict([pt(1, 0, 0, 'BLDG'), pt(2, 10, 0, 'BLDG'), pt(3, 10, 10, 'BLDG')])
    expect(lines[0]?.closed ?? false).toBe(false)
  })
  it('does not mistake IDs or offsets for line numbers', () => {
    const lines = strict([pt(1, 0, 0, 'IPF#1670'), pt(2, 10, 0, "EP 1.5'OFF HSE"), pt(3, 20, 0, 'EP')])
    // "EP 1.5'OFF HSE" is not a numbered suffix, so these stay one line key
    expect(lines.length).toBeLessThanOrEqual(1)
  })
  it('BEG / CLO are ordinary codes if the dictionary defines them', () => {
    const own = new Map(dict)
    own.set('BEG', { code: 'BEG', label: 'x', layer: 'L', connect: false })
    expect(matchDescription('BEG', own)).toMatchObject({ codes: ['BEG'], begin: false })
    expect(matchDescription('BEG', dict)).toMatchObject({ codes: [], begin: true })
  })
})

describe('ditch banks (a code that runs alongside another line)', () => {
  // centreline CLD along y=0 (x 0..100), TOP bank points on both sides, shot zig-zag across the ditch
  const cl = [0, 20, 40, 60, 80, 100].map((x, i) => pt(i + 1, x, 0, 'CLD'))
  const zig = [
    pt(10, 10, 12, 'TOP'), pt(11, 10, -12, 'TOP'),
    pt(12, 30, -12, 'TOP'), pt(13, 30, 12, 'TOP'),
    pt(14, 50, 12, 'TOP'), pt(15, 50, -12, 'TOP'),
    pt(16, 70, -12, 'TOP'), pt(17, 70, 12, 'TOP'),
  ]
  const banksDict = new Map(dict)
  banksDict.set('TOP', { ...dict.get('TOP')!, alongside: 'CLD' })
  const build = (pts: SurveyPoint[], d = banksDict) =>
    buildLinework(pts, pts.map((p) => matchDescription(p.desc, d)), d, { maxGap: 100, maxSkip: 0 })

  it('draws two parallel bank lines, one per side, instead of zig-zagging across the ditch', () => {
    const lines = build([...cl, ...zig])
    const banks = lines.filter((l) => l.layer === 'V-DTCH-TOPD')
    expect(banks).toHaveLength(2)
    for (const b of banks) {
      expect(b.vertices).toHaveLength(4)
      expect(new Set(b.vertices.map((v) => Math.sign(v.n))).size).toBe(1)           // all on one side
      expect(b.vertices.map((v) => v.e)).toEqual([...b.vertices.map((v) => v.e)].sort((a, c) => a - c)) // in order along the ditch
    }
    expect(countCrossings(lines)).toBe(0)
  })
  it('the same points without "alongside" are chained in shot order and cross the centreline', () => {
    const noBanks = new Map(dict)
    noBanks.set('TOP', { ...dict.get('TOP')!, alongside: undefined })
    const plain = buildLinework([...cl, ...zig], [...cl, ...zig].map((p) => matchDescription(p.desc, noBanks)), noBanks, { maxGap: 100, maxSkip: 8 })
    expect(countCrossings(plain)).toBeGreaterThan(0)
  })
  it('does not depend on the order the centreline was shot in: scrambled centreline numbers give the same banks', () => {
    // the same ditch, but the centreline points are numbered out of order along the ground
    const order = [3, 0, 5, 2, 4, 1]
    const scrambledCl = order.map((x, i) => pt(i + 1, x * 20, 0, 'CLD'))
    const lines = build([...scrambledCl, ...zig])
    const banks = lines.filter((l) => l.layer === 'V-DTCH-TOPD')
    expect(banks).toHaveLength(2)
    for (const b of banks) {
      expect(new Set(b.vertices.map((v) => Math.sign(v.n))).size).toBe(1)
      const xs = b.vertices.map((v) => v.e)
      const sorted = [...xs].sort((a, c) => a - c)
      expect(JSON.stringify(xs) === JSON.stringify(sorted) || JSON.stringify(xs) === JSON.stringify([...sorted].reverse())).toBe(true)
    }
    expect(countCrossings(lines)).toBe(0)
  })
  it('draws the centreline in position order and leaves a long gap open', () => {
    // shot 0,60,40,20 along the ground (a zig-zag the sharp-turn rule would cut), then a separate run far away
    const cl2 = [pt(1, 0, 0, 'CLD'), pt(2, 60, 0, 'CLD'), pt(3, 40, 0, 'CLD'), pt(4, 20, 0, 'CLD'), pt(5, 400, 0, 'CLD'), pt(6, 420, 0, 'CLD')]
    const centre = build([...cl2, ...zig]).filter((l) => l.layer === 'V-DTCH-CNTR')
    expect(centre).toHaveLength(2)
    const near = centre.find((l) => l.vertices.length === 4)!
    expect(near.vertices.map((v) => v.e)).toSatisfy((xs: number[]) => JSON.stringify(xs) === '[0,20,40,60]' || JSON.stringify(xs) === '[60,40,20,0]')
  })
  it('falls back to the shot-order centreline when there are too few centreline points for a corridor', () => {
    const oneCl = [pt(1, 0, 0, 'CLD')]
    expect(() => build([...oneCl, ...zig])).not.toThrow()
  })
  it('points too far from the centreline fall back to the normal rules', () => {
    const far = [pt(30, 10, 500, 'TOP'), pt(31, 20, 500, 'TOP'), pt(32, 30, 500, 'TOP')]
    const lines = build([...cl, ...far])
    const top = lines.filter((l) => l.layer === 'V-DTCH-TOPD')
    expect(top).toHaveLength(1)
    expect(top[0].vertices.map((v) => v.n)).toEqual([500, 500, 500])
  })
  it('does nothing when there is no centreline to run alongside', () => {
    const lines = build(zig)
    expect(lines.filter((l) => l.layer === 'V-DTCH-TOPD').length).toBeGreaterThan(0) // normal chaining still happens
  })
  it('breaks a bank across a gap', () => {
    const gapPts = [pt(10, 10, 12, 'TOP'), pt(11, 30, 12, 'TOP'), pt(12, 500, 12, 'TOP'), pt(13, 520, 12, 'TOP')]
    const longCl = [0, 100, 200, 300, 400, 500, 520].map((x, i) => pt(i + 1, x, 0, 'CLD'))
    const lines = buildLinework([...longCl, ...gapPts], [...longCl, ...gapPts].map((p) => matchDescription(p.desc, banksDict)), banksDict, { maxGap: 100, maxSkip: 0 })
    expect(lines.filter((l) => l.layer === 'V-DTCH-TOPD').map((l) => l.vertices.length)).toEqual([2, 2])
  })
})
