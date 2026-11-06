import { Accordion } from '../Accordion.tsx'
import type { ParseWarning } from '../../lib/types.ts'

const MAX_SHOWN = 50

/** Lines of the points file that could not be read, so a bad line never silently disappears. */
export function SkippedLinesPanel({ warnings }: { warnings: ParseWarning[] }) {
  return (
    <Accordion title="Skipped lines" badge={<span className="badge">{warnings.length}</span>}>
      <ul className="warn-list">
        {warnings.slice(0, MAX_SHOWN).map((w, i) => (
          <li key={i}>
            <b>Line {w.line}:</b> {w.reason}
            <code>{w.text}</code>
          </li>
        ))}
      </ul>
    </Accordion>
  )
}
