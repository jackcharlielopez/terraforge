import { readFileSync } from 'node:fs'
import DxfParser from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { BEARING_LAYER, buildBoundary, findCandidates, formatBearing, suggestBoundary } from './boundary.ts'
import { STARTER_CODES, buildDictionary, matchDescription } from './codes.ts'
import { compareWithReference } from './compare.ts'
import { buildDxf } from './dxf.ts'
import { decodeDxf, readDxf } from './dxfview.ts'
import { buildLinework } from './linework.ts'
import { parsePoints } from './parse.ts'

const { points } = parsePoints(readFileSync('samples/job-a.txt', 'latin1'))
const dict = buildDictionary(STARTER_CODES)
const matches = points.map((p) => matchDescription(p.desc, dict))
const cands = findCandidates(points, matches, dict)

describe('formatBearing', () => {
  it('writes quadrant bearings in degrees, minutes, seconds', () => {
    expect(formatBearing(1, 0).text).toBe('N 00°00\'00" E')
    expect(formatBearing(-1, 0).text).toBe('S 00°00\'00" E')
    expect(formatBearing(0, 1).text).toBe('N 90°00\'00" E')
    expect(formatBearing(0, -1).text).toBe('N 90°00\'00" W') // due west: no north/south part, so the N convention applies
    expect(formatBearing(-1, -1).text).toBe('S 45°00\'00" W')
  })
  it('matches a known course from the plat', () => {
    // pin 100 -> pin 123 on the sample job is S 81°35'02" E
    const a = points.find((p) => p.no === '100')!, b = points.find((p) => p.no === '123')!
    expect(formatBearing(b.n - a.n, b.e - a.e).text).toBe('S 81°35\'02" E')
  })
  it('gives a CAD-safe ASCII version using %%d', () => {
    expect(formatBearing(10, 1).cad).toMatch(/^N 05%%d\d\d'\d\d" E$/)
  })
  it('rolls 59.5 seconds over cleanly instead of printing 60', () => {
    const t = formatBearing(Math.cos(((10 + 59.9 / 3600) * Math.PI) / 180), Math.sin(((10 + 59.9 / 3600) * Math.PI) / 180)).text
    expect(t).not.toContain("60\"")
  })
})

describe('boundary candidates and suggestion', () => {
  it('finds the iron pins and the monument as candidates', () => {
    expect(cands.map((c) => c.no)).toEqual(expect.arrayContaining(['100', '102', '113', '121', '122', '123', '209', '250']))
    expect(cands.find((c) => c.no === '209')).toMatchObject({ isSet: true, capId: null })
    expect(cands.find((c) => c.no === '100')?.capId).toBe('1670')
  })
  it('suggests the pins sharing the most common cap number plus the pins set on the job, without a line pin', () => {
    // 102 carries the same cap number but sits 74 ft beyond corner 100 on the extension of the west line
    expect(suggestBoundary(cands).sort()).toEqual(['100', '123', '209', '250'])
    expect(Math.round(buildBoundary(points, suggestBoundary(cands))!.area)).toBe(36242)
  })
  it('suggests nothing when there are no candidates', () => {
    expect(suggestBoundary([])).toEqual([])
  })
})

describe('buildBoundary on the sample job (the plat prints 36,242 sq ft, 0.83 acres)', () => {
  const four = buildBoundary(points, ['100', '123', '250', '209'])!

  it('reproduces the plat area and perimeter', () => {
    expect(Math.round(four.area)).toBe(36242)
    expect(four.area / 43560).toBeCloseTo(0.83, 2)
    expect(four.perimeter).toBeCloseTo(783.24, 1)
  })
  it('reproduces all four courses', () => {
    const d = four.courses.map((c) => c.distance.toFixed(2)).sort()
    expect(d).toEqual(['149.98', '150.00', '241.54', '241.72'])
    const text = four.courses.map((c) => c.bearing)
    expect(text).toContain('N 08°11\'15" E')
    expect(text).toContain('N 81°34\'44" W')
  })
  it('is the same whatever order the pins are ticked in, and closed', () => {
    const other = buildBoundary(points, ['209', '250', '100', '123'])!
    expect(other.polyline.vertices.map((v) => v.e).sort()).toEqual(four.polyline.vertices.map((v) => v.e).sort())
    expect(Math.round(other.area)).toBe(36242)
    expect(four.polyline.closed).toBe(true)
    expect(four.polyline.layer).toBe('V-PROP')
    expect(four.polyline.mayCross).toBe(true)
  })
  it('shows a wrong pin in the area: adding pin 102 (same cap number, same line) gives 45,300 sq ft', () => {
    expect(Math.round(buildBoundary(points, ['100', '102', '123', '250', '209'])!.area)).toBe(45300)
  })
  it('needs at least three pins', () => {
    expect(buildBoundary(points, ['100', '123'])).toBeNull()
    expect(buildBoundary(points, [])).toBeNull()
  })
  it('labels each course along its line, never upside down, with a CAD-safe version', () => {
    expect(four.labels).toHaveLength(4)
    for (const l of four.labels) {
      expect(l.rotation).toBeGreaterThanOrEqual(-90)
      expect(l.rotation).toBeLessThanOrEqual(90)
      expect(l.layer).toBe(BEARING_LAYER)
      expect(l.cad).toContain('%%d')
      expect(l.text).toContain('°')
    }
  })
})

describe('boundary in the DXF and against the drafter\'s drawing', () => {
  const four = buildBoundary(points, ['100', '123', '250', '209'])!
  const lines = [...buildLinework(points, matches, dict), four.polyline]

  it('writes the closed V-PROP polyline and the bearing labels, keeping %%d', () => {
    const dxf = buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 0.5, hiddenLayers: new Set(), labels: four.labels })
    expect(dxf).toContain('%%d')
    const parsed = new DxfParser().parseSync(dxf)!
    const ents = parsed.entities as Array<{ type: string; layer: string; shape?: boolean; rotation?: number }>
    expect(ents.filter((e) => e.type === 'TEXT' && e.layer === 'BRGTXT')).toHaveLength(4)
    const prop = ents.find((e) => e.type === 'POLYLINE' && e.layer === 'V-PROP')
    expect(prop?.shape).toBe(true)
  })
  it('hides the labels with their layer', () => {
    const dxf = buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 0.5, hiddenLayers: new Set(['BRGTXT']), labels: four.labels })
    expect(dxf).not.toContain('BRGTXT')
  })
  it('matches the drafter\'s four property-line segments exactly', async () => {
    const ref = await readDxf(decodeDxf(readFileSync('reference/job-a.dxf')))
    const withBoundary = compareWithReference(points, lines, ref)
    const without = compareWithReference(points, buildLinework(points, matches, dict), ref)
    expect(withBoundary.matchedSegments - without.matchedSegments).toBe(4)
  })
})
