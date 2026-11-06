import { describe, expect, it } from 'vitest'
import { CODEBOOK_FORMAT, parseCodeBook } from './codebook.ts'
import { STARTER_BOOK } from './codes.ts'

const wrap = (over: Record<string, unknown>) => ({ format: CODEBOOK_FORMAT, version: 1, codes: [], ...over })
const entry = (over: Record<string, unknown> = {}) => ({ code: 'ip', layer: 'v-prop', connect: true, ...over })

describe('starter book', () => {
  it('is a valid code book with every layer it references defined', () => {
    const layers = new Set(STARTER_BOOK.layers.map((l) => l.name))
    expect(STARTER_BOOK.codes.length).toBeGreaterThan(20)
    for (const c of STARTER_BOOK.codes) expect(layers.has(c.layer), `${c.code} -> ${c.layer}`).toBe(true)
  })
  it('reads cleanly, with no warnings', () => {
    expect(parseCodeBook(JSON.parse(JSON.stringify({ format: CODEBOOK_FORMAT, version: 1, codes: STARTER_BOOK.codes, layers: STARTER_BOOK.layers }))).ok).toBe(true)
  })
})

describe('parseCodeBook', () => {
  it('normalises case and fills in defaults', () => {
    const res = parseCodeBook(wrap({ codes: [entry({ code: ' ip  x ', connect: undefined })] }))
    expect(res.ok && res.book.codes[0]).toEqual({ code: 'IP X', label: 'IP X', layer: 'V-PROP', connect: false })
  })

  it('rejects things that are not a TerraForge dictionary', () => {
    expect(parseCodeBook('not json').ok).toBe(false)
    expect(parseCodeBook([]).ok).toBe(false)
    expect(parseCodeBook({ codes: [] }).ok).toBe(false)
    expect(parseCodeBook({ format: 'something-else', version: 1, codes: [] }).ok).toBe(false)
  })

  it('rejects an unsupported version with a clear message', () => {
    const res = parseCodeBook(wrap({ version: 2 }))
    expect(res.ok).toBe(false)
    expect(!res.ok && res.errors[0]).toMatch(/version 2/)
  })

  it('skips bad entries with a warning but keeps the good ones', () => {
    const res = parseCodeBook(
      wrap({ codes: [entry(), { code: '', layer: 'X' }, entry({ code: 'A', layer: 'bad/name' }), entry({ code: 'B', connect: 'yes' }), entry({ code: 'C', maxGap: -5 }), 'text', null] }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.book.codes.map((c) => c.code)).toEqual(['IP'])
      expect(res.warnings).toHaveLength(6)
    }
  })

  it('fails when entries exist but none are usable', () => {
    expect(parseCodeBook(wrap({ codes: [{ code: 1 }, {}] })).ok).toBe(false)
  })

  it('lets the last duplicate win and says so', () => {
    const res = parseCodeBook(wrap({ codes: [entry({ layer: 'A' }), entry({ layer: 'B' })] }))
    expect(res.ok && res.book.codes).toHaveLength(1)
    expect(res.ok && res.book.codes[0].layer).toBe('B')
    expect(res.ok && res.warnings).toHaveLength(1)
  })

  it('validates layers and the optional maxGap', () => {
    const res = parseCodeBook(wrap({ maxGap: 250, layers: [{ name: 'my-layer', aci: 30 }, { name: 'x', aci: 999 }, { name: 'y' }] }))
    expect(res.ok && res.book.layers).toEqual([{ name: 'MY-LAYER', aci: 30, label: 'MY-LAYER' }])
    expect(res.ok && res.book.maxGap).toBe(250)
    expect(res.ok && res.warnings).toHaveLength(2)
    const bad = parseCodeBook(wrap({ maxGap: 'far' }))
    expect(bad.ok && bad.book.maxGap).toBeUndefined()
    expect(bad.ok && bad.warnings).toHaveLength(1)
  })

  it('accepts a layer colour as hex alone, aci alone, or both, and rejects a bad hex', () => {
    const res = parseCodeBook(wrap({ layers: [{ name: 'a', hex: '#FF0000' }, { name: 'b', aci: 5 }, { name: 'c', aci: 5, hex: '0f0' }, { name: 'd', hex: 'red' }, { name: 'e' }] }))
    expect(res.ok && res.book.layers).toEqual([
      { name: 'A', aci: 1, hex: '#ff0000', label: 'A' },
      { name: 'B', aci: 5, label: 'B' },
      { name: 'C', aci: 5, hex: '#00ff00', label: 'C' },
    ])
    expect(res.ok && res.warnings).toHaveLength(2)
  })

  it('reads and writes line-discipline settings, rejecting bad values', () => {
    const res = parseCodeBook(wrap({ maxSkip: 3, codes: [entry({ code: 'a', maxSkip: 8, closeNumbered: true }), entry({ code: 'b', maxSkip: -1 }), entry({ code: 'c', maxSkip: 'x' })] }))
    expect(res.ok && res.book.maxSkip).toBe(3)
    expect(res.ok && res.book.codes).toEqual([{ code: 'A', label: 'A', layer: 'V-PROP', connect: true, maxSkip: 8, closeNumbered: true }])
    expect(res.ok && res.warnings).toHaveLength(2)
    expect(parseCodeBook(wrap({ maxSkip: -2 })).ok && parseCodeBook(wrap({ maxSkip: -2 }))).toMatchObject({ warnings: [expect.any(String)] })
  })

  it('reads and writes avoidCrossings and mayCross', () => {
    const res = parseCodeBook(wrap({ avoidCrossings: false, codes: [entry({ code: 'a', mayCross: true })] }))
    expect(res.ok && res.book.avoidCrossings).toBe(false)
    expect(res.ok && res.book.codes[0].mayCross).toBe(true)
    expect(parseCodeBook(wrap({ avoidCrossings: 'yes' })).ok && parseCodeBook(wrap({ avoidCrossings: 'yes' }))).toMatchObject({ warnings: [expect.any(String)] })
  })

  it('reads and writes alongside and boundary on a code', () => {
    const res = parseCodeBook(wrap({ codes: [entry({ code: 'top', alongside: ' cld ', boundary: true })] }))
    expect(res.ok && res.book.codes[0]).toMatchObject({ alongside: 'CLD', boundary: true })
  })

  it('does not let unexpected or prototype-polluting properties through', () => {
    const text = '{"format":"terraforge-codebook","version":1,"__proto__":{"polluted":true},"codes":[{"code":"A","layer":"L","evil":"x","__proto__":{"polluted":true}}]}'
    const res = parseCodeBook(JSON.parse(text))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(Object.keys(res.book.codes[0]).sort()).toEqual(['code', 'connect', 'label', 'layer'])
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    }
  })
})
