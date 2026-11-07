import type { Call } from './deedcalls.ts'
import type { Anchor } from './deedfit.ts'
import { placeAll } from './deedplace.ts'
import type { Item, Result } from './deedplace.ts'
import { suggestRepairs } from './repair.ts'
import type { Repair } from './repair.ts'

/**
 * Where the deed arithmetic runs. In the browser it runs on a background thread (a Web Worker) and the page waits for the answer without
 * freezing; where there are no workers (tests, old browsers) it runs on the spot. The answers are the same either way.
 */
export interface DeedMath {
  place(items: Item[], anchors: Anchor[]): Promise<Result[]>
  repair(calls: Call[], statedAcres: number | null): Promise<Repair[]>
}

/** Runs the work in this thread: what the worker does, without the worker. */
export const inlineDeedMath: DeedMath = {
  place: async (items, anchors) => placeAll(items, anchors),
  repair: async (calls, statedAcres) => suggestRepairs(calls, statedAcres),
}

/** Runs the work in a Web Worker, started when first needed. A worker that fails to start falls back to running in this thread. */
export function workerDeedMath(start: () => Worker): DeedMath {
  let worker: Worker | null = null
  let broken = false
  let next = 1
  const waiting = new Map<number, (answer: unknown) => void>()

  const ensure = (): Worker | null => {
    if (broken) return null
    if (worker) return worker
    try {
      worker = start()
      worker.onmessage = (e: MessageEvent<{ id: number }>) => {
        waiting.get(e.data.id)?.(e.data)
        waiting.delete(e.data.id)
      }
      worker.onerror = () => {
        broken = true
        worker = null
        // whoever was waiting is answered by running the work here
        for (const [id, resolve] of waiting) resolve({ id, failed: true })
        waiting.clear()
      }
      return worker
    } catch {
      broken = true
      return null
    }
  }

  const ask = <T>(message: Record<string, unknown>, pick: (answer: Record<string, unknown>) => T, here: () => T): Promise<T> => {
    const w = ensure()
    if (!w) return Promise.resolve(here())
    const id = next++
    return new Promise<T>((resolve) => {
      waiting.set(id, (answer) => {
        const a = answer as Record<string, unknown>
        resolve(a.failed ? here() : pick(a))
      })
      w.postMessage({ ...message, id })
    })
  }

  return {
    place: (items, anchors) => ask({ kind: 'place', items, anchors }, (a) => a.results as Result[], () => placeAll(items, anchors)),
    repair: (calls, statedAcres) => ask({ kind: 'repair', calls, statedAcres }, (a) => a.repairs as Repair[], () => suggestRepairs(calls, statedAcres)),
  }
}
