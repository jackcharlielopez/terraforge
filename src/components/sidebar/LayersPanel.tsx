import { Accordion } from '../Accordion.tsx'
import { Swatch } from '../Swatch.tsx'
import { aciToHex } from '../../lib/aci.ts'
import type { LayerRow } from '../../lib/summary.ts'

export interface DeedOutlineRow {
  key: string
  name: string
  checked: boolean
  /** Still being placed, or could not be placed. */
  enabled: boolean
  note: string | null
}

interface Props {
  rows: LayerRow[]
  hidden: ReadonlySet<string>
  onToggle: (layer: string) => void
  layerHex: ReadonlyMap<string, string>
  /** The outlines drawn from deeds and plats, each switched on and off here. */
  deedOutlines?: DeedOutlineRow[]
  onToggleOutline?: (key: string) => void
  /** Present only once there are points: the note about how the lines were found. */
  children?: React.ReactNode
}

/** Layer checkboxes: unchecked layers are left out of the preview and the DXF. */
export function LayersPanel({ rows, hidden, onToggle, layerHex, deedOutlines = [], onToggleOutline, children }: Props) {
  return (
    <Accordion title="Layers" badge={<span className="count">{rows.length}</span>}>
      <ul className="layers">
        {rows.map((l) => (
          <li key={l.name}>
            <label>
              <input type="checkbox" checked={!hidden.has(l.name)} onChange={() => onToggle(l.name)} />
              <Swatch color={layerHex.get(l.name) ?? aciToHex(7)} />
              <span className="mono">{l.name}</span>
              <span className="muted">{l.n}</span>
            </label>
          </li>
        ))}
        {rows.length === 0 && <li className="muted small">No layers match.</li>}
      </ul>
      {deedOutlines.length > 0 && (
        <>
          <h4 className="layers-sub">From deeds and plats</h4>
          <ul className="layers">
            {deedOutlines.map((o) => (
              <li key={o.key} className={'deed-outline' + (o.enabled ? '' : ' off')}>
                <label>
                  <input type="checkbox" checked={o.enabled && o.checked} disabled={!o.enabled} onChange={() => onToggleOutline?.(o.key)} />
                  <span className="mono">{o.name}</span>
                  {o.note && <span className="muted">{o.note}</span>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">Unchecked layers are left out of the preview and the DXF.</p>
      {children}
    </Accordion>
  )
}

interface NotesProps {
  lineCount: number
  removedSegments: number
  crossings: number | null
  /** Set when lines are found by position instead of shot order. */
  positionNote: string | null
}

/** One-line summary of the drawn linework, with a warning when lines cross or the point numbers look scrambled. */
export function LineworkNotes({ lineCount, removedSegments, crossings, positionNote }: NotesProps) {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
  return (
    <>
      {positionNote && (
        <p className="lines-note warn" role="status">
          {positionNote}
        </p>
      )}
      <p className={'lines-note' + (crossings ? ' warn' : '')} role="status">
        {lineCount} {plural(lineCount, 'line', 'lines')} drawn
        {removedSegments > 0 && `, ${removedSegments} ${plural(removedSegments, 'segment', 'segments')} left out so lines do not cross`}
        {crossings === null
          ? '.'
          : crossings === 0
            ? ', none crossing.'
            : `, ${crossings} ${plural(crossings, 'place where lines cross', 'places where lines cross')}.`}
      </p>
    </>
  )
}
