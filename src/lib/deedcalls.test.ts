import { describe, expect, it } from 'vitest'
import { boundaryCalls, extractCalls, normalizeText, readDescription, repairByReciprocal, statedAcres } from './deedcalls.ts'

// Invented descriptions; none is taken from a real deed.
const CLEAN =
  'Beginning at an iron pin in the north line of Pine Road; thence South 04 degrees 00 minutes 00 seconds West 200.00 feet to an iron pin; thence North 86 degrees 00 minutes 00 seconds West 150.00 feet to a stake; thence North 04 degrees 00 minutes 00 seconds East 200.00 feet to a stake; thence South 86 degrees 00 minutes 00 seconds East 150.00 feet to the point of beginning, containing 0.69 acres, more or less.'

describe('reading calls', () => {
  it('reads each bearing and distance of a typed description, in order', () => {
    const calls = boundaryCalls(CLEAN)
    expect(calls.map((c) => [c.ns, c.deg, c.ew, c.distance])).toEqual([
      ['S', 4, 'W', 200],
      ['N', 86, 'W', 150],
      ['N', 4, 'E', 200],
      ['S', 86, 'E', 150],
    ])
  })
  it('reads degree marks, fractions of a degree, a comma used as a decimal point, and words between the bearing and the distance', () => {
    const [a, b, c] = extractCalls(`thence North 87 1/4 degrees West 2000 feet; thence S 35° 45' 30" E 387,1 feet; thence North 88° East along the south margin of the road 100 feet`)
    expect([a.deg, a.min, a.distance]).toEqual([87.25, 0, 2000])
    expect([b.deg, b.min, b.sec, b.distance]).toEqual([35, 45, 30, 387.1])
    expect([c.ew, c.distance]).toEqual(['E', 100])
  })
  it('puts up with what OCR does: stray marks, a § for S, a mangled East, dashes between the numbers', () => {
    const calls = extractCalls(`Thence § 35° -45' East 387,1 feet; Thence South ! 86 deg FgEagt 238 feet; Thence South 45° "00' East 154.9 feet; Thence Northeast 36° - 30' East 357.20 feet`)
    expect(calls.map((c) => [c.ns, c.deg, c.min, c.ew, c.distance])).toEqual([
      ['S', 35, 45, 'E', 387.1],
      ['S', 86, 0, 'E', 238],
      ['S', 45, 0, 'E', 154.9],
      ['N', 36, 30, 'E', 357.2],
    ])
  })
  it('leaves out a commencing tie, parenthetical witness calls, and what comes after "containing"', () => {
    const text =
      'Commencing at an iron rod; thence South 45 degrees 00 minutes 00 seconds East 98.42 feet to the TRUE POINT OF BEGINNING; thence North 10 degrees 00 minutes East 50.00 feet to a post (from which a rod lies North 7 degrees East 29.79 feet); thence South 80 degrees East 40 feet; thence South 10 degrees West 50 feet; thence North 80 degrees West 40 feet to the true point of beginning, containing 0.05 acres. Subject to a line North 12 degrees East 500 feet.'
    const calls = boundaryCalls(text)
    expect(calls.map((c) => c.distance)).toEqual([50, 40, 50, 40])
  })
  it('fills in an unreadable bearing from the opposite side, and says so', () => {
    const calls = boundaryCalls('Beginning at a stake; thence South 4 degrees West 200 feet; thence North 86 degrees West 150 feet; thence North % degrees East 200 feet; thence South 86 degrees East 150 feet to the beginning.')
    expect(calls[2]).toMatchObject({ ns: 'N', deg: 4, ew: 'E', unsure: false })
    expect(calls[2].inferred).toMatch(/opposite side/)
    expect(calls.filter((c) => c.inferred)).toHaveLength(1)
  })
  it('leaves a bearing unsure when nothing can stand in for it', () => {
    const calls = repairByReciprocal(extractCalls('thence North % degrees East 123 feet; thence South 10 degrees West 999 feet'))
    expect(calls[0].unsure).toBe(true)
    expect(calls[0].deg).toBeNull()
  })
  it('ignores a bearing with no distance and an east/west that is not a direction word', () => {
    expect(extractCalls('thence North 4 degrees East to the creek; thence North 4 degrees Elbow 20 feet')).toEqual([])
  })
  it('normalises text without changing what it says', () => {
    expect(normalizeText('S 4° 30\' W')).toContain('4 deg')
  })
})

describe('stated acreage', () => {
  it('reads decimals, mixed fractions, and the figure after "containing"', () => {
    expect(statedAcres('to the beginning, containing 1.26 acres, as surveyed')).toBe(1.26)
    expect(statedAcres('containing 46-7/10 acres, more or less')).toBeCloseTo(46.7)
    expect(statedAcres('a tract of 3.26 acres')).toBe(3.26)
    expect(statedAcres('no figure here')).toBeNull()
  })
})

describe('tracts', () => {
  const TWO = `TRACT 1: ${CLEAN} TRACT 2: Beginning at a post; thence South 02 degrees East 300 feet; thence South 88 degrees West 100 feet; thence North 02 degrees West 300 feet; thence North 88 degrees East 100 feet to the beginning, containing 0.69 acres.`
  it('splits a deed into its tracts and reads each', () => {
    const tracts = readDescription(TWO)
    expect(tracts.map((t) => t.label)).toEqual(['Tract 1', 'Tract 2'])
    expect(tracts.map((t) => t.calls.length)).toEqual([4, 4])
    expect(tracts[0].statedAcres).toBe(0.69)
  })
  it('treats a description with no heading as one tract, and does not split on a mention of "the Hood tract"', () => {
    const one = readDescription(`Being the Hood tract as of record in Book 5, page 6. ${CLEAN}`)
    expect(one).toHaveLength(1)
    expect(one[0].label).toBe('Description')
  })
  it('drops pieces with too few calls', () => {
    expect(readDescription('PARCEL NO. 1 is described in another deed. PARCEL NO. 2: ' + CLEAN).map((t) => t.label)).toEqual(['Parcel 2'])
  })
})
