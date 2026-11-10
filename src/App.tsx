import { useMemo, useState } from 'react'
import { Accordion } from './components/Accordion.tsx'
import { FileSlots } from './components/FileSlots.tsx'
import { Preview } from './components/Preview.tsx'
import type { RefMode } from './components/Preview.tsx'
import { BoundaryPanel } from './components/sidebar/BoundaryPanel.tsx'
import { ComparePanel } from './components/sidebar/ComparePanel.tsx'
import { DeedList } from './components/sidebar/DeedList.tsx'
import { LayersPanel, LineworkNotes } from './components/sidebar/LayersPanel.tsx'
import type { DeedOutlineRow } from './components/sidebar/LayersPanel.tsx'
import { SidebarFooter } from './components/sidebar/SidebarFooter.tsx'
import { SkippedLinesPanel } from './components/sidebar/SkippedLinesPanel.tsx'
import { useDeeds } from './hooks/useDeed.ts'
import { useDeedReading } from './hooks/useDeedReading.ts'
import { deedsNeedingAi } from './lib/triage.ts'
import { foundPins } from './lib/anchors.ts'
import { useFileDrop } from './hooks/useFileDrop.ts'
import { useSurveyDrawing } from './hooks/useSurveyDrawing.ts'
import { FEATURES } from './lib/features.ts'
import { compareWithReference } from './lib/compare.ts'
import { DEFAULT_DXF_OPTIONS, buildDxf } from './lib/dxf.ts'
import { decodeDxf, readDxf } from './lib/dxfview.ts'
import type { RefShapes } from './lib/dxfview.ts'
import { downloadFile, toggled } from './lib/download.ts'
import { EMPTY_STAGED, formatSize, groupFiles, stageFiles } from './lib/files.ts'
import type { FileKind, Staged } from './lib/files.ts'
import { parsePoints } from './lib/parse.ts'
import type { ParseResult } from './lib/types.ts'

interface Reference {
  name: string
  size: number
  shapes: RefShapes
}

export default function App() {
  const { deeds, add: addDeeds, clear: clearDeeds } = useDeeds()
  // What the user has loaded.
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  /** The points file as text, kept only so Process with AI can send it as context. */
  const [pointsText, setPointsText] = useState('')
  const [reference, setReference] = useState<Reference | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  /** A file being read, or that could not be read: shown on its slot as a spinner, then an error mark. */
  type Pending = { name: string; state: 'loading' | 'error'; message?: string }
  const [pointsPending, setPointsPending] = useState<Pending | null>(null)
  const [referencePending, setReferencePending] = useState<Pending | null>(null)

  // How it is shown.
  /** null: the pins for the property line are chosen automatically; an array: the surveyor has ticked them. */
  const [pinSelection, setPinSelection] = useState<string[] | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [refMode, setRefMode] = useState<RefMode>('both')
  const [refHidden, setRefHidden] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  /**
   * 'start': the start screen. Files chosen or dropped are only held (`staged`); nothing is read until "Start survey", which needs a points file.
   * 'running': the sequence has begun (points, then the comparison drawing, then the deeds). 'live': files added from now on are read at once.
   */
  const [phase, setPhase] = useState<'start' | 'running' | 'live'>('start')
  const [staged, setStaged] = useState<Staged>(EMPTY_STAGED)
  /** Bumped to remount the preview, so it re-fits the view whenever new data is loaded. */
  const [loadId, setLoadId] = useState(0)

  // Pins and monuments found in the field: every deed outline that passes is placed on these (or along a line it shares with one that is).
  const anchors = useMemo(() => foundPins(parsed?.points ?? []), [parsed])
  const deedReading = useDeedReading(deeds, anchors)

  const drawing = useSurveyDrawing(parsed, pinSelection, deedReading.boundaries)
  const { points, matches, dict, syntax, allLines, labels, layerRows, candidates, boundary, boundarySel } = drawing

  const hasData = points.length > 0
  const deedOutlineRows: DeedOutlineRow[] = deedReading.outlines.map((o) => {
    const placed = !o.pending && o.result.how !== 'none'
    return { key: o.key, name: o.name, checked: !o.hidden, enabled: placed, note: o.pending ? 'placing…' : o.result.how === 'none' ? 'not placed' : o.trusted ? null : 'unverified' }
  })
  const deedOverall = deedReading.overall()
  const hasView = phase !== 'start'
  // With no survey points there is nothing to overlay, so the reference is shown on its own.
  const effectiveRefMode: RefMode = hasData ? refMode : 'reference'
  const stats = useMemo(() => (reference && hasData ? compareWithReference(points, allLines, reference.shapes) : null), [reference, hasData, points, allLines])

  // One filter box narrows every list in the panel (layers, reference layers and pins).
  const q = filter.trim().toUpperCase()
  const hit = (...fields: string[]) => q === '' || fields.some((f) => f.toUpperCase().includes(q))
  const shownLayers = layerRows.filter((l) => hit(l.name))

  // ---- Loading files ----

  /** Let the spinner paint before a read that may block the page for a moment. */
  const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 30))

  const loadPoints = async (file: File): Promise<string | null> => {
    setPointsPending({ name: file.name, state: 'loading' })
    await paint()
    let next: ParseResult
    let text = ''
    try {
      text = new TextDecoder('windows-1252').decode(await file.arrayBuffer())
      next = parsePoints(text)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'the file could not be read'
      setPointsPending({ name: file.name, state: 'error', message })
      return `Could not read "${file.name}": ${message}`
    }
    if (next.points.length === 0) {
      setPointsPending({ name: file.name, state: 'error', message: 'no points could be read' })
      return `No points could be read from "${file.name}". Expected lines like: 1,431626.25,1943809.32,1063.69,IPF`
    }
    setPointsPending(null)
    setParsed(next)
    setPointsText(text)
    setFileName(file.name)
    setHidden(new Set())
    // The property line's pins are chosen automatically again for a new job; the surveyor unticks what is wrong.
    setPinSelection(null)
    setLoadId((n) => n + 1)
    setPanelOpen(true)
    return null
  }

  /** Returns a note for the user if the file could not be used. */
  const loadReference = async (file: File): Promise<string | null> => {
    setReferencePending({ name: file.name, state: 'loading' })
    await paint()
    try {
      const shapes = await readDxf(decodeDxf(await file.arrayBuffer()))
      setReferencePending(null)
      setReference({ name: file.name, size: file.size, shapes })
      setRefHidden(new Set())
      setRefMode('both')
      setLoadId((n) => n + 1)
      setPanelOpen(true)
      return !shapes.extent && shapes.texts.length === 0 ? `"${file.name}" opened but has nothing drawable in model space.` : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      setReferencePending({ name: file.name, state: 'error', message })
      return `Could not read "${file.name}" as a DXF: ${message}`
    }
  }

  /** Handles one or many files at once. A slot's own picker forces the kind; drops are sorted by extension. */
  const handleFiles = async (files: File[], force?: Exclude<FileKind, 'unknown'>) => {
    if (phase === 'start') {
      // on the start screen files only wait: nothing is read until "Start survey"
      const r = stageFiles(staged, files, force)
      setStaged(r.staged)
      setNotices(r.notes)
      return
    }
    const { picked, deeds: newDeeds, notes } = groupFiles(files, force)
    if (picked.points) {
      const note = await loadPoints(picked.points)
      if (note) notes.push(note)
    }
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

  /** The whole sequence, in order: the points, then the comparison drawing, then the deeds (which read themselves in the background). */
  const startSurvey = async () => {
    const batch = staged
    if (!batch.points) return
    setNotices([])
    setPhase('running')
    setPanelOpen(true)
    const failed = await loadPoints(batch.points)
    if (failed) {
      // nothing to draw: back to the start screen with the files still waiting and the reason shown
      setPointsPending(null)
      setPhase('start')
      setNotices([failed])
      return
    }
    const notes: string[] = []
    if (batch.reference) {
      const note = await loadReference(batch.reference)
      if (note) notes.push(note)
    }
    if (batch.deeds.length > 0) addDeeds(batch.deeds)
    setStaged(EMPTY_STAGED)
    setPhase('live')
    setNotices(notes)
  }

  /** Process with AI: the deeds (page images) and the points file go to the model provider through the local server; what comes back are calls, which are checked and drawn like any other read. */
  const aiTodo = deedsNeedingAi(deeds, (id) => deedReading.stateOf(id).info?.method)
  const processWithAI = () => {
    if (!window.confirm(`Process with AI sends ${aiTodo.length} deed${aiTodo.length === 1 ? '' : 's'} (page images) and the points file to a model provider through your local TerraForge server, and from then on this survey is read by the AI only: OCR will not run. Nothing else is uploaded. Continue?`)) return
    void deedReading.processAI(aiTodo, pointsText)
  }

  const drop = useFileDrop((files) => void handleFiles(files))

  /** Clear everything and go back to the start screen. Asks first, since the drawing and the deeds go. */
  const newSurvey = () => {
    const work = hasData || deeds.length > 0 || reference !== null
    if (work && !window.confirm('Start a new survey? The current drawing' + (FEATURES.compare ? ', deeds and comparison drawing' : ' and deeds') + ' will be cleared. Download the DXF first if you need it.')) return
    for (const d of deeds) deedReading.forget(d.id)
    clearDeeds()
    setParsed(null)
    setPointsText('')
    setFileName(null)
    setReference(null)
    setPointsPending(null)
    setReferencePending(null)
    setStaged(EMPTY_STAGED)
    setPinSelection(null)
    setHidden(new Set())
    setRefHidden(new Set())
    setRefMode('both')
    setFilter('')
    setNotices([])
    setPanelOpen(false)
    setPhase('start')
    setLoadId((n) => n + 1)
  }

  const downloadDxf = () => {
    const dxf = buildDxf(points, matches, dict, allLines, { ...DEFAULT_DXF_OPTIONS, hiddenLayers: hidden, layerColors: drawing.layerAci, labels })
    downloadFile(dxf, (fileName ?? 'survey').replace(/\.[^.]+$/, '') + '.dxf', 'application/dxf')
  }

  // ---- Layout ----

  const positionNote =
    drawing.joinBy === 'position' && !syntax.explicitLines
      ? `The point numbers look scrambled (only ${Math.round(drawing.orderly * 100)}% of points have their nearest neighbour next to them in the numbering), so lines are found from where the points are, not from shot order.`
      : null

  const waiting = (f: File | null): { name: string | null; state?: 'ready'; detail?: string } => (f ? { name: f.name, state: 'ready', detail: `Ready · ${formatSize(f.size)}` } : { name: null })
  const slots = (
    <>
      <FileSlots
        points={
          phase === 'start'
            ? waiting(staged.points)
            : pointsPending
            ? { name: pointsPending.name, state: pointsPending.state, detail: pointsPending.state === 'loading' ? 'Reading…' : pointsPending.message }
            : parsed
              ? { name: fileName, state: parsed.warnings.length > 0 ? 'warning' : 'ok', detail: `${points.length} points${parsed.warnings.length ? `, ${parsed.warnings.length} lines skipped` : ''}` }
              : { name: null }
        }
        deed={
          phase === 'start'
            ? staged.deeds.length === 0
              ? { name: null }
              : { name: staged.deeds.length === 1 ? staged.deeds[0].name : `${staged.deeds.length} deeds`, state: 'ready', detail: `Ready · ${formatSize(staged.deeds.reduce((t, d) => t + d.size, 0))}` }
            : deeds.length === 0
            ? { name: null }
            : {
                name: deeds.length === 1 ? deeds[0].name : `${deeds.length} deeds`,
                state: deedOverall.state,
                detail: deedOverall.state === 'loading' ? deedOverall.text : formatSize(deeds.reduce((t, d) => t + d.size, 0)),
                note: `Deeds: ${deedOverall.text}`,
              }
        }
        reference={
          phase === 'start'
            ? waiting(staged.reference)
            : referencePending
            ? { name: referencePending.name, state: referencePending.state, detail: referencePending.state === 'loading' ? 'Reading…' : referencePending.message }
            : reference
              ? { name: reference.name, state: !reference.shapes.extent && reference.shapes.texts.length === 0 ? 'warning' : 'ok', detail: !reference.shapes.extent && reference.shapes.texts.length === 0 ? 'nothing drawable in model space' : formatSize(reference.size) }
              : { name: null }
        }
        onFiles={(files, force) => void handleFiles(files, force)}
        aiAction={
          FEATURES.aiRead && phase !== 'start'
            ? { disabled: aiTodo.length === 0 || !hasData, busy: deedReading.aiBusy, label: aiTodo.length > 0 && deedReading.aiMode ? `Process ${aiTodo.length} more with AI` : undefined, title: deeds.length === 0 || !hasData ? 'Needs a points file and at least one deed' : aiTodo.length === 0 ? 'Every deed has been read by the AI' : 'Sends the deeds and the points file to a model provider', onClick: processWithAI }
            : undefined
        }
        deedList={phase !== 'start' && deeds.length > 0 ? <DeedList deeds={deeds} reading={deedReading} /> : undefined}
        onClearDeeds={() => (phase === 'start' ? setStaged((s) => ({ ...s, deeds: [] })) : clearDeeds())}
        onClearReference={() => {
          if (phase === 'start') return setStaged((s) => ({ ...s, reference: null }))
          setReference(null)
          setReferencePending(null)
        }}
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
        {phase !== 'start' && (
          <button className="btn btn-outline" onClick={newSurvey} title="Clear this survey and go back to the start screen">
            New survey
          </button>
        )}
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

            <LayersPanel rows={shownLayers} hidden={hidden} onToggle={(l) => setHidden((h) => toggled(h, l))} layerHex={drawing.layerHex} deedOutlines={deedOutlineRows} onToggleOutline={deedReading.toggleOutline}>
              {hasData && <LineworkNotes lineCount={allLines.length} removedSegments={drawing.removedSegments} crossings={drawing.crossings} positionNote={positionNote} />}
            </LayersPanel>

            {hasData && <BoundaryPanel candidates={candidates} selected={boundarySel} onSelect={setPinSelection} boundary={boundary} hit={hit} auto={pinSelection === null} onAuto={() => setPinSelection(null)} />}

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
          />

          {!hasView && (
            <div className="stage-overlay">
              <div className="uploader">
                <h1>Start a survey</h1>
                <p className="muted">
                  Add your files here or drop them anywhere on this canvas, then press <b>Start survey</b>. The survey points file is required; deeds and plats{FEATURES.compare ? ', and a finished .dxf to compare with,' : ''} are optional. Nothing is read until you start.
                </p>
                {slots}
                <div className="start-row">
                  <button className="btn btn-amber btn-lg" disabled={!staged.points} aria-describedby="start-help" onClick={() => void startSurvey()}>
                    Start survey
                  </button>
                  <span id="start-help" className="muted small">
                    {staged.points ? (FEATURES.compare ? 'Reads the points, then the comparison drawing, and starts reading the deeds in the background.' : 'Reads the points, then starts reading the deeds in the background.') : 'Add the survey points file (.txt, .csv or .asc) to begin.'}
                  </span>
                </div>
              </div>
            </div>
          )}
          {drop.active && <div className="drop-hint">Drop files to add them</div>}
        </main>
      </div>

    </div>
  )
}
