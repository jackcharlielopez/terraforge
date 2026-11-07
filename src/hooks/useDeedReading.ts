import { useEffect, useMemo, useRef, useState } from 'react'
import { inlineDeedMath, workerDeedMath } from '../lib/deedmath.ts'
import type { Result } from '../lib/deedplace.ts'
import type { Anchor } from '../lib/deedfit.ts'
import { readDescription } from '../lib/deedcalls.ts'
import type { Call, Tract } from '../lib/deedcalls.ts'
import { compareCalls } from '../lib/deedcompare.ts'
import type { Comparison } from '../lib/deedcompare.ts'
import { outline } from '../lib/boundary.ts'
import type { Boundary } from '../lib/boundary.ts'
import { processDeeds } from '../lib/airead.ts'
import { readDeedText } from '../lib/ocr.ts'
import type { ReadProgress } from '../lib/ocr.ts'
import { applyRepair } from '../lib/repair.ts'
import type { Repair } from '../lib/repair.ts'
import { assess } from '../lib/traverse.ts'
import type { Assessment } from '../lib/traverse.ts'
import type { Deed } from './useDeed.ts'

export interface ReadTract {
  label: string
  calls: Call[]
  statedAcres: number | null
  assessment: Assessment
  /** For a read that does not close: single edits that would make it close (see `repair.ts`). Empty when none, or too many to tell. */
  repairs: Repair[]
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

/** Where a deed's selected description reads the same as another deed's, and what differs. */
export interface Agreement {
  otherId: string
  otherName: string
  otherTract: string
  comparison: Comparison
}

/** One description that passed its checks, as an outline on the drawing. */
export interface DrawnOutline {
  key: string
  /** The deed and description it comes from, for showing. */
  name: string
  /** The user has unticked it. */
  hidden: boolean
  /** Still being placed on a background thread. */
  pending: boolean
  /** False when the read failed its checks: the outline is drawn, but as unverified. */
  trusted: boolean
  /** The read closes on itself (drawn as a closed outline); otherwise it is drawn open so the gap shows. */
  closes: boolean
  result: Result
}

const keyOf = (deedId: string, tract: number) => `${deedId}#${tract}`
const NO_RESULTS: Result[] = []

/** The deed arithmetic (placing outlines, searching for repairs) runs on a background thread where the browser has one, so the page never freezes on a big parcel. */
const deedMath =
  typeof Worker === 'undefined' ? inlineDeedMath : workerDeedMath(() => new Worker(new URL('../workers/deedmath.worker.ts', import.meta.url), { type: 'module' }))

/**
 * Reading the attached deeds, and drawing every description that passes. Each deed is read on its own in the background (the PDF's text
 * layer, or OCR), its calls pulled out by plain rules and checked for closure and the stated acreage. Every description that passes is
 * placed automatically, first on the found pins and then, for neighbours with no pins of their own, along a line shared with an outline
 * already placed; the surveyor unticks what should not be drawn. Deeds that describe the same land are compared, since copies drift.
 */
export function useDeedReading(deeds: Deed[], anchors: Anchor[]) {
  // Results change only when a read starts, finishes or is repaired, so progress and the chosen description are kept apart:
  // placing outlines is the slow part and must not rerun on every progress tick.
  const [reads, setReads] = useState<Record<string, ReadState>>({})
  const [progress, setProgress] = useState<Record<string, ReadProgress | null>>({})
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(new Set())
  const tokens = useRef<Record<string, number>>({})
  const present = useRef(new Set<string>())
  const deedsRef = useRef<Deed[]>([])
  const readsRef = useRef<Record<string, ReadState>>({})
  const attempted = useRef(new Set<string>())
  const draining = useRef(false)
  // the background reader works from refs, brought up to date after each render and before it is started
  useEffect(() => {
    present.current = new Set(deeds.map((d) => d.id))
    deedsRef.current = deeds
  }, [deeds])
  useEffect(() => {
    readsRef.current = reads
  }, [reads])

  const patch = (id: string, change: Partial<ReadState>) => setReads((r) => ({ ...r, [id]: { ...(r[id] ?? IDLE), ...change } }))
  const stateOf = (id: string): ReadState => ({ ...(reads[id] ?? IDLE), progress: progress[id] ?? null, selected: chosen[id] ?? reads[id]?.selected ?? 0 })

  /** Check each description (closure, acreage) and, for one that fails, search for one-digit repairs on the background thread. */
  const toReadTracts = async (found: (Tract & { retried?: boolean })[]): Promise<ReadTract[]> => {
    const tracts: ReadTract[] = []
    for (const t of found) {
      let assessment = assess(t.calls, t.statedAcres)
      // a description the AI had to read a second time is never trusted on the checks alone: it closes now, but a model that was told what
      // was wrong could have changed a digit to fit, so the surveyor compares it with the page
      if (t.retried && assessment.verdict === 'ok') assessment = { ...assessment, verdict: 'check', reasons: ['Re-read by the AI after failing a check: compare with the page'] }
      tracts.push({ label: t.label, calls: t.calls, statedAcres: t.statedAcres, assessment, repairs: assessment.verdict === 'fail' ? await deedMath.repair(t.calls, t.statedAcres) : [] })
    }
    return tracts
  }

  const [aiBusy, setAiBusy] = useState(false)
  const aiRunning = useRef(false)
  /** Deeds whose reads came from the AI: OCR never writes over these. */
  const aiOwned = useRef(new Set<string>())
  const aborts = useRef<Record<string, AbortController>>({})
  /**
   * "Process with AI": OCR stops (the one in progress is ended and the queue waits), every deed goes out in one request with the points
   * file as context, and everything comes back in one response. Each result is checked like any other read, and the drawing fills in.
   */
  const processAI = async (list: Deed[], points: string) => {
    aiRunning.current = true
    setAiBusy(true)
    // stop OCR: ending each deed's token drops whatever it was about to report, and aborting ends the engine
    for (const d of list) {
      tokens.current[d.id] = (tokens.current[d.id] ?? 0) + 1
      aborts.current[d.id]?.abort()
      attempted.current.add(d.id)
      patch(d.id, { status: 'reading', error: '' })
      setProgress((p) => ({ ...p, [d.id]: null }))
    }
    const marks = Object.fromEntries(list.map((d) => [d.id, tokens.current[d.id]]))
    const current = (id: string) => tokens.current[id] === marks[id] && present.current.has(id)
    try {
      const files = await Promise.all(list.map(async (d) => {
        const blob = await (await fetch(d.url)).blob()
        return { id: d.id, file: blob, type: d.type || blob.type }
      }))
      const results = await processDeeds(files, points)
      // checking the reads (and the repair search) for every deed together
      await Promise.all(
        list.map(async (d) => {
          const r = results.find((x) => x.id === d.id)
          if (!current(d.id)) return
          if (!r || r.error || !r.tracts) return patch(d.id, { status: 'error', error: r?.error ?? 'The AI reader returned nothing for this deed.' })
          const tracts = await toReadTracts(r.tracts)
          if (!current(d.id)) return
          setChosen((c) => {
            const { [d.id]: _gone, ...rest } = c
            return rest
          })
          aiOwned.current.add(d.id)
          patch(d.id, { status: 'done', tracts, selected: Math.max(tracts.findIndex((t) => t.assessment.verdict !== 'fail'), 0), info: { method: 'AI', pages: r.pages, characters: 0 } })
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The AI reader failed.'
      for (const d of list) if (current(d.id)) patch(d.id, { status: 'error', error: message })
    } finally {
      aiRunning.current = false
      setAiBusy(false)
      void drain()
    }
  }

  const read = async (deed: Deed) => {
    if (aiOwned.current.has(deed.id)) return
    const mine = (tokens.current[deed.id] = (tokens.current[deed.id] ?? 0) + 1)
    const current = () => tokens.current[deed.id] === mine && present.current.has(deed.id)
    const abort = (aborts.current[deed.id] = new AbortController())
    patch(deed.id, { status: 'reading', error: '' })
    setProgress((p) => ({ ...p, [deed.id]: null }))
    try {
      const blob = await (await fetch(deed.url)).blob()
      const result = await readDeedText(blob, deed.type || blob.type, (p) => {
        if (current()) setProgress((all) => ({ ...all, [deed.id]: p }))
      }, abort.signal)
      if (!current()) return
      const tracts = await toReadTracts(readDescription(result.text))
      if (!current()) return
      // start on the best read: one that passes, else the first
      const best = tracts.findIndex((t) => t.assessment.verdict !== 'fail')
      setChosen((c) => {
        const { [deed.id]: _gone, ...rest } = c
        return rest
      })
      patch(deed.id, { status: 'done', tracts, selected: Math.max(best, 0), info: { method: result.method, pages: result.pages, characters: result.text.length } })
    } catch (err) {
      if (current()) patch(deed.id, { status: 'error', error: err instanceof Error ? err.message : 'The deed could not be read.' })
    }
  }

  /**
   * Read the deeds as they are added, one after another in the background (OCR is heavy; running them together would freeze the
   * page). A deed is tried once on its own; "Read again" tries it again. Deeds added while this runs are picked up in the same pass.
   */
  const drain = async () => {
    if (draining.current || aiRunning.current) return
    draining.current = true
    try {
      for (;;) {
        if (aiRunning.current) break
        const next = deedsRef.current.find((d) => !attempted.current.has(d.id) && (readsRef.current[d.id]?.status ?? 'idle') === 'idle')
        if (!next) break
        attempted.current.add(next.id)
        await read(next)
      }
    } finally {
      draining.current = false
    }
  }
  useEffect(() => {
    void drain()
    // drain reads only refs; it is started when the set of deeds changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deeds])

  /** Use one of the suggested repairs: the call is changed and marked, and the read now needs a check instead of failing. */
  const useRepair = (id: string, tractIndex: number, repair: Repair) => {
    setReads((r) => {
      const s = r[id]
      const t = s?.tracts[tractIndex]
      if (!s || !t) return r
      const calls = applyRepair(t.calls, repair)
      const tracts = s.tracts.map((x, i) => (i === tractIndex ? { ...x, calls, assessment: assess(calls, x.statedAcres), repairs: [] } : x))
      return { ...r, [id]: { ...s, tracts } }
    })
  }

  // ---- Outlines: every description that passes, placed on the pins or along a shared line ----

  const items = useMemo(
    () =>
      deeds.flatMap((d) =>
        (reads[d.id]?.tracts ?? []).flatMap((t, i) => {
          const tr = t.assessment.traverse
          // every description with at least three readable calls is drawn; one that failed its checks is drawn too, as unverified
          if (!tr || t.calls.filter((c) => c.deg !== null).length < 3) return []
          // a description that closes ends where it began: its last corner repeats the first
          const closes = tr.misclosure < Math.max(2, tr.perimeter / 100)
          return [{ key: keyOf(d.id, i), name: `${d.name} (${t.label})`, trusted: t.assessment.verdict !== 'fail', closes, corners: closes ? tr.vertices.slice(0, -1) : tr.vertices }]
        }),
      ),
    [deeds, reads],
  )
  // Placing is the slow part, so it runs on a background thread; what comes back is kept with the inputs it answers, so a stale answer is never shown.
  const [placed, setPlaced] = useState<{ items: typeof items; anchors: Anchor[]; results: Result[] } | null>(null)
  useEffect(() => {
    if (items.length === 0) return
    let cancelled = false
    void deedMath.place(items.map((x) => ({ key: x.key, corners: x.corners, trusted: x.trusted })), anchors).then((results) => {
      if (!cancelled) setPlaced({ items, anchors, results })
    })
    return () => {
      cancelled = true
    }
  }, [items, anchors])
  const results: Result[] | null = items.length === 0 ? NO_RESULTS : placed && placed.items === items && placed.anchors === anchors ? placed.results : null
  const outlines: DrawnOutline[] = items.map((x) => ({
    key: x.key,
    name: x.name,
    hidden: hiddenKeys.has(x.key),
    pending: results === null,
    trusted: x.trusted,
    closes: x.closes,
    result: results?.find((r) => r.key === x.key) ?? { key: x.key, how: 'none', reason: 'still being placed' },
  }))

  const boundaries: Boundary[] = useMemo(
    () =>
      outlines.flatMap((o) => {
        if (o.hidden || o.pending || o.result.how === 'none') return []
        // a trusted outline is a property line on the DEED layer; one that failed its checks goes on DEED-CHECK (dashed on screen), and
        // open if it does not close, so the gap is visible
        const b = outline(
          o.result.vertices.map((v, i) => ({ e: v.e, n: v.n, z: 0, name: String(i + 1) })),
          o.trusted ? 'DEED' : 'DEED-CHECK',
          o.trusted ? 'deed' : 'deed-check',
          o.closes,
        )
        return b ? [b] : []
      }),
    // `outlines` is rebuilt each render; what decides the result is the placement and which are hidden
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, hiddenKeys],
  )

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

  /**
   * One status for all the deeds, for the Deed slot: still reading (spinner), a deed that could not be read (error), a read that needs a look
   * (warning: not trusted, check, or no land description found at all), or every deed read and at least one trusted (check).
   */
  const overall = (): { state: 'loading' | 'ok' | 'warning' | 'error'; text: string } => {
    const states = deeds.map((d) => stateOf(d.id))
    const working = states.filter((s) => s.status === 'reading' || s.status === 'idle').length
    const failed = states.filter((s) => s.status === 'error').length
    const done = states.filter((s) => s.status === 'done')
    const trusted = done.filter((s) => s.tracts.some((x) => x.assessment.verdict === 'ok')).length
    const check = done.filter((s) => s.tracts.length > 0 && !s.tracts.some((x) => x.assessment.verdict === 'ok') && s.tracts.some((x) => x.assessment.verdict === 'check')).length
    const bad = done.filter((s) => s.tracts.length > 0 && s.tracts.every((x) => x.assessment.verdict === 'fail')).length
    const none = done.filter((s) => s.tracts.length === 0).length
    const drawn = outlines.filter((o) => !o.hidden && !o.pending && o.result.how !== 'none').length
    const parts = [
      trusted > 0 ? `${trusted} read` : null,
      check > 0 ? `${check} to check` : null,
      bad > 0 ? `${bad} not trusted` : null,
      none > 0 ? `${none} without calls` : null,
      failed > 0 ? `${failed} failed` : null,
      drawn > 0 ? `${drawn} drawn` : null,
    ].filter(Boolean)
    if (working > 0) return { state: 'loading', text: `Reading ${working} of ${deeds.length}…` }
    if (failed > 0) return { state: 'error', text: parts.join(' · ') }
    if (check > 0 || bad > 0 || trusted === 0) return { state: 'warning', text: trusted === 0 && check === 0 && bad === 0 ? 'No land description found' : parts.join(' · ') }
    return { state: 'ok', text: parts.join(' · ') }
  }

  return {
    overall,
    stateOf,
    read,
    processAI,
    aiBusy,
    select: (id: string, tract: number) => setChosen((c) => ({ ...c, [id]: tract })),
    useRepair,
    agreements,
    /** Forget what was read for a removed deed. */
    forget: (id: string) => {
      tokens.current[id] = (tokens.current[id] ?? 0) + 1
      attempted.current.delete(id)
      aiOwned.current.delete(id)
      setReads((r) => {
        const { [id]: _gone, ...rest } = r
        return rest
      })
    },
    outlines,
    /** Where the outline of one description stands: drawn, hidden, or not placed. */
    outlineOf: (deedId: string, tract: number) => outlines.find((o) => o.key === keyOf(deedId, tract)) ?? null,
    nameOf: (key: string) => outlines.find((o) => o.key === key)?.name ?? key,
    toggleOutline: (key: string) =>
      setHiddenKeys((h) => {
        const next = new Set(h)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    /** The outlines to draw (ticked and placed), each with its bearing labels. */
    boundaries,
  }
}
