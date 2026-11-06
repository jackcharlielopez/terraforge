import { describe, expect, it } from 'vitest'
import { aciToRgb, hexToRgb, nearestAci, normalizeHex, rgbToHex } from './aci.ts'

describe('ACI palette', () => {
  it('matches known AutoCAD index colours', () => {
    expect(aciToRgb(1)).toEqual([255, 0, 0])
    expect(aciToRgb(5)).toEqual([0, 0, 255])
    expect(aciToRgb(10)).toEqual([255, 0, 0])
    expect(aciToRgb(11)).toEqual([255, 128, 128])
    expect(aciToRgb(12)).toEqual([204, 0, 0])
    expect(aciToRgb(20)).toEqual([255, 64, 0])
    expect(aciToRgb(30)).toEqual([255, 128, 0])
    expect(aciToRgb(250)).toEqual([51, 51, 51])
    expect(aciToRgb(255)).toEqual([255, 255, 255])
  })
})

describe('nearestAci', () => {
  it('round-trips every index colour except 7 (and duplicates of the same RGB)', () => {
    for (let i = 1; i <= 255; i++) {
      if (i === 7) continue
      const back = nearestAci(rgbToHex(aciToRgb(i)))
      expect(aciToRgb(back)).toEqual(aciToRgb(i))
    }
  })
  it('snaps an arbitrary colour to a close index colour', () => {
    expect(nearestAci('#fe0101')).toBe(1)
    expect(nearestAci('#0000fd')).toBe(5)
    expect(nearestAci('#3d7055')).toBeGreaterThan(0)
  })
})

describe('normalizeHex', () => {
  it('accepts #rgb, #rrggbb and bare hex, in any case', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('3D7055')).toBe('#3d7055')
    expect(normalizeHex('  #3d7055 ')).toBe('#3d7055')
  })
  it('rejects anything else', () => {
    for (const bad of ['', '#12', '#12345', '#1234567', 'red', '#ggg', 'javascript:alert(1)']) expect(normalizeHex(bad)).toBeNull()
  })
  it('hexToRgb is safe on bad input', () => {
    expect(hexToRgb('nonsense')).toEqual([0, 0, 0])
  })
})
