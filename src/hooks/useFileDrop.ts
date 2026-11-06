import { useState } from 'react'
import type { DragEvent } from 'react'

/** Drag-and-drop of files onto an element: spread `handlers` on it and use `active` to show a drop hint. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [active, setActive] = useState(false)
  const handlers = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setActive(true)
    },
    onDragLeave: (e: DragEvent) => {
      // Moving onto a child fires leave on the parent; only clear when the pointer really left.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setActive(false)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setActive(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
  }
  return { active, handlers }
}
