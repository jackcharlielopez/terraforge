import { useCallback, useEffect, useMemo, useState } from 'react'
import { EMPTY_EDITS, edgeKey, fingerprint } from '../lib/review.ts'
import type { EdgeKey, ReviewEdits, ReviewEvent, Segment } from '../lib/review.ts'
import type { SurveyPoint } from '../lib/types.ts'

const STORAGE_PREFIX = 'terraforge.review.v1.'

interface Stored {
  fp: string
  edits: ReviewEdits
  events: ReviewEvent[]
  /** Earlier states of `edits`, for Undo (not kept between sessions). */
  past: ReviewEdits[]
}

function load(fp: string): Stored {
  const empty: Stored = { fp, edits: EMPTY_EDITS, events: [], past: [] }
  if (!fp) return empty
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + fp)
    if (!raw) return empty
    const v = JSON.parse(raw) as { edits?: Partial<ReviewEdits>; events?: ReviewEvent[] }
    return {
      fp,
      edits: { accepted: v.edits?.accepted ?? [], rejected: v.edits?.rejected ?? [], added: v.edits?.added ?? [] },
      events: Array.isArray(v.events) ? v.events : [],
      past: [],
    }
  } catch {
    return empty
  }
}

export type ReviewTool = 'select' | 'add'

/**
 * Review mode: the drafter looks over the generated drawing, keeps or removes segments and draws in ones that are missing.
 * Every change is kept in a log, on this computer only (browser storage, per points file), so it survives a reload and can be
 * exported as a file. Nothing is sent anywhere.
 */
export function useReview(points: SurveyPoint[]) {
  const fp = useMemo(() => (points.length > 0 ? fingerprint(points) : ''), [points])
  const [active, setActive] = useState(false)
  const [tool, setTool] = useState<ReviewTool>('select')
  const [selected, setSelected] = useState<EdgeKey | null>(null)
  const [addFrom, setAddFrom] = useState<number | null>(null)
  const [store, setStore] = useState<Stored>(() => load(fp))
  // A different points file has its own review: switch to it while rendering (no stale frame, no effect).
  if (store.fp !== fp) {
    setStore(load(fp))
    setSelected(null)
    setAddFrom(null)
  }

  useEffect(() => {
    if (!store.fp) return
    try {
      localStorage.setItem(STORAGE_PREFIX + store.fp, JSON.stringify({ edits: store.edits, events: store.events }))
    } catch {
      /* private window or storage full: the review still works for this session */
    }
  }, [store.fp, store.edits, store.events])

  const record = useCallback(
    (edits: ReviewEdits, event: Omit<ReviewEvent, 't'>) => {
      setStore((s) => ({ ...s, edits, events: [...s.events, { ...event, t: Date.now() }], past: [...s.past, s.edits] }))
    },
    [],
  )
  const ev = (type: ReviewEvent['type'], a: number, b: number, layer: string, source: ReviewEvent['source']): Omit<ReviewEvent, 't'> => ({
    type,
    a: points[a].no,
    b: points[b].no,
    layer,
    source,
  })

  const accept = (seg: Segment, source: 'rule' | 'guess' | 'manual') => {
    if (store.edits.accepted.includes(seg.key)) return
    record({ ...store.edits, accepted: [...store.edits.accepted, seg.key] }, ev('accept', seg.a, seg.b, seg.layer, source))
  }
  const reject = (seg: Segment, source: 'rule' | 'guess' | 'manual') => {
    const e = store.edits
    const accepted = e.accepted.filter((k) => k !== seg.key)
    const next: ReviewEdits =
      source === 'manual'
        ? { ...e, accepted, added: e.added.filter((x) => edgeKey(x.a, x.b) !== seg.key) }
        : { ...e, accepted, rejected: e.rejected.includes(seg.key) ? e.rejected : [...e.rejected, seg.key] }
    record(next, ev('reject', seg.a, seg.b, seg.layer, source))
    setSelected(null)
  }
  const add = (a: number, b: number, layer: string) => {
    const key = edgeKey(a, b)
    const e = store.edits
    if (e.added.some((x) => edgeKey(x.a, x.b) === key)) return
    // putting back a segment that was removed just un-removes it
    const next: ReviewEdits = e.rejected.includes(key) ? { ...e, rejected: e.rejected.filter((k) => k !== key) } : { ...e, added: [...e.added, { a, b, layer }] }
    record(next, ev('add', a, b, layer, 'manual'))
    setAddFrom(null)
  }
  const undo = () => {
    setStore((s) => {
      if (s.past.length === 0) return s
      const last = s.events[s.events.length - 1]
      return { ...s, edits: s.past[s.past.length - 1], past: s.past.slice(0, -1), events: [...s.events, { ...last, type: 'undo', t: Date.now() }] }
    })
    setSelected(null)
  }
  const clear = () => {
    setStore((s) => ({ ...s, edits: EMPTY_EDITS, events: [], past: [] }))
    setSelected(null)
    setAddFrom(null)
  }

  return {
    active,
    setActive,
    tool,
    setTool: (t: ReviewTool) => {
      setTool(t)
      setAddFrom(null)
    },
    selected,
    setSelected,
    addFrom,
    setAddFrom,
    edits: store.edits,
    events: store.events,
    canUndo: store.past.length > 0,
    accept,
    reject,
    add,
    undo,
    clear,
  }
}
