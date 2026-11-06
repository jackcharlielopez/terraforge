import type { Call } from './deedcalls.ts'
import { label } from './deedlabels.ts'

export interface Comparison {
  /** Calls identical in both, in order. */
  agree: number
  total: number
  /** Calls that differ, paired in order: what this deed says against what the other says (null where only one has a call). */
  differences: Array<{ here: string | null; there: string | null }>
}

const key = (c: Call) => `${c.ns}${c.deg}:${c.min}:${c.sec}${c.ew}${c.distance.toFixed(2)}`

/**
 * Do two deeds describe the same land? Later deeds usually copy an earlier description, and the copy often drifts (a digit changed, a
 * call dropped or repeated). Aligns the two lists of calls and, when most agree, says what does not. Returns null for unrelated descriptions.
 */
export function compareCalls(here: Call[], there: Call[]): Comparison | null {
  const n = here.length
  const m = there.length
  if (n < 3 || m < 3) return null
  // longest common run of identical calls
  const lcs = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = key(here[i]) === key(there[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const agree = lcs[0][0]
  if (agree < 3 || agree / Math.max(n, m) < 0.5) return null
  const onlyHere: string[] = []
  const onlyThere: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (key(here[i]) === key(there[j])) {
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) onlyHere.push(label(here[i++]))
    else onlyThere.push(label(there[j++]))
  }
  while (i < n) onlyHere.push(label(here[i++]))
  while (j < m) onlyThere.push(label(there[j++]))
  const pairs = Math.max(onlyHere.length, onlyThere.length)
  return {
    agree,
    total: Math.max(n, m),
    differences: Array.from({ length: pairs }, (_, k) => ({ here: onlyHere[k] ?? null, there: onlyThere[k] ?? null })),
  }
}
