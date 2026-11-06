import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STARTER_CODES, buildDictionary, matchDescription } from './codes.ts'
import { compareWithReference } from './compare.ts'
import { buildDxf } from './dxf.ts'
import { cleanText, decodeDxf, readDxf, scanAttribs, shapesFromParsed } from './dxfview.ts'
import { DEFAULT_LINEWORK, buildLinework } from './linework.ts'
import { parsePoints } from './parse.ts'

const referenceText = decodeDxf(readFileSync('reference/job-a.dxf'))
const reference = await readDxf(referenceText)

describe('readDxf on the finished reference drawing', () => {
  it('draws the survey points, linework, text and block contents', () => {
    expect(reference.points.length).toBeGreaterThan(200)
    expect(reference.lines.length).toBeGreaterThan(100)
    expect(reference.circles.length).toBeGreaterThan(190) // the SPT4 point symbols, via blocks
    expect(reference.texts.length).toBeGreaterThan(100)
    expect(reference.extent).not.toBeNull()
  })
  it('ignores paper space (title block, viewports)', () => {
    expect(reference.paperSpaceIgnored).toBeGreaterThan(0)
  })
  it('keeps stray points at (0,0) out of the fit and reports them', () => {
    expect(reference.atOrigin).toBe(5) // the drafter left 5 POINTs at the origin
    expect(reference.extent!.minX).toBeGreaterThan(1_900_000)
    expect(reference.extent!.minY).toBeGreaterThan(400_000)
  })
  it('recovers point numbers, elevations and descriptions from block attributes', () => {
    const texts = reference.texts.map((t) => t.text)
    expect(texts).toContain('100')
    expect(texts).toContain('1063.688')
    expect(texts).toContain('IPF#1670/BASE')
    expect(reference.layers.map((l) => l.name)).toEqual(expect.arrayContaining(['PNTNO', 'PNTELEV', 'PNTDESC', 'V-SWLK-CONC']))
  })
  it('reports layers with counts and colours', () => {
    const l = reference.layers.find((x) => x.name === 'V-SWLK-CONC')!
    expect(l.count).toBeGreaterThan(10)
    expect(l.aci).toBe(141)
  })
})

describe('text encoding', () => {
  it('reads AutoCAD 2007+ (UTF-8) text correctly: degree signs in the bearings are not mojibake', () => {
    const texts = reference.texts.map((t) => t.text).join(' ')
    expect(texts).toMatch(/S 81°34'44" E/)
    expect(texts).not.toContain('Â')
  })
  it('chooses the encoding from the file version', () => {
    const utf8 = (v: string) => new TextEncoder().encode(`  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\n${v}\n  0\nENDSEC\n  1\n5° 30'\n`)
    expect(decodeDxf(utf8('AC1032'))).toContain("5° 30'")
    // an older file with a single cp1252 byte for the degree sign
    const old = new Uint8Array([...new TextEncoder().encode('  9\n$ACADVER\n  1\nAC1015\n  1\n5'), 0xb0, ...new TextEncoder().encode(' 30\n')])
    expect(decodeDxf(old)).toContain('5° 30')
  })
  it('turns AutoCAD %% codes into symbols', () => {
    expect(cleanText('S 81%%d34\'44" E')).toBe('S 81°34\'44" E')
    expect(cleanText('%%p0.5')).toBe('±0.5')
  })
})

describe('scanAttribs / cleanText', () => {
  it('reads ATTRIB text and position from raw DXF', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'ATTRIB', '8', 'PNTNO', '10', '5.0', '20', '6.0', '40', '1.0', '1', '101', '72', '1', '11', '7.0', '21', '8.0', '0', 'ENDSEC', '0', 'EOF'].join('\n')
    expect(scanAttribs(dxf)).toEqual([{ layer: 'PNTNO', x: 7, y: 8, h: 1, text: '101' }])
  })
  it('ignores ATTRIBs outside ENTITIES (block definitions)', () => {
    const dxf = ['0', 'SECTION', '2', 'BLOCKS', '0', 'ATTRIB', '8', 'X', '10', '1', '20', '1', '1', 'hidden', '0', 'ENDSEC'].join('\n')
    expect(scanAttribs(dxf)).toEqual([])
  })
  it('strips MTEXT formatting', () => {
    expect(cleanText('{\\fArial|b1;SEPTIC\\PTANK}')).toBe('SEPTIC TANK')
  })
})

describe('shapesFromParsed transforms', () => {
  it('applies an INSERT\'s position, scale and rotation to block contents', () => {
    const shapes = shapesFromParsed({
      entities: [{ type: 'INSERT', layer: 'SYM', name: 'B', position: { x: 10, y: 20 }, xScale: 2, yScale: 2, rotation: 90 }],
      blocks: { B: { position: { x: 0, y: 0 }, entities: [{ type: 'LINE', layer: '0', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, { type: 'CIRCLE', layer: '0', center: { x: 0, y: 0 }, radius: 3 }] } },
    })
    const [a, b] = shapes.lines[0].pts
    expect(a[0]).toBeCloseTo(10); expect(a[1]).toBeCloseTo(20)
    expect(b[0]).toBeCloseTo(10); expect(b[1]).toBeCloseTo(22) // (1,0) scaled x2 then rotated 90 deg -> (0,2)
    expect(shapes.circles[0].r).toBeCloseTo(6)
    expect(shapes.lines[0].layer).toBe('SYM') // block content on layer 0 inherits the INSERT's layer
    expect(shapes.edges).toHaveLength(0) // block contents are not top-level edges
  })
  it('does not recurse forever on a block that inserts itself', () => {
    const shapes = shapesFromParsed({
      entities: [{ type: 'INSERT', name: 'LOOP', position: { x: 0, y: 0 } }],
      blocks: { LOOP: { entities: [{ type: 'INSERT', name: 'LOOP', position: { x: 1, y: 0 } }, { type: 'POINT', position: { x: 0, y: 0 } }] } },
    })
    expect(shapes.points.length).toBeLessThan(10)
  })
  it('counts entity types it cannot draw', () => {
    expect(shapesFromParsed({ entities: [{ type: 'LEADER' }, { type: 'LEADER' }] }).notDrawn).toEqual({ LEADER: 2 })
  })
})

describe('round trip: our own DXF renders back', () => {
  const { points } = parsePoints(readFileSync('samples/job-a.txt', 'latin1'))
  const dict = buildDictionary(STARTER_CODES)
  const matches = points.map((p) => matchDescription(p.desc, dict))
  const lines = buildLinework(points, matches, dict, DEFAULT_LINEWORK)
  it('reads back the same points and polylines', async () => {
    const back = await readDxf(buildDxf(points, matches, dict, lines))
    expect(new Set(back.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size).toBe(points.length)
    expect(back.edges.length).toBe(lines.length)
  })
})

describe('compareWithReference', () => {
  const { points } = parsePoints(readFileSync('samples/job-a.txt', 'latin1'))
  const dict = buildDictionary(STARTER_CODES)
  const matches = points.map((p) => matchDescription(p.desc, dict))
  const lines = buildLinework(points, matches, dict, DEFAULT_LINEWORK)
  const stats = compareWithReference(points, lines, reference)

  it('finds the survey points in the reference (all but the drafter-moved point 148)', () => {
    expect(stats.genPoints).toBe(202)
    expect(stats.matchedPoints).toBeGreaterThanOrEqual(201)
  })
  it('agrees with the earlier manual measurement of the default linework', () => {
    expect(stats.refSegments).toBeGreaterThan(90)
    expect(stats.matchedSegments / stats.refSegments).toBeGreaterThanOrEqual(0.55)
  })
  it('a drawing compared with itself matches completely', async () => {
    const self = await readDxf(buildDxf(points, matches, dict, lines))
    const s = compareWithReference(points, lines, self)
    expect(s.matchedPoints).toBe(points.length)
    expect(s.matchedSegments).toBe(s.genSegments)
    expect(s.refSegments).toBe(s.genSegments)
  })
})
