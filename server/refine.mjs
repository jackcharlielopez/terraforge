// Checking a model's read with the app's own rules (src/lib/traverse.ts, run by Node's TypeScript stripping) and, when a description
// fails them, asking the model to read the page again. The model never gets to decide whether its read is right: the numbers are
// recomputed here, and a re-read can only ever be "check" in the app, never "ok".
import { assess } from '../src/lib/traverse.ts'

const asCalls = (t) => t.calls.map((c) => ({ ...c, unsure: c.deg === null }))

/** Verdict and misclosure of one tract as the app would judge it. */
export function judge(tract) {
  const a = assess(asCalls(tract), tract.statedAcres)
  return { verdict: a.verdict, reasons: a.reasons, misclosure: a.traverse ? a.traverse.misclosure : Infinity, perimeter: a.traverse ? a.traverse.perimeter : 0 }
}

/** Which tracts are worth a second look: enough calls to form a ring, and they fail the checks. */
export function failing(tracts) {
  return tracts.flatMap((t, index) => (t.calls.length >= 3 && judge(t).verdict === 'fail' ? [{ index, judged: judge(t) }] : []))
}

/** What the model is told: what the checks found, and where a ring usually goes wrong. Never what the answer should be. */
export function feedback(tracts, failed) {
  const lines = failed.map(({ index, judged }) => {
    const t = tracts[index]
    return `- "${t.label}" (${t.calls.length} calls): ${judged.reasons.join('; ')}.`
  })
  return `A check of your transcription found problems with these descriptions:
${lines.join('\n')}
Read those pages again, carefully and independently, for those descriptions only. Common causes: a line walked the other way round (then both letters flip, N<->S and E<->W, and the numbers stay), a line listed twice, a TOTAL listed together with its partial distances, a line-table entry used where it is not part of this boundary, a side left out, or a misread digit. Change a call only because the page prints something different from what you wrote; never adjust a number to make the figures work. If you cannot find the cause, return your reading unchanged.
Return ONLY JSON in the same shape, containing only those descriptions, with the same labels.`
}

/** Take a re-read only where it comes closer to closing; mark it so the app never calls it trusted. */
export function merge(tracts, again, failed) {
  const out = tracts.slice()
  for (const { index, judged } of failed) {
    const redo = again.find((t) => t.label === tracts[index].label) ?? again[failed.findIndex((f) => f.index === index)]
    if (!redo || redo.calls.length < 3) continue
    const now = judge(redo)
    if (now.misclosure < judged.misclosure) out[index] = { ...redo, statedAcres: redo.statedAcres ?? tracts[index].statedAcres, retried: true, firstMisclosure: judged.misclosure }
  }
  return out
}
