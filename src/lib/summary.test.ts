import { describe, expect, it } from 'vitest'
import { MISC_LAYER, buildDictionary } from './codes.ts'
import { layerCounts } from './summary.ts'
import type { PointMatch } from './types.ts'

const m = (codes: string[], unknown: string[] = []): PointMatch => ({ codes, unknown }) as PointMatch
const dict = buildDictionary([
  { code: 'EP', label: 'Edge', layer: 'V-ROAD', connect: true },
  { code: 'FOC', label: 'Face', layer: 'V-ROAD', connect: true },
  { code: 'TOP', label: 'Top', layer: 'V-DTCH', connect: true },
])

describe('layerCounts', () => {
  it('counts a point once per layer, uses the misc layer for unknown codes, and lists line-only layers with 0', () => {
    const rows = layerCounts([m(['EP', 'FOC']), m(['TOP']), m([], ['ZZ'])], dict, ['V-PROP'], 3)
    const byName = new Map(rows.map((r) => [r.name, r.n]))
    expect(byName.get('V-ROAD')).toBe(1)
    expect(byName.get('V-DTCH')).toBe(1)
    expect(byName.get(MISC_LAYER)).toBe(1)
    expect(byName.get('V-PROP')).toBe(0)
    expect(byName.get('PNTS')).toBe(3)
  })
})
