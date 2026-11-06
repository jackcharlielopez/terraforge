import { useRef } from 'react'
import { ACCEPT, KIND_LABEL } from '../lib/files.ts'
import type { FileKind } from '../lib/files.ts'

export interface SlotInfo {
  /** What is loaded, e.g. a file name; null when empty. */
  name: string | null
  detail?: string
}

interface Props {
  points: SlotInfo
  /** Deeds attached; `name` is a summary line such as "3 deeds". */
  deed: SlotInfo
  reference: SlotInfo
  /** A slot's own picker forces its kind; dropping on the page classifies by extension. */
  onFiles: (files: File[], force?: Exclude<FileKind, 'unknown'>) => void
  onClearDeeds: () => void
  onClearReference: () => void
}

const SLOTS = [
  { kind: 'points', hint: 'Point, Northing, Easting, Elevation, Description (.txt, .csv)' },
  { kind: 'deed', hint: 'Deeds and plats (.pdf or image), one or many. Read in your browser; nothing is uploaded' },
  { kind: 'reference', hint: 'Optional: a finished .dxf to draw alongside and compare against' },
] as const

const ICON = { points: '•', deed: '▤', reference: '◫' } as const

export function FileSlots({ points, deed, reference, onFiles, onClearDeeds, onClearReference }: Props) {
  const refs = {
    points: useRef<HTMLInputElement>(null),
    deed: useRef<HTMLInputElement>(null),
    reference: useRef<HTMLInputElement>(null),
  }
  const info = { points, deed, reference }

  return (
    <ul className="slots">
      {SLOTS.map(({ kind, hint }) => {
        const slot = info[kind]
        return (
          <li key={kind} className={'slot' + (slot.name ? ' filled' : '')}>
            <span className="slot-icon" aria-hidden="true">{slot.name ? '✓' : ICON[kind]}</span>
            <div className="slot-text">
              <strong>{KIND_LABEL[kind]}</strong>
              <span className="muted small slot-detail" title={slot.name ?? hint}>
                {slot.name ? slot.name + (slot.detail ? ` · ${slot.detail}` : '') : hint}
              </span>
            </div>
            <input
              ref={refs[kind]}
              type="file"
              hidden
              accept={ACCEPT[kind]}
              multiple={kind === 'deed'}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                if (picked.length > 0) onFiles(kind === 'deed' ? picked : picked.slice(0, 1), kind)
                e.target.value = ''
              }}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => refs[kind].current?.click()}>
              {kind === 'deed' ? (slot.name ? 'Add more' : 'Choose') : slot.name ? 'Replace' : 'Choose'}
            </button>
            {kind === 'deed' && deed.name && (
              <button type="button" className="btn btn-outline btn-sm" aria-label="Remove all deeds" onClick={onClearDeeds}>
                ✕
              </button>
            )}
            {kind === 'reference' && reference.name && (
              <button type="button" className="btn btn-outline btn-sm" aria-label="Remove comparison drawing" onClick={onClearReference}>
                ✕
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

