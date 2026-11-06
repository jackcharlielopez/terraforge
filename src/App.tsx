import { useMemo, useState } from 'react'
import { Accordion } from './components/Accordion.tsx'
import { FileSlots } from './components/FileSlots.tsx'
import { Preview } from './components/Preview.tsx'
import type { RefMode } from './components/Preview.tsx'
import { BoundaryPanel } from './components/sidebar/BoundaryPanel.tsx'
import { ComparePanel } from './components/sidebar/ComparePanel.tsx'
import { DeedPanel } from './components/sidebar/DeedPanel.tsx'
import { LayersPanel, LineworkNotes } from './components/sidebar/LayersPanel.tsx'
import { ReviewPanel } from './components/sidebar/ReviewPanel.tsx'
import { SidebarFooter } from './components/sidebar/SidebarFooter.tsx'
import { SkippedLinesPanel } from './components/sidebar/SkippedLinesPanel.tsx'
import { useDeeds } from './hooks/useDeed.ts'
import { useDeedReading } from './hooks/useDeedReading.ts'
import { useFileDrop } from './hooks/useFileDrop.ts'
import { useReview } from './hooks/useReview.ts'
import { useSurveyDrawing } from './hooks/useSurveyDrawing.ts'
import { ANNOTATION_LAYERS, POINT_LAYERS } from './lib/codes.ts'
import { compareWithReference } from './lib/compare.ts'
import { DEFAULT_DXF_OPTIONS, buildDxf } from './lib/dxf.ts'
import { decodeDxf, readDxf } from './lib/dxfview.ts'
import type { RefShapes } from './lib/dxfview.ts'
import { downloadFile, toggled } from './lib/download.ts'
import { formatSize, groupFiles } from './lib/files.ts'
import type { FileKind } from './lib/files.ts'
import { parsePoints } from './lib/parse.ts'
import { buildReviewExport, edgeKey } from './lib/review.ts'
import type { ParseResult } from './lib/types.ts'

interface Reference {
  name: string
  size: number
  shapes: RefShapes
}

export default function App() {
  const { deeds, add: addDeeds, remove: removeDeed, clear: clearDeeds } = useDeeds()
  const deedReading = useDeedReading(deeds)

  // What the user has loaded.
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [reference, setReference] = useState<Reference | null>(null)
  const [notices, setNotices] = useState<string[]>([])

  // How it is shown.
  const [boundarySel, setBoundarySel] = useState<string[]>([])
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [refMode, setRefMode] = useState<RefMode>('both')
  const [refHidden, setRefHidden] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  /** Bumped to remount the preview, so it re-fits the view whenever new data is loaded. */
  const [loadId, setLoadId] = useState(0)

  const reviewPoints = useMemo(() => parsed?.points ?? [], [parsed])
  const review = useReview(reviewPoints)
  const drawing = useSurveyDrawing(parsed, boundarySel, deedReading.outline, { active: review.active, edits: review.edits })
  const { points, matches, dict, syntax, allLines, labels, layerRows, candidates, boundary } = drawing

  const hasData = points.length > 0
  // Pins and monuments found in the field: a deed outline is placed on these.
  const anchors = useMemo(() => candidates.map((c) => ({ no: c.no, e: c.e, n: c.n })), [candidates])
  const hasView = hasData || reference !== null
  // With no survey points there is nothing to overlay, so the reference is shown on its own.
  const effectiveRefMode: RefMode = hasData ? refMode : 'reference'
  const stats = useMemo(() => (reference && hasData ? compareWithReference(points, allLines, reference.shapes) : null), [reference, hasData, points, allLines])

  // ---- Review mode ----

  const [addLayer, setAddLayer] = useState('')
  const addedKeys = useMemo(() => new Set(review.edits.added.map((x) => edgeKey(x.a, x.b))), [review.edits.added])
  const acceptedKeys = useMemo(() => new Set(review.edits.accepted), [review.edits.accepted])
  const sourceOf = (key: string): 'rule' | 'guess' | 'manual' => (addedKeys.has(key) ? 'manual' : drawing.guessed.has(key) ? 'guess' : 'rule')
  const pickedSegment = review.selected ? drawing.segments.find((s) => s.key === review.selected) ?? null : null
  const reviewCounts = {
    guesses: drawing.segments.filter((s) => drawing.guessed.has(s.key) && !acceptedKeys.has(s.key)).length,
    accepted: review.edits.accepted.length,
    rejected: review.edits.rejected.length,
    added: review.edits.added.length,
  }
  const drawLayers = useMemo(() => {
    const skip = new Set([...POINT_LAYERS, ...ANNOTATION_LAYERS].map((l) => l.name))
    return drawing.layerList.map((l) => l.name).filter((n) => !skip.has(n))
  }, [drawing.layerList])
  /** The layer for a hand-drawn line: the one picked, else a connecting code the two points share, else either point's. */
  const layerFor = (a: number, b: number): string => {
    if (addLayer) return addLayer
    const layers = (i: number) => matches[i].codes.map((c) => dict.get(c)).filter((d) => d?.connect).map((d) => d!.layer)
    const la = layers(a)
    return la.find((l) => layers(b).includes(l)) ?? la[0] ?? layers(b)[0] ?? 'V-NODE'
  }
  const onReviewPoint = (i: number) => {
    if (review.addFrom === null) return review.setAddFrom(i)
    if (review.addFrom === i) return review.setAddFrom(null)
    review.add(review.addFrom, i, layerFor(review.addFrom, i))
  }
  const exportReview = () => {
    const log = buildReviewExport({
      points,
      matches,
      settings: { joinBy: drawing.joinBy },
      generated: drawing.generatedSegments,
      final: drawing.segments,
      guessed: drawing.guessed,
      added: addedKeys,
      events: review.events,
    })
    downloadFile(JSON.stringify(log, null, 1), 'terraforge-review-log.json', 'application/json')
  }

  // One filter box narrows every list in the panel (layers, reference layers and pins).
  const q = filter.trim().toUpperCase()
  const hit = (...fields: string[]) => q === '' || fields.some((f) => f.toUpperCase().includes(q))
  const shownLayers = layerRows.filter((l) => hit(l.name))

  // ---- Loading files ----

  const loadPoints = async (file: File) => {
    const next = parsePoints(new TextDecoder('windows-1252').decode(await file.arrayBuffer()))
    setParsed(next)
    setFileName(file.name)
    setHidden(new Set())
    // No property line until the surveyor picks the pins: "most common cap number" is only the surveyor's own pins on some jobs
    // (on a rural job it can be the neighbour's), and a wrong boundary is worse than none.
    setBoundarySel([])
    deedReading.unplace()
    setLoadId((n) => n + 1)
    setPanelOpen(true)
  }

  /** Returns a note for the user if the file could not be used. */
  const loadReference = async (file: File): Promise<string | null> => {
    try {
      const shapes = await readDxf(decodeDxf(await file.arrayBuffer()))
      setReference({ name: file.name, size: file.size, shapes })
      setRefHidden(new Set())
      setRefMode('both')
      setLoadId((n) => n + 1)
      setPanelOpen(true)
      return !shapes.extent && shapes.texts.length === 0 ? `"${file.name}" opened but has nothing drawable in model space.` : null
    } catch (err) {
      return `Could not read "${file.name}" as a DXF: ${err instanceof Error ? err.message : 'unknown error'}`
    }
  }

  /** Handles one or many files at once. A slot's own picker forces the kind; drops are sorted by extension. */
  const handleFiles = async (files: File[], force?: Exclude<FileKind, 'unknown'>) => {
    const { picked, deeds: newDeeds, notes } = groupFiles(files, force)
    if (picked.points) await loadPoints(picked.points)
    if (newDeeds.length > 0) {
      const added = addDeeds(newDeeds)
      if (added < newDeeds.length) notes.push(`${newDeeds.length - added} deed(s) were already attached and were not added again.`)
    }
    if (picked.reference) {
      const note = await loadReference(picked.reference)
      if (note) notes.push(note)
    }
    setNotices(notes)
  }

  const drop = useFileDrop((files) => void handleFiles(files))

  const downloadDxf = () => {
    const dxf = buildDxf(points, matches, dict, allLines, { ...DEFAULT_DXF_OPTIONS, hiddenLayers: hidden, layerColors: drawing.layerAci, labels })
    downloadFile(dxf, (fileName ?? 'survey').replace(/\.[^.]+$/, '') + '.dxf', 'application/dxf')
  }

  // ---- Layout ----

  const positionNote =
    drawing.joinBy === 'position' && !syntax.explicitLines
      ? `The point numbers look scrambled (only ${Math.round(drawing.orderly * 100)}% of points have their nearest neighbour next to them in the numbering), so lines are found from where the points are, not from shot order.`
      : null

  const slots = (
    <>
      <FileSlots
        points={{ name: fileName, detail: parsed ? `${points.length} points${parsed.warnings.length ? `, ${parsed.warnings.length} flagged` : ''}` : undefined }}
        deed={{ name: deeds.length === 0 ? null : deeds.length === 1 ? deeds[0].name : `${deeds.length} deeds`, detail: deeds.length === 0 ? undefined : formatSize(deeds.reduce((t, d) => t + d.size, 0)) }}
        reference={{ name: reference?.name ?? null, detail: reference ? formatSize(reference.size) : undefined }}
        onFiles={(files, force) => void handleFiles(files, force)}
        onClearDeeds={clearDeeds}
        onClearReference={() => setReference(null)}
      />
      {notices.length > 0 && (
        <ul className="notices" role="status">
          {notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </>
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          Terra<span>Forge</span>
        </div>
        <span className="tagline">Survey files → DXF</span>
        <div className="spacer" />
        <button className={'btn btn-outline' + (review.active ? ' on' : '')} aria-pressed={review.active} disabled={!hasData} onClick={() => review.setActive(!review.active)} title="Look over the drawing: keep or remove lines, add missing ones">
          Review
        </button>
        <button className="btn btn-amber" disabled={!hasData} onClick={downloadDxf}>
          Download DXF
        </button>
      </header>

      <div className={'layout' + (panelOpen ? ' panel-open' : '')}>
        <aside className="side" aria-label="Survey details">
          <div className="side-scroll" inert={!panelOpen}>
            <input className="panel-filter" type="search" placeholder="Filter layers and pins…" aria-label="Filter layers and pins" value={filter} onChange={(e) => setFilter(e.target.value)} />

            <Accordion title="Files" defaultOpen>
              {slots}
            </Accordion>

            {hasData && review.active && (
              <ReviewPanel
                points={points}
                layers={drawLayers}
                tool={review.tool}
                onTool={review.setTool}
                selected={pickedSegment ? { seg: pickedSegment, source: sourceOf(pickedSegment.key) } : null}
                counts={reviewCounts}
                addFrom={review.addFrom}
                addLayer={addLayer}
                onAddLayer={setAddLayer}
                canUndo={review.canUndo}
                onAccept={() => pickedSegment && review.accept(pickedSegment, sourceOf(pickedSegment.key))}
                onReject={() => pickedSegment && review.reject(pickedSegment, sourceOf(pickedSegment.key))}
                onUndo={review.undo}
                onClear={review.clear}
                onExport={exportReview}
                eventCount={review.events.length}
              />
            )}

            {reference && (
              <ComparePanel
                name={reference.name}
                size={reference.size}
                shapes={reference.shapes}
                hasData={hasData}
                mode={refMode}
                onMode={setRefMode}
                stats={stats}
                hidden={refHidden}
                onToggleLayer={(l) => setRefHidden((h) => toggled(h, l))}
                hit={hit}
                onRemove={() => setReference(null)}
              />
            )}

            {parsed && parsed.warnings.length > 0 && <SkippedLinesPanel warnings={parsed.warnings} />}

            <LayersPanel rows={shownLayers} hidden={hidden} onToggle={(l) => setHidden((h) => toggled(h, l))} layerHex={drawing.layerHex}>
              {hasData && <LineworkNotes lineCount={allLines.length} removedSegments={drawing.removedSegments} crossings={drawing.crossings} positionNote={positionNote} />}
            </LayersPanel>

            {hasData && <BoundaryPanel candidates={candidates} selected={boundarySel} onSelect={setBoundarySel} boundary={boundary} hit={hit} fromDeed={deedReading.outline !== null} />}

            {deeds.length > 0 && <DeedPanel deeds={deeds} onRemove={removeDeed} onClear={clearDeeds} reading={deedReading} anchors={anchors} hasPoints={hasData} />}
          </div>
          <SidebarFooter />
        </aside>

        {hasView && (
          <button className="panel-toggle" aria-expanded={panelOpen} aria-label={panelOpen ? 'Hide panel' : 'Show panel'} onClick={() => setPanelOpen(!panelOpen)}>
            {panelOpen ? '‹' : '›'}
          </button>
        )}

        <main className={'stage' + (drop.active ? ' dragging' : '')} {...drop.handlers}>
          <Preview
            key={loadId}
            points={points}
            matches={matches}
            lines={allLines}
            labels={labels}
            defs={dict}
            hiddenLayers={hidden}
            layerHex={drawing.layerHex}
            reference={reference?.shapes ?? null}
            refMode={effectiveRefMode}
            refHidden={refHidden}
            review={
              review.active
                ? {
                    segments: drawing.segments,
                    guessed: drawing.guessed,
                    accepted: acceptedKeys,
                    added: addedKeys,
                    selected: review.selected,
                    tool: review.tool,
                    addFrom: review.addFrom,
                    onSegment: (s) => review.setSelected(s.key),
                    onPoint: onReviewPoint,
                  }
                : null
            }
          />

          {!hasView && (
            <div className="stage-overlay">
              <div className="uploader">
                <h1>Start a survey</h1>
                <p className="muted">
                  Drop your files anywhere on this canvas: survey points, deeds and plats and a finished .dxf to compare can go in together. Only the points file is needed to begin.
                </p>
                {slots}
              </div>
            </div>
          )}
          {drop.active && <div className="drop-hint">Drop files to add them</div>}
        </main>
      </div>

    </div>
  )
}
