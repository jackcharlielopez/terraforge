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
})
