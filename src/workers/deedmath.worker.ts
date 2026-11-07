/**
 * The deed arithmetic that can take a while (placing outlines on the pins, searching for a one-digit repair) runs here, on a background
 * thread, so the page stays responsive however big the parcel. It talks to the page by messages: a request with an id in, the answer
 * with the same id out. The functions themselves live in src/lib and are tested there.
 */
import { placeAll } from '../lib/deedplace.ts'
import type { Item } from '../lib/deedplace.ts'
import type { Anchor } from '../lib/deedfit.ts'
import type { Call } from '../lib/deedcalls.ts'
import { suggestRepairs } from '../lib/repair.ts'

export type Request =
  | { kind: 'place'; id: number; items: Item[]; anchors: Anchor[] }
  | { kind: 'repair'; id: number; calls: Call[]; statedAcres: number | null }

const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage: (message: unknown) => void }

scope.onmessage = (e) => {
  const m = e.data
  if (m.kind === 'place') scope.postMessage({ kind: 'place', id: m.id, results: placeAll(m.items, m.anchors) })
  else scope.postMessage({ kind: 'repair', id: m.id, repairs: suggestRepairs(m.calls, m.statedAcres) })
}
