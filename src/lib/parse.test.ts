import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePoints } from './parse.ts'

const SAMPLE = readFileSync('samples/job-a.txt', 'latin1')

describe('parsePoints', () => {
  it('reads every line of the sample job with no warnings', () => {
    const { points, warnings } = parsePoints(SAMPLE)
    expect(warnings).toEqual([])
    expect(points).toHaveLength(202)
  })

  it('maps columns P,N,E,Z,D', () => {
    const [first] = parsePoints(SAMPLE).points
    expect(first).toMatchObject({ no: '100', n: 431626.252, e: 1943809.323, z: 1063.688, desc: 'IPF#1670/BASE' })
  })

  it('keeps a double quote inside a description', () => {
    const p = parsePoints(SAMPLE).points.find((x) => x.no === '293')
    expect(p?.desc).toBe('IE 12"PIPE')
  })

  it('keeps commas inside a description', () => {
    const { points } = parsePoints('1,10,20,5,FOO, BAR\n')
    expect(points[0].desc).toBe('FOO, BAR')
  })

  it('skips bad lines and says why, without failing the file', () => {
    const { points, warnings } = parsePoints('1,10,20,5,A\nnot a point\n2,x,20,5,B\n3,10,20,abc,C\n4,1,2,3,D\n')
    expect(points.map((p) => p.no)).toEqual(['1', '4'])
    expect(warnings.map((w) => w.line)).toEqual([2, 3, 4])
  })

  it('handles CRLF, BOM, blank lines and a missing elevation', () => {
    const { points, warnings } = parsePoints('﻿1,10,20,5,A\r\n\r\n2,11,21\r\n')
    expect(warnings).toEqual([])
    expect(points).toHaveLength(2)
    expect(points[1].z).toBe(0)
  })

  it('warns about duplicate point numbers but keeps them', () => {
    const { points, warnings } = parsePoints('1,1,1,1,A\n1,2,2,2,B\n')
    expect(points).toHaveLength(2)
    expect(warnings).toHaveLength(1)
  })
})
