import { Accordion } from '../Accordion.tsx'
import type { Boundary, Candidate } from '../../lib/boundary.ts'

const SQ_FT_PER_ACRE = 43560

interface Props {
  candidates: Candidate[]
  selected: string[]
  onSelect: (pins: string[]) => void
  boundary: Boundary | null
  /** Panel filter: which candidate pins to list. */
  hit: (...fields: string[]) => boolean
  /** The pins were chosen automatically (the surveyor has not touched the ticks). */
  auto: boolean
  /** Choose the pins again automatically. */
  onAuto: () => void
}

/** Pick the corner pins that make up the property line; shows the resulting area, perimeter and courses. */
export function BoundaryPanel({ candidates, selected, onSelect, boundary, hit, auto, onAuto }: Props) {
  return (
    <Accordion title="Boundary" badge={boundary ? <span className="count">{selected.length} pins</span> : undefined}>
      {candidates.length === 0 ? (
        <p className="muted small">No iron pins or monuments found (shots like IPF and IPS), so there is nothing to draw a property line from. A deed outline can still be drawn if you add a deed.</p>
      ) : (
        <>
          <p className="muted small">
            {auto
              ? 'Ticked for you: the pins with the most common cap number, which on some jobs are the neighbour\'s. Untick any that are wrong and check the area against the plat or deed. When a deed outline is drawn, no pins are ticked, because the outline is the property line.'
              : 'Tick the corner pins of the parcel, and check the area against the plat or deed.'}
          </p>
          <div className="row tight">
            <button className="btn btn-outline btn-sm" disabled={auto} onClick={onAuto} title="Choose the pins again automatically (none when a deed outline is drawn)">
              Choose for me
            </button>
            <button className="btn btn-outline btn-sm" disabled={selected.length === 0} onClick={() => onSelect([])}>
              Clear
            </button>
          </div>
          <ul className="layers pins">
            {candidates
              .filter((c) => hit(c.no, c.desc))
              .map((c) => (
                <li key={c.no}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(c.no)}
                      onChange={(e) => onSelect(e.target.checked ? [...selected, c.no] : selected.filter((n) => n !== c.no))}
                    />
                    <span className="mono">{c.no}</span>
                    <span>{c.desc}</span>
                  </label>
                </li>
              ))}
          </ul>
          {boundary ? (
            <>
              <p className="boundary-total" role="status">
                <b>{Math.round(boundary.area).toLocaleString('en-US')} sq ft</b> ({(boundary.area / SQ_FT_PER_ACRE).toFixed(2)} acres) · perimeter {boundary.perimeter.toFixed(2)}&apos;
              </p>
              <table className="courses">
                <tbody>
                  {boundary.courses.map((c) => (
                    <tr key={c.from + c.to}>
                      <td className="mono">
                        {c.from}→{c.to}
                      </td>
                      <td className="mono">{c.bearing}</td>
                      <td className="mono num">{c.distance.toFixed(2)}&apos;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted small">{selected.length === 0 ? 'No boundary yet.' : 'Pick at least 3 pins to draw the property line.'}</p>
          )}
        </>
      )}
    </Accordion>
  )
}
