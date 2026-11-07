import { describe, expect, it } from 'vitest'
import { classifyFile, EMPTY_STAGED, formatSize, groupFiles, MAX_BYTES, stageFiles } from './files.ts'

describe('classifyFile', () => {
  it('sorts files by extension, case-insensitively', () => {
    expect(classifyFile('123 MAIN ST.txt')).toBe('points')
    expect(classifyFile('job.CSV')).toBe('points')
    expect(classifyFile('acme.terraforge-codes.json')).toBe('unknown') // dictionaries are no longer loaded
    expect(classifyFile('456 OAK RD.asc')).toBe('points')
    expect(classifyFile('Deed 420-265.PDF')).toBe('deed')
    expect(classifyFile('scan.jpeg')).toBe('deed')
    expect(classifyFile('scan.tif')).toBe('deed')
    expect(classifyFile('finished drawing.DXF')).toBe('reference')
  })
  it('does not guess for anything else', () => {
    expect(classifyFile('drawing.dwg')).toBe('unknown')
    expect(classifyFile('noextension')).toBe('unknown')
    expect(classifyFile('.hidden')).toBe('unknown')
  })
})

describe('formatSize', () => {
  it('uses a sensible unit', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(8664)).toBe('8 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

const file = (name: string, size = 10) => ({ name, size }) as File

describe('groupFiles', () => {
  it('picks one file per kind and notes extras and unknowns', () => {
    const { picked, notes } = groupFiles([file('a.txt'), file('b.txt'), file('c.json'), file('d.dwg')])
    expect(picked.points?.name).toBe('a.txt')
    expect(notes).toHaveLength(3)
    expect(notes.join(' ')).toMatch(/ignored 1 other survey points/i)
    expect(notes.join(' ')).toMatch(/Skipped "d.dwg"/)
    expect(notes.join(' ')).toMatch(/Skipped "c.json"/)
  })
  it('keeps every deed, but only the first points file and the first comparison drawing', () => {
    const { picked, deeds, notes } = groupFiles([file('a.pdf'), file('b.pdf'), file('scan.png'), file('p1.txt'), file('p2.txt'), file('x.dxf'), file('y.dxf')])
    expect(deeds.map((d) => d.name)).toEqual(['a.pdf', 'b.pdf', 'scan.png'])
    expect(picked.points?.name).toBe('p1.txt')
    expect(picked.reference?.name).toBe('x.dxf')
    expect(notes).toHaveLength(2)
  })
  it('leaves out only the deeds that are too big', () => {
    const { deeds, notes } = groupFiles([file('ok.pdf'), file('huge.pdf', MAX_BYTES.deed + 1)])
    expect(deeds.map((d) => d.name)).toEqual(['ok.pdf'])
    expect(notes.join(' ')).toMatch(/Skipped "huge.pdf"/)
  })
  it('lets a slot picker force the kind regardless of extension', () => {
    expect(groupFiles([file('notes.dat')], 'points').picked.points?.name).toBe('notes.dat')
  })
  it('leaves out over-size files with a note', () => {
    const { picked, notes } = groupFiles([file('big.txt', MAX_BYTES.points + 1)])
    expect(picked.points).toBeUndefined()
    expect(notes[0]).toMatch(/Skipped "big.txt": over/)
  })
})

describe('stageFiles (the start screen: files wait until "Start survey")', () => {
  it('holds the points file, the comparison drawing and every deed, without reading any of them', () => {
    const { staged, notes } = stageFiles(EMPTY_STAGED, [file('job.txt'), file('final.dxf'), file('a.pdf'), file('b.pdf')])
    expect(staged.points?.name).toBe('job.txt')
    expect(staged.reference?.name).toBe('final.dxf')
    expect(staged.deeds.map((d) => d.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(notes).toEqual([])
  })
  it('lets a new points file or drawing replace the staged one, and adds deeds to the ones already there', () => {
    const first = stageFiles(EMPTY_STAGED, [file('old.txt'), file('a.pdf')]).staged
    const { staged } = stageFiles(first, [file('new.asc'), file('b.pdf')])
    expect(staged.points?.name).toBe('new.asc')
    expect(staged.deeds.map((d) => d.name)).toEqual(['a.pdf', 'b.pdf'])
  })
  it('does not add the same deed twice, and says so', () => {
    const first = stageFiles(EMPTY_STAGED, [file('a.pdf')]).staged
    const { staged, notes } = stageFiles(first, [file('a.pdf'), file('c.pdf')])
    expect(staged.deeds.map((d) => d.name)).toEqual(['a.pdf', 'c.pdf'])
    expect(notes.join(' ')).toMatch(/already added/)
  })
  it('keeps what was staged when an unknown file is dropped', () => {
    const first = stageFiles(EMPTY_STAGED, [file('job.txt')]).staged
    const { staged, notes } = stageFiles(first, [file('notes.docx')])
    expect(staged.points?.name).toBe('job.txt')
    expect(notes.join(' ')).toMatch(/Skipped "notes.docx"/)
  })
})
