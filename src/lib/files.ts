import { FEATURES } from './features.ts'

export type FileKind = 'points' | 'deed' | 'reference' | 'unknown'

const EXT: Record<Exclude<FileKind, 'unknown'>, string[]> = {
  points: ['txt', 'csv', 'asc', 'xyz', 'pnt', 'prn'],
  deed: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp'],
  reference: ['dxf'],
}

/** `accept` strings for the per-kind file pickers. */
export const ACCEPT: Record<Exclude<FileKind, 'unknown'>, string> = {
  points: EXT.points.map((e) => '.' + e).join(','),
  deed: EXT.deed.map((e) => '.' + e).join(',') + ',application/pdf,image/*',
  reference: '.dxf',
}

export const KIND_LABEL: Record<Exclude<FileKind, 'unknown'>, string> = {
  points: 'Survey points',
  deed: 'Deed',
  reference: 'Compare DXF',
}

/** Decide what a dropped file is from its extension. */
export function classifyFile(name: string): FileKind {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  for (const kind of ['points', 'deed', 'reference'] as const) if (EXT[kind].includes(ext) && (kind !== 'reference' || FEATURES.compare)) return kind
  return 'unknown'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type SortableKind = Exclude<FileKind, 'unknown'>

/** Largest file accepted per kind: past this the browser tab would struggle, or it is not a plausible file of that kind. */
export const MAX_BYTES: Record<SortableKind, number> = {
  points: 25 * 1024 * 1024,
  deed: 60 * 1024 * 1024,
  reference: 40 * 1024 * 1024,
}

/**
 * Sort dropped files: one points file and one comparison drawing (the first of each; extras are noted), and any number of deeds.
 * `force` is set when a slot's own picker was used. Unrecognised and over-size files are left out, each with a plain-words note.
 */
export function groupFiles(files: File[], force?: SortableKind): { picked: Partial<Record<Exclude<SortableKind, 'deed'>, File>>; deeds: File[]; notes: string[] } {
  const notes: string[] = []
  const groups: Record<SortableKind, File[]> = { points: [], deed: [], reference: [] }
  for (const f of files) {
    const kind = force === 'reference' && !FEATURES.compare ? 'unknown' : (force ?? classifyFile(f.name))
    if (kind === 'unknown') notes.push(`Skipped "${f.name}": expected points (.txt/.csv/.asc), a deed (.pdf or image)${FEATURES.compare ? ' or a .dxf to compare' : ''}.`)
    else groups[kind].push(f)
  }
  const picked: Partial<Record<Exclude<SortableKind, 'deed'>, File>> = {}
  const deeds = groups.deed.filter((f) => {
    const ok = f.size <= MAX_BYTES.deed
    if (!ok) notes.push(`Skipped "${f.name}": over ${formatSize(MAX_BYTES.deed)}.`)
    return ok
  })
  for (const kind of ['points', 'reference'] as const) {
    const [first, ...rest] = groups[kind]
    if (!first) continue
    if (rest.length > 0) notes.push(`Using "${first.name}"; ignored ${rest.length} other ${KIND_LABEL[kind].toLowerCase()} file(s).`)
    if (first.size > MAX_BYTES[kind]) notes.push(`Skipped "${first.name}": over ${formatSize(MAX_BYTES[kind])}.`)
    else picked[kind] = first
  }
  return { picked, deeds, notes }
}

/** Files chosen on the start screen, waiting for "Start survey": nothing has been read yet. */
export interface Staged {
  points: File | null
  reference: File | null
  deeds: File[]
}

export const EMPTY_STAGED: Staged = { points: null, reference: null, deeds: [] }

/**
 * Add files to what is waiting on the start screen. A new points file or comparison drawing replaces the one already staged; deeds are
 * added (the same name and size is not added twice). Returns the notes for anything left out.
 */
export function stageFiles(current: Staged, files: File[], force?: SortableKind): { staged: Staged; notes: string[] } {
  const { picked, deeds, notes } = groupFiles(files, force)
  const fresh = deeds.filter((f) => !current.deeds.some((d) => d.name === f.name && d.size === f.size))
  if (fresh.length < deeds.length) notes.push(`${deeds.length - fresh.length} deed(s) were already added.`)
  return {
    staged: { points: picked.points ?? current.points, reference: picked.reference ?? current.reference, deeds: [...current.deeds, ...fresh] },
    notes,
  }
}
