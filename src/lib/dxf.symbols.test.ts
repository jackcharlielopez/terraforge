import DxfParser from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { STARTER_CODES, buildDictionary, matchDescription } from './codes.ts'
import { buildDxf } from './dxf.ts'
import { LAYER_LINETYPE, LINETYPES } from './linetypes.ts'
import { buildLinework } from './linework.ts'
import { SYMBOLS, SYMBOL_RATIO, symbolForDescription } from './symbols.ts'
import type { SurveyPoint } from './types.ts'

// invented points only
const pt = (no: number, e: number, n: number, desc: string): SurveyPoint => ({ no: String(no), e, n, z: 100, desc, line: no })
const points = [
  pt(1, 1000, 1000, 'IPF'),
  pt(2, 1100, 1000, 'PP E-T'),
  pt(3, 1200, 1000, 'PP E-T'),
  pt(4, 1000, 1100, 'STK'),
  pt(5, 1100, 1100, 'WV'),
  pt(6, 1200, 1100, 'TOP FH'),
  pt(7, 1000, 1200, 'WATERLINE'),
  pt(8, 1100, 1200, 'WATERLINE'),
  pt(9, 1200, 1200, 'ORANGE TPOST'),
  pt(10, 1000, 1300, 'MYSTERY'),
]
const dict = buildDictionary(STARTER_CODES)
const matches = points.map((p) => matchDescription(p.desc, dict))
const lines = buildLinework(points, matches, dict)
const dxf = buildDxf(points, matches, dict, lines)

/** The file as [code, value] pairs. */
const pairs = dxf.split('\r\n').flatMap((v, i, all) => (i % 2 === 0 && i + 1 < all.length ? [[Number(v), all[i + 1]] as [number, string]] : []))
const count = (code: number, value: string) => pairs.filter(([c, v]) => c === code && v === value).length
/** The INSERTs of the drawing itself; the legend's are on layer LEGEND. */
const inserts = (includeLegend = false) => {
  const out: Array<{ name: string; layer: string; scale: number; x: number }> = []
  pairs.forEach(([c, v], i) => {
    if (c !== 0 || v !== 'INSERT') return
    const grab = (code: number) => pairs.slice(i + 1, i + 12).find(([k]) => k === code)?.[1] ?? ''
    if (includeLegend || grab(8) !== 'LEGEND') out.push({ name: grab(2), layer: grab(8), scale: Number(grab(41)), x: Number(grab(10)) })
  })
  return out
}

describe('symbols in the DXF', () => {
  it('inserts the legend symbol for a code, on the code layer or its symbol layer', () => {
    const ins = inserts()
    expect(ins.find((i) => i.x === 1000 && i.name === 'SPT5')?.layer).toBe('V-PROP') // IPF: iron pin found
    expect(ins.filter((i) => i.name === 'CG101').map((i) => i.layer)).toEqual(['V-POWR-POLE', 'V-POWR-POLE']) // PP E-T: symbol on its own layer, line on V-POWR-OVHD
    expect(ins.find((i) => i.name === 'SPT39')?.layer).toBe('V-WATR-STRC')
    expect(ins.find((i) => i.name === 'CG152')?.layer).toBe('V-WATR-STRC')
  })

  it('gives a stake and a post their symbol although the rules leave them plain points', () => {
    const ins = inserts()
    expect(ins.find((i) => i.name === 'SPT214')?.layer).toBe('V-PROP')
    expect(ins.find((i) => i.name === 'SPT138')?.layer).toBe('V-SITE-FENC')
    expect(symbolForDescription('STK/OLD FEN ON GRD')?.symbol).toBe('SPT214')
    expect(symbolForDescription('NAIK FND TOP WFP')?.symbol).toBe('SPT138')
    expect(symbolForDescription('IPF IN FENCE')).toBeNull()
  })

  it('puts no symbol on an unknown shot', () => {
    expect(inserts().some((i) => i.x === 1000 && i.layer !== 'V-PROP' && i.name !== '')).toBe(false)
    expect(inserts().filter((i) => i.x === 1000).length).toBeLessThanOrEqual(2)
  })

  it('sizes a symbol from the legend ratio and the point marker', () => {
    expect(inserts().find((i) => i.name === 'CG152')?.scale).toBeCloseTo(SYMBOL_RATIO['CG152'], 3)
    const big = buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 1, hiddenLayers: new Set() })
    const m = big.match(/INSERT\r\n[\s\S]*?CG152[\s\S]*?\r\n 41\r\n([\d.]+)/)
    expect(Number(m?.[1])).toBeCloseTo(SYMBOL_RATIO['CG152'] * 2, 3)
  })

  it('leaves out the symbols of a hidden layer', () => {
    const out = buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 0.5, hiddenLayers: new Set(['V-WATR-STRC']) })
    expect(out).not.toContain('\r\nCG152\r\n')
  })

  it('defines every block it inserts, and only those', () => {
    const used = new Set(inserts().map((i) => i.name))
    const defined = pairs.flatMap(([c, v], i) => (c === 0 && v === 'BLOCK' ? [pairs.slice(i + 1, i + 8).find(([k]) => k === 2)![1]] : []))
    expect(new Set(defined)).toEqual(used)
    expect(count(0, 'BLOCK')).toBe(count(0, 'ENDBLK'))
  })

  it('writes no BLOCKS section when no symbol is used', () => {
    const none = buildDxf([pt(1, 0, 0, 'MYSTERY')], [matchDescription('MYSTERY', dict)], dict, [])
    expect(none).not.toContain('BLOCKS')
  })

  it('keeps polylines balanced and parseable (vertices then SEQEND), blocks included', () => {
    expect(count(0, 'POLYLINE')).toBe(count(0, 'SEQEND'))
    expect(() => new DxfParser().parseSync(dxf)).not.toThrow()
  })
})

describe('the legend in the DXF', () => {
  const text = (value: string) => pairs.some(([c, v]) => c === 1 && v === value)
  it('lists the symbols and line types the drawing uses, in the legend sheet wording', () => {
    expect(text('LEGEND')).toBe(true)
    expect(text('Iron Pin Found')).toBe(true)
    expect(text('PP Transformer')).toBe(true)
    expect(text('Fire Hydrant')).toBe(true)
    expect(text('Overhead Powerline')).toBe(true)
    expect(text('Stake Set')).toBe(true)
    expect(text('Fence Post')).toBe(true)
  })
  it('does not list what the drawing does not use', () => {
    expect(text('Gas Valve')).toBe(false)
    expect(text('Sanitary Sewer')).toBe(false)
    expect(text('Property Line')).toBe(false)
  })
  it('sits to the right of the survey, with its symbols on the LEGEND layer', () => {
    const legend = inserts(true).filter((i) => i.layer === 'LEGEND')
    expect(legend.length).toBeGreaterThan(0)
    expect(legend.every((i) => i.x > 1200)).toBe(true) // the survey's easternmost point
    expect(legend.map((i) => i.name).sort()).toEqual([...new Set(inserts().map((i) => i.name))].sort())
  })
  it('can be left out', () => {
    const none = buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 0.5, hiddenLayers: new Set(), legend: false })
    expect(none).not.toContain('These standard symbols')
    expect(buildDxf(points, matches, dict, lines, { textHeight: 1, markerRadius: 0.5, hiddenLayers: new Set(['LEGEND']) })).not.toContain('These standard symbols')
  })
})

describe('line types in the DXF', () => {
  it('puts the legend line type on the line, and defines it with the same name', () => {
    const named = pairs.filter(([c]) => c === 6).map(([, v]) => v).filter((v) => v !== 'CONTINUOUS')
    const defined = pairs.flatMap(([c, v], i) => (c === 0 && v === 'LTYPE' ? [pairs[i + 1][1]] : []))
    expect(lines.some((l) => l.layer === 'V-POWR-OVHD')).toBe(true)
    expect(named).toContain(LAYER_LINETYPE['V-POWR-OVHD'])
    for (const n of new Set(named)) expect(defined).toContain(n)
  })

  it('defines only the line types that are used, with their dash pattern', () => {
    const defined = pairs.flatMap(([c, v], i) => (c === 0 && v === 'LTYPE' ? [pairs[i + 1][1]] : []))
    expect(defined).not.toContain('GAS_0-50_0-10_1-00')
    const i = pairs.findIndex(([c, v], k) => c === 2 && v === LAYER_LINETYPE['V-POWR-OVHD'] && pairs[k - 1][1] === 'LTYPE')
    const n = Number(pairs.slice(i, i + 8).find(([c]) => c === 73)![1])
    expect(n).toBe(LINETYPES.find((l) => l.name === LAYER_LINETYPE['V-POWR-OVHD'])!.pattern.length)
  })

  it('scales the pattern with the text height, as the template does (25 for text 4)', () => {
    const i = pairs.findIndex(([c, v]) => c === 9 && v === '$LTSCALE')
    expect(Number(pairs[i + 1][1])).toBeCloseTo(6.25, 3)
  })

  it('gives each pattern a total of the dashes and gaps', () => {
    for (const l of LINETYPES) {
      expect(l.pattern.length).toBeGreaterThan(0)
      expect(l.pattern.every(Number.isFinite)).toBe(true)
      expect(l.pattern.some((v) => v > 0)).toBe(true)
    }
    for (const lt of Object.values(LAYER_LINETYPE)) expect(LINETYPES.some((l) => l.name === lt)).toBe(true)
  })
})

describe('symbol data', () => {
  it('has a size ratio for every symbol, and sound geometry', () => {
    for (const [name, prims] of Object.entries(SYMBOLS)) {
      expect(SYMBOL_RATIO[name]).toBeGreaterThan(0)
      expect(prims.length).toBeGreaterThan(0)
      expect(JSON.stringify(prims)).not.toMatch(/null|NaN/)
    }
  })

  it('assigns only known symbols in the starter dictionary', () => {
    for (const c of STARTER_CODES) if (c.symbol) expect(SYMBOLS[c.symbol]).toBeDefined()
  })
})
