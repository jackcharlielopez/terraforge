import { describe, expect, it } from 'vitest'
import { holdForAi, looksLikePlat, platMessage } from './plat.ts'

// invented text only
const deed = 'Beginning at a stake; thence South 20 deg. West 100 feet, thence North 70 deg. East 50 feet to the beginning, containing 1 acre.'
const lotReference = 'Lot 4 of Block A of the Green Acres Subdivision as shown on the plat of record in Plat Book 1, page 87, Register of Deeds.'
const drawing = 'LINE TABLE L1 N 34 46 38 W 50.11 L2 S 11 48 01 E 24.46 CURVE TABLE C1 R=525.00 SURVEYOR CERTIFICATE'
const labelsOnly = 'S 54 47 36 E 167.94 S 67 02 19 E 730.00 N 55 22 00 W 43.07 N 28 07 18 W 143.53 lot 5 0.41 ac'

describe('looksLikePlat', () => {
  it('knows a plat by its table markers or labelled bearings, when the text has no "thence"', () => {
    expect(looksLikePlat('scan 1.pdf', drawing)).toBe(true)
    expect(looksLikePlat('scan 2.pdf', labelsOnly)).toBe(true)
  })
  it('does not take a deed for one, even a lot reference that names a plat book', () => {
    expect(looksLikePlat('DB 1234 56.pdf', deed)).toBe(false)
    expect(looksLikePlat('DB 1234 57.pdf', lotReference)).toBe(false)
  })
  it('never calls a description with "thence" a plat on its text, whatever else it holds', () => {
    expect(looksLikePlat('x.pdf', deed + ' L1 L2 line table')).toBe(false)
  })
  it('knows a plat by its file name', () => {
    expect(looksLikePlat('Plat Book 6 Pg 130.pdf', deed)).toBe(true)
    expect(looksLikePlat('hickory_place_ph_2.pdf', '')).toBe(true)
    expect(looksLikePlat('Smith Subdivision.pdf', '')).toBe(true)
    expect(looksLikePlat('DB 1234 56.pdf', '')).toBe(false)
  })
})

describe('holdForAi', () => {
  it('holds a plat that OCR did not read into a trusted description', () => {
    expect(holdForAi('Plat Book 6.pdf', '', [])).toBe(true)
    expect(holdForAi('Plat Book 6.pdf', '', ['fail'])).toBe(true)
  })
  it('keeps a plat-named file that OCR did read into a trusted description, and never holds a deed', () => {
    expect(holdForAi('Smith Subdivision deed.pdf', deed, ['ok'])).toBe(false)
    expect(holdForAi('DB 1234 56.pdf', deed, ['fail'])).toBe(false)
  })
})

describe('platMessage', () => {
  it('points to the button when the AI reader is there, and to the paid tier when it is not', () => {
    expect(platMessage(true)).toMatch(/Process with AI/)
    expect(platMessage(false)).toMatch(/paid/)
  })
})
