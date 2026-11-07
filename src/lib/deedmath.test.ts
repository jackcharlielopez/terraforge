import { describe, expect, it } from 'vitest'
import { boundaryCalls } from './deedcalls.ts'
import { inlineDeedMath, workerDeedMath } from './deedmath.ts'
import { placeAll } from './deedplace.ts'
import { suggestRepairs } from './repair.ts'

const calls = boundaryCalls('Beginning at a stake; thence South 04 degrees West 257 feet; thence North 86 degrees West 200 feet; thence North 04 degrees East 275 feet; thence South 86 degrees East 200 feet to the beginning.')
const items = [{ key: 'a', corners: [{ e: 0, n: 0 }, { e: 200, n: 0 }, { e: 200, n: -300 }, { e: 0, n: -300 }] }]

describe('the deed arithmetic, in this thread', () => {
  it('gives the same answers as the functions it wraps', async () => {
    expect(await inlineDeedMath.repair(calls, 1.26)).toEqual(suggestRepairs(calls, 1.26))
    expect(await inlineDeedMath.place(items, [])).toEqual(placeAll(items, []))
  })
})

describe('the deed arithmetic, through a worker', () => {
  // a stand-in for the worker: answers a request by message, as the real one does
  const fakeWorker = () => {
    const w = { onmessage: null as ((e: MessageEvent) => void) | null, onerror: null as (() => void) | null, postMessage(m: Record<string, unknown>) {
      queueMicrotask(() => w.onmessage?.({ data: m.kind === 'place' ? { kind: 'place', id: m.id, results: placeAll(m.items as never, m.anchors as never) } : { kind: 'repair', id: m.id, repairs: suggestRepairs(m.calls as never, m.statedAcres as never) } } as MessageEvent))
    } }
    return w as unknown as Worker
  }
  it('sends the work as messages and matches each answer to its request', async () => {
    const math = workerDeedMath(fakeWorker)
    const [a, b] = await Promise.all([math.repair(calls, 1.26), math.place(items, [])])
    expect(a).toEqual(suggestRepairs(calls, 1.26))
    expect(b).toEqual(placeAll(items, []))
  })
  it('falls back to running here when the worker cannot be started', async () => {
    const math = workerDeedMath(() => {
      throw new Error('no workers')
    })
    expect(await math.repair(calls, 1.26)).toEqual(suggestRepairs(calls, 1.26))
  })
  it('falls back for a request in flight when the worker dies', async () => {
    let dead: (() => void) | null = null
    const math = workerDeedMath(() => {
      const w = { onmessage: null, onerror: null as (() => void) | null, postMessage() {} }
      dead = () => w.onerror?.()
      return w as unknown as Worker
    })
    const answer = math.repair(calls, 1.26)
    ;(dead as unknown as () => void)()
    expect(await answer).toEqual(suggestRepairs(calls, 1.26))
  })
})
