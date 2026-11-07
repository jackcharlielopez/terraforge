import { FEATURES } from '../lib/features.ts'
import { Fragment, useRef } from 'react'
import type { ReactNode } from 'react'
import { ACCEPT, KIND_LABEL } from '../lib/files.ts'
import { StatusIcon } from './StatusIcon.tsx'
import type { Status } from './StatusIcon.tsx'
import type { FileKind } from '../lib/files.ts'

export interface SlotInfo {
  /** What is loaded, e.g. a file name; null when empty. */
  name: string | null
  detail?: string
  /** A longer explanation of the status, shown on hover. */
  note?: string
  /** Reading (spinner), done (check), needs a look (warning) or failed (error). Absent when nothing is loaded. */
  state?: Status
}

interface Props {
  points: SlotInfo
  /** Deeds attached; `name` is a summary line such as "3 deeds". */
  deed: SlotInfo
  reference: SlotInfo
  /** The attached deeds, shown as a drop-down under the Deed slot. */
  deedList?: ReactNode
  /** The Process with AI button under the files; absent when the AI feature is off. */
  aiAction?: { disabled: boolean; busy: boolean; title: string; onClick: () => void }
  /** A slot's own picker forces its kind; dropping on the page classifies by extension. */
  onFiles: (files: File[], force?: Exclude<FileKind, 'unknown'>) => void
  onClearDeeds: () => void
  onClearReference: () => void
}

const SLOTS = [
  { kind: 'points', hint: 'Point, Northing, Easting, Elevation, Description (.txt, .csv)' },
  { kind: 'deed', hint: 'Deeds and plats (.pdf or image), one or many. '+(FEATURES.aiRead ? 'Read in your browser; nothing leaves it unless you click Process with AI' : 'Read in your browser; nothing is uploaded') },
  { kind: 'reference', hint: 'Optional: a finished .dxf to draw alongside and compare against' },
] as const

const ICON = { points: '•', deed: '▤', reference: '◫' } as const

export function FileSlots({ points, deed, reference, deedList, aiAction, onFiles, onClearDeeds, onClearReference }: Props) {
  const refs = {
    points: useRef<HTMLInputElement>(null),
    deed: useRef<HTMLInputElement>(null),
    reference: useRef<HTMLInputElement>(null),
  }
  const info = { points, deed, reference }

  return (
    <ul className="slots">
      {SLOTS.filter((s) => s.kind !== 'reference' || FEATURES.compare).map(({ kind, hint }) => {
        const slot = info[kind]
        return (
          <Fragment key={kind}>
          <li className={'slot' + (slot.name && (!slot.state || slot.state === 'ok') ? ' filled' : '') + (slot.state ? ' ' + slot.state : '')}>
            {slot.state ? (
              <StatusIcon status={slot.state} label={slot.note ?? (slot.detail ? `${KIND_LABEL[kind]}: ${slot.detail}` : undefined)} />
            ) : (
              <span className="slot-icon" aria-hidden="true">{slot.name ? '✓' : ICON[kind]}</span>
            )}
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
          {kind === 'deed' && deedList && <li className="slot-sub">{deedList}</li>}
          </Fragment>
        )
      })}
      {aiAction && (
        <li className="slot-ai">
          <button type="button" className="btn btn-amber" disabled={aiAction.disabled || aiAction.busy} title={aiAction.title} onClick={aiAction.onClick}>
            {aiAction.busy ? 'Processing with AI…' : 'Process with AI'}
          </button>
        </li>
      )}
    </ul>
  )
}

