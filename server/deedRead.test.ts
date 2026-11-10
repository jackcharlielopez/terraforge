import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs server module
import { parseReply } from './deedRead.mjs'

describe('parseReply', () => {
  it('reads JSON wrapped in prose and coerces calls', () => {
    const t = parseReply('Here you go: {"tracts":[{"label":"A","statedAcres":1.26,"calls":[{"ns":"S","ew":"W","deg":4,"min":0,"sec":0,"distance":257,"text":"S 4 W 257"},{"ns":"X","ew":"E","deg":1,"distance":5}]}]} done')
    expect(t).toHaveLength(1)
    expect(t[0].calls).toHaveLength(1)
    expect(t[0].calls[0]).toMatchObject({ ns: 'S', ew: 'W', deg: 4, distance: 257, unsure: false })
  })
  it('marks an unreadable degree as unsure', () => {
    const t = parseReply('{"tracts":[{"calls":[{"ns":"N","ew":"E","deg":null,"min":0,"sec":0,"distance":10}]}]}')
    expect(t[0].calls[0]).toMatchObject({ deg: null, unsure: true })
  })
  it('throws on junk', () => {
    expect(() => parseReply('sorry')).toThrow()
    expect(() => parseReply('{"x":1}')).toThrow()
  })

  it('converts a tract in chains to feet, and an area in square feet to acres', () => {
    const t = parseReply('{"tracts":[{"unit":"chains","statedArea":{"value":43560,"unit":"sqft"},"calls":[{"ns":"N","ew":"E","deg":10,"min":0,"sec":0,"distance":2,"curve":{"radius":3,"direction":"R","arcLength":2.1}}]}]}')
    expect(t[0].statedAcres).toBeCloseTo(1, 6)
    expect(t[0].calls[0].distance).toBeCloseTo(132, 6)
    expect(t[0].calls[0].curve).toEqual({ radius: 198, direction: 'R', arcLength: 138.6 })
  })
  it('still reads the older plain acreage', () => {
    expect(parseReply('{"tracts":[{"statedAcres":1.26,"calls":[]}]}')[0].statedAcres).toBe(1.26)
  })
  it('keeps confidence, and drops a curve that is not usable', () => {
    const t = parseReply('{"tracts":[{"calls":[{"ns":"S","ew":"W","deg":4,"min":0,"sec":0,"distance":10,"confidence":"low","curve":{"radius":-5,"direction":"X"}},{"ns":"S","ew":"W","deg":4,"min":0,"sec":0,"distance":10,"confidence":"certain"}]}]}')
    expect(t[0].calls[0].confidence).toBe('low')
    expect(t[0].calls[0].curve).toBeUndefined()
    expect(t[0].calls[1].confidence).toBeUndefined()
  })
  it('treats a bearing that cannot exist as unreadable', () => {
    const t = parseReply('{"tracts":[{"calls":[{"ns":"N","ew":"E","deg":95,"min":0,"sec":0,"distance":10},{"ns":"N","ew":"E","deg":40,"min":75,"sec":0,"distance":10}]}]}')
    expect(t[0].calls.map((c: { deg: number | null; unsure: boolean }) => [c.deg, c.unsure])).toEqual([[null, true], [null, true]])
  })
  it('reads the description type, with a sensible default', () => {
    const t = parseReply('{"tracts":[{"descriptionType":"lot_reference","calls":[]},{"calls":[]},{"calls":[{"ns":"N","ew":"E","deg":1,"min":0,"sec":0,"distance":5}]}]}')
    expect(t.map((x: { descriptionType: string }) => x.descriptionType)).toEqual(['lot_reference', 'words_only', 'metes_and_bounds'])
  })
  it('marks a call low confidence when its distance is not in its own transcription', () => {
    const slip = parseReply('{"tracts":[{"calls":[{"ns":"N","ew":"W","deg":87,"min":45,"sec":0,"distance":366.79,"confidence":"high","text":"North 87 deg. 45 min. west, 366.67 feet along the margin"}]}]}')
    expect(slip[0].calls[0].confidence).toBe('low')
    expect(slip[0].calls[0].note).toMatch(/not in the transcribed text/)
  })
  it('does not flag a distance printed as a mixed fraction, or an arc length for a curve', () => {
    const t = parseReply('{"tracts":[{"calls":[{"ns":"N","ew":"E","deg":50,"min":0,"sec":0,"distance":139.5,"confidence":"high","text":"North 50 degrees East 139 1/2 feet to a point"},{"ns":"N","ew":"E","deg":50,"min":0,"sec":0,"distance":86.26,"confidence":"high","text":"R=525.00 L=86.36 CH=86.26","curve":{"radius":525,"direction":"R","arcLength":86.36}}]}]}')
    expect(t[0].calls.map((c: { confidence: string }) => c.confidence)).toEqual(['high', 'high'])
  })
  it('does not flag a call with no transcription to compare', () => {
    expect(parseReply('{"tracts":[{"calls":[{"ns":"N","ew":"E","deg":5,"min":0,"sec":0,"distance":10,"confidence":"high","text":""}]}]}')[0].calls[0].confidence).toBe('high')
  })
})
