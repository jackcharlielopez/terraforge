/** Save text or a blob to the user's machine through a temporary link. */
export function downloadFile(content: BlobPart, filename: string, type: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** A copy of `set` with `item` added if it was absent, removed if it was present (for React state). */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return next
}
