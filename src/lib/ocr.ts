/**
 * Reading the text of a deed in the browser: the text layer of a PDF when it has one, otherwise OCR of each page. Both libraries are
 * large, so they are loaded only when a deed is read. Nothing is uploaded: the page images stay in this tab. (The OCR engine downloads
 * its language data from a CDN the first time.)
 */

export interface ReadProgress {
  page: number
  pages: number
  stage: 'opening' | 'text layer' | 'recognising'
}

export interface DeedText {
  text: string
  /** How the text was got: from the PDF's own text, by OCR, or both (some pages each). */
  method: 'text layer' | 'OCR' | 'text layer and OCR'
  pages: number
}

/** A page with at least this many characters of real text is read from the text layer. */
const TEXT_LAYER_MIN = 200
/** Pages are drawn this many times larger than the PDF's 72 dpi before OCR: small type needs the pixels. */
const OCR_SCALE = 3

export async function readDeedText(file: Blob, type: string, onProgress: (p: ReadProgress) => void, signal?: AbortSignal): Promise<DeedText> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng')
  // stopping ends the OCR engine itself, so a page in the middle of recognising stops using the processor at once
  const stop = () => void worker.terminate().catch(() => {})
  if (signal?.aborted) {
    stop()
    throw new Error('Reading was stopped.')
  }
  signal?.addEventListener('abort', stop)
  try {
    if (type.startsWith('image/')) {
      onProgress({ page: 1, pages: 1, stage: 'recognising' })
      const r = await worker.recognize(file)
      return { text: r.data.text, method: 'OCR', pages: 1 }
    }
    onProgress({ page: 0, pages: 0, stage: 'opening' })
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    const base = import.meta.env.BASE_URL + 'pdfjs/'
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: base + 'wasm/', standardFontDataUrl: base + 'standard_fonts/' }).promise
    let text = ''
    let used = { layer: false, ocr: false }
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      onProgress({ page: n, pages: doc.numPages, stage: 'text layer' })
      const layer = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
      if (layer.length >= TEXT_LAYER_MIN) {
        text += layer + '\n'
        used = { ...used, layer: true }
        continue
      }
      onProgress({ page: n, pages: doc.numPages, stage: 'recognising' })
      const viewport = page.getViewport({ scale: OCR_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser cannot draw the page for reading.')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      text += (await worker.recognize(canvas)).data.text + '\n'
      used = { ...used, ocr: true }
    }
    return { text, method: used.layer && used.ocr ? 'text layer and OCR' : used.layer ? 'text layer' : 'OCR', pages: doc.numPages }
  } finally {
    signal?.removeEventListener('abort', stop)
    await worker.terminate().catch(() => {})
  }
}
