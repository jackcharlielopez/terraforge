import { describe, expect, it } from 'vitest'
import type { Call } from './deedcalls.ts'
import { applyConfidence, bestVerdict, deedRank, deedsNeedingAi, noCallsMessage } from './triage.ts'
import type { Assessment } from './traverse.ts'

const call = (confidence?: Call['confidence']): Call => ({ ns: 'N', ew: 'E', deg: 1, min: 0, sec: 0, distance: 10, unsure: false, text: '', confidence })
const ok: Assessment = { verdict: 'ok', reasons: [], traverse: null }

describe('applyConfidence', () => {
  it('turns a trusted read with a low-confidence call into a check, and says why', () => {
    const a = applyConfidence(ok, [call('high'), call('low'), call('low')])
    expect(a.verdict).toBe('check')
    expect(a.reasons[0]).toMatch(/2 calls were read with low confidence/)
  })
  it('leaves clear reads, unrated reads and failures alone', () => {
    expect(applyConfidence(ok, [call('high'), call('medium'), call()])).toBe(ok)
    const fail: Assessment = { verdict: 'fail', reasons: ['x'], traverse: null }
    expect(applyConfidence(fail, [call('low')])).toBe(fail)
  })
})

describe('deedRank', () => {
  it('puts what needs the surveyor first, trusted reads after, and unfinished last', () => {
    const order = [deedRank('done', ['ok'], 4), deedRank('error', [], 0), deedRank('reading', [], 0), deedRank('done', ['fail'], 4), deedRank('done', [], 0), deedRank('done', ['check', 'fail'], 4)]
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
    expect(order).toEqual([3, 0, 5, 1, 4, 2])
  })
  it('judges a deed by its best description', () => {
    expect(bestVerdict(['fail', 'ok'])).toBe('ok')
    expect(bestVerdict(['fail', 'check'])).toBe('check')
    expect(bestVerdict(['fail'])).toBe('fail')
  })
})

describe('noCallsMessage', () => {
  it('explains a lot reference and an easement in words', () => {
    expect(noCallsMessage('lot_reference')).toMatch(/Add the plat/)
    expect(noCallsMessage('words_only')).toMatch(/words only/)
    expect(noCallsMessage(undefined)).toBe('No bearings and distances found.')
  })
})

describe('deedsNeedingAi', () => {
  it('leaves out deeds the AI has already read, so a click never pays twice, and keeps failed and unread ones', () => {
    const method: Record<string, string | undefined> = { a: 'AI', b: undefined, c: 'OCR', d: 'AI', e: undefined }
    expect(deedsNeedingAi([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }], (id) => method[id]).map((d) => d.id)).toEqual(['b', 'c', 'e'])
  })
})
