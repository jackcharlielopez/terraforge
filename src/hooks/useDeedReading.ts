import { useEffect, useMemo, useRef, useState } from 'react'
import { fitOutline } from '../lib/deedfit.ts'
import type { Anchor, Placement } from '../lib/deedfit.ts'
import { readDescription } from '../lib/deedcalls.ts'
import type { Call } from '../lib/deedcalls.ts'
import { compareCalls } from '../lib/deedcompare.ts'
import type { Comparison } from '../lib/deedcompare.ts'
import { outline } from '../lib/boundary.ts'
import type { Boundary } from '../lib/boundary.ts'
import { readDeedText } from '../lib/ocr.ts'
import type { ReadProgress } from '../lib/ocr.ts'
import { assess } from '../lib/traverse.ts'
import type { Assessment } from '../lib/traverse.ts'
import type { Deed } from './useDeed.ts'

export interface ReadTract {
  label: string
  calls: Call[]
  statedAcres: number | null
  assessment: Assessment
}

export interface ReadState {
  status: 'idle' | 'reading' | 'done' | 'error'
  progress: ReadProgress | null
  error: string
  info: { method: string; pages: number; characters: number } | null
  tracts: ReadTract[]
  selected: number
}

const IDLE: ReadState = { status: 'idle', progress: null, error: '', info: null, tracts: [], selected: 0 }

export type PlaceResult = { ok: true; placement: Placement } | { ok: false; message: string }

export interface Placed {
  deedId: string
  deedName: string
  tract: string
  result: PlaceResult
}

/** Where a deed's selected description reads the same as another deed's, and what differs. */
export interface Agreement {
  otherId: string
  otherName: string
  otherTract: string
  comparison: Comparison
}

/**
 * Reading the attached deeds and placing one outline on the drawing. Each deed is read on its own (the PDF's text layer, or OCR),
 * its calls pulled out by plain rules and checked for closure and the stated acreage. Only a read that passes is drawn, and only
 * when enough found pins lie on it. Deeds that describe the same land are compared, since copies drift.
 */
export function useDeedReading(deeds: Deed[]) {
  const [reads, setReads] = useState<Record<string, ReadState>>({})
  const [placed, setPlaced] = useState<Placed | null>(null)
  const tokens = useRef<Record<string, number>>({})
  const present = useRef(new Set<string>())
  useEffect(() => {
    present.current = new Set(deeds.map((d) => d.id))
  }, [deeds])

  const patch = (id: string, change: Partial<ReadState>) => setReads((r) => ({ ...r, [id]: { ...(r[id] ?? IDLE), ...change } }))
  const stateOf = (id: string): ReadState => reads[id] ?? IDLE

  const read = async (deed: Deed) => {
    const mine = (tokens.current[deed.id] = (tokens.current[deed.id] ?? 0) + 1)
    const current = () => tokens.current[deed.id] === mine && present.current.has(deed.id)
    patch(deed.id, { status: 'reading', error: '', progress: null })
    setPlaced((p) => (p?.deedId === deed.id ? null : p))
    try {
      const blob = await (await fetch(deed.url)).blob()
      const result = await readDeedText(blob, deed.type || blob.type, (p) => {
        if (current()) patch(deed.id, { progress: p })
      })
      if (!current()) return
      const tracts = readDescription(result.text).map((t): ReadTract => ({ ...t, assessment: assess(t.calls, t.statedAcres) }))
      // start on the best read: one that passes, else the first
      const best = tracts.findIndex((t) => t.assessment.verdict !== 'fail')
      patch(deed.id, { status: 'done', tracts, selected: Math.max(best, 0), info: { method: result.method, pages: result.pages, characters: result.text.length } })
    } catch (err) {
      if (current()) patch(deed.id, { status: 'error', error: err instanceof Error ? err.message : 'The deed could not be read.' })
    }
  }

  /** Read every deed not yet read, one after another (OCR is heavy; running them together would freeze the page). */
  const readAll = async () => {
    for (const d of deeds) {
      if (!present.current.has(d.id)) continue
      const s = stateOf(d.id)
      if (s.status === 'idle' || s.status === 'error') await read(d)
    }
  }

  const select = (id: string, tract: number) => {
    patch(id, { selected: tract })
    setPlaced((p) => (p?.deedId === id ? null : p))
  }

  /** Fit the selected description of a deed to the pins and keep the result as the one placed outline. */
  const place = (deed: Deed, anchors: Anchor[]) => {
    const s = stateOf(deed.id)
    const t = s.tracts[s.selected]
    const tr = t?.assessment.traverse
    if (!t || !tr || t.assessment.verdict === 'fail') return
    // a description that closes ends where it began: its last corner repeats the first
    const closes = tr.misclosure < Math.max(2, tr.perimeter / 100)
    const placement = fitOutline(closes ? tr.vertices.slice(0, -1) : tr.vertices, anchors)
    setPlaced({
      deedId: deed.id,
      deedName: deed.name,
      tract: t.label,
      result: placement
        ? { ok: true, placement }
        : { ok: false, message: `Could not place it: fewer than three found pins lie on its lines, not all on one line${anchors.length < 3 ? ` (only ${anchors.length} found pins or monuments in the points)` : ''}. Nothing was drawn.` },
    })
  }

  // a removed deed takes its outline with it
  const livePlaced = placed && deeds.some((d) => d.id === placed.deedId) ? placed : null
  const outlineBoundary: Boundary | null = useMemo(() => {
    if (!livePlaced?.result.ok) return null
    return outline(livePlaced.result.placement.vertices.map((v, i) => ({ e: v.e, n: v.n, z: 0, name: String(i + 1) })))
  }, [livePlaced])

  /** Other deeds that describe the same land as this deed's selected description, and where they differ. */
  const agreements = (id: string): Agreement[] => {
    const mine = stateOf(id).tracts[stateOf(id).selected]
    if (!mine) return []
    const out: Agreement[] = []
    for (const d of deeds) {
      if (d.id === id) continue
      for (const t of stateOf(d.id).tracts) {
        const comparison = compareCalls(mine.calls, t.calls)
        if (comparison) out.push({ otherId: d.id, otherName: d.name, otherTract: t.label, comparison })
      }
    }
    return out
  }

  return {
    stateOf,
    read,
    readAll,
    select,
    place,
    placed: livePlaced,
    unplace: () => setPlaced(null),
    agreements,
    /** Forget what was read for a removed deed. */
    forget: (id: string) => {
      tokens.current[id] = (tokens.current[id] ?? 0) + 1
      setReads((r) => {
        const { [id]: _gone, ...rest } = r
        return rest
      })
    },
    /** The outline to draw as the property line, or null. */
    outline: outlineBoundary,
  }
}
