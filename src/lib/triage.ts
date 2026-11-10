import type { Call, DescriptionType } from './deedcalls.ts'
import type { Assessment, Verdict } from './traverse.ts'

/**
 * A read can close and match its acreage and still rest on a digit the reader was unsure of. Such a read is never trusted on the checks
 * alone: it becomes "check", with the reason, so the surveyor compares those calls with the page.
 */
export function applyConfidence(assessment: Assessment, calls: Call[]): Assessment {
  const low = calls.filter((c) => c.confidence === 'low')
  if (assessment.verdict !== 'ok' || low.length === 0) return assessment
  return { ...assessment, verdict: 'check', reasons: [`${low.length} ${low.length === 1 ? 'call was' : 'calls were'} read with low confidence: compare with the page`] }
}

/** The best read among a deed's descriptions, for its badge: OK beats Check beats Not trusted. */
export function bestVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.includes('ok')) return 'ok'
  if (verdicts.includes('check')) return 'check'
  return 'fail'
}

/**
 * Where a deed goes in the list: what needs the surveyor first. A deed that could not be read, then one that failed its checks, then one
 * to check, then trusted reads, then deeds with nothing to draw, and last the ones still being read.
 */
export function deedRank(status: 'idle' | 'reading' | 'done' | 'error', verdicts: Verdict[], calls: number): number {
  if (status === 'error') return 0
  if (status !== 'done') return 5
  if (verdicts.length === 0 || calls === 0) return 4
  return { fail: 1, check: 2, ok: 3 }[bestVerdict(verdicts)]
}

/** The deeds that still need the AI reader: those without an AI read yet (an error or an unread deed counts; a deed already read by the AI is never sent again). */
export function deedsNeedingAi<T extends { id: string }>(deeds: T[], methodOf: (id: string) => string | undefined): T[] {
  return deeds.filter((d) => methodOf(d.id) !== 'AI')
}

/** What to say about a description that has no bearings and distances, from what the reader says it is. */
export function noCallsMessage(type: DescriptionType | undefined): string {
  switch (type) {
    case 'lot_reference':
      return 'Described as a lot of a recorded plat: no bearings and distances here. Add the plat to draw it.'
    case 'exhibit_referenced':
      return 'Described by an attached exhibit: no bearings and distances in the text. Add the exhibit.'
    case 'aliquot':
      return 'Described by section and quarter-section: no bearings and distances to draw.'
    case 'words_only':
    case 'centerline':
    case 'blanket':
    case 'facility_relative':
      return 'Described in words only: no bearings and distances to draw.'
    default:
      return 'No bearings and distances found.'
  }
}
