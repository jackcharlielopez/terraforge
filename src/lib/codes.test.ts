import { describe, expect, it } from 'vitest'
import { STARTER_CODES, buildDictionary, matchDescription, splitDescription } from './codes.ts'

const dict = buildDictionary(STARTER_CODES)

describe('splitDescription', () => {
  it('splits multi-code descriptions on /', () => {
    expect(splitDescription('GUTTER/EP/GAS', dict)).toEqual(['GUTTER', 'EP', 'GAS'])
  })
  it('does not split O/S or C/L', () => {
    expect(splitDescription("3'O/S BLDG", dict)).toEqual(["3'O/S BLDG"])
    expect(splitDescription('C/L RD', dict)).toEqual(['C/L RD'])
    expect(splitDescription("NEW CONC/3'O/S", dict)).toEqual(['NEW CONC', "3'O/S"])
  })
  it('trims the space in "END /FOC/EP"', () => {
    expect(splitDescription('END /FOC/EP', dict)).toEqual(['END', 'FOC', 'EP'])
  })
})

describe('distance-to-structure notes', () => {
  it('keeps the code but never joins the shot into a line', () => {
    expect(matchDescription("CONC 2'OFF BLDG", dict)).toMatchObject({ codes: ['CONC'], offset: true })
    expect(matchDescription("BOC 1.5'OFF HSE", dict)).toMatchObject({ codes: ['BOC'], offset: true })
  })
  it('does not catch ordinary descriptions', () => {
    expect(matchDescription('CONC', dict).offset).toBe(false)
    expect(matchDescription('OFFSET FENCE', dict).offset).toBe(false)
  })
})

describe('matchDescription', () => {
  it('matches a code followed by an id or free text', () => {
    expect(matchDescription('IPF#1670/BASE', dict)).toMatchObject({ codes: ['IPF', 'BASE'], unknown: [] })
    expect(matchDescription("BOC 1.5'OFF HSE", dict).codes).toEqual(['BOC'])
    expect(matchDescription("CONC 2'OFF BLDG", dict).codes).toEqual(['CONC'])
  })
  it('prefers the longest dictionary key', () => {
    expect(matchDescription('TOP FH', dict).codes).toEqual(['TOP FH'])
    expect(matchDescription('CONC MNT FND', dict).codes).toEqual(['CONC MNT FND'])
  })
  it('does not match a key inside a longer word', () => {
    expect(matchDescription('IPFX', dict)).toMatchObject({ codes: [], unknown: ['IPFX'] })
  })
  it('flags offsets and END instead of treating them as codes', () => {
    expect(matchDescription("3'O/S BLDG", dict)).toMatchObject({ offset: true, codes: [], unknown: [] })
    expect(matchDescription('END /FOC/EP', dict)).toMatchObject({ end: true, codes: ['FOC', 'EP'] })
  })
  it('reports unknown codes', () => {
    expect(matchDescription('STK', dict).unknown).toEqual(['STK'])
  })
})
