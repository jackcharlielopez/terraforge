/**
 * Reading a deed with a vision model, through the optional local backend (`npm run server`, see server/). Unlike everything else in
 * the app this SENDS the page images to a model provider, so it is behind `FEATURES.aiRead`, off in the deployed build, and only ever
 * runs when the user asks for it on one deed. What comes back is only calls: `useDeedReading` checks them like any other read.
 */
import type { Tract } from './deedcalls.ts'

/** Pages are drawn at this many times the PDF's 72 dpi; the longest side is capped to keep the upload small. */
const SCALE = 2
const MAX_SIDE = 3000

async function canvasPng(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('This browser could not make an image of the page.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Each page of the deed as a base64 PNG. */
export async function pageImages(file: Blob, type: string): Promise<string[]> {
  const make = (w: number, h: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w)
    canvas.height = Math.round(h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot draw the page.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return { canvas, ctx }
  }
  if (type.startsWith('image/')) {
    const bmp = await createImageBitmap(file).catch(() => {
      throw new Error('This image format cannot be shown by the browser; convert it to PDF or PNG first.')
    })
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const { canvas, ctx } = make(bmp.width * k, bmp.height * k)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return [await canvasPng(canvas)]
  }
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const base = import.meta.env.BASE_URL + 'pdfjs/'
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: base + 'wasm/', standardFontDataUrl: base + 'standard_fonts/' }).promise
  const out: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const v1 = page.getViewport({ scale: SCALE })
    const viewport = page.getViewport({ scale: SCALE * Math.min(1, MAX_SIDE / Math.max(v1.width, v1.height)) })
    const { canvas, ctx } = make(viewport.width, viewport.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    out.push(await canvasPng(canvas))
  }
  return out
}

export interface AiDeedResult {
  id: string
  tracts?: (Tract & { retried?: boolean })[]
  pages: number
  seconds?: number
  error?: string
}

/** All the deeds in one request and one response: the pages are drawn here, the server reads every deed at once. */
export async function processDeeds(deeds: { id: string; file: Blob; type: string }[], points: string): Promise<AiDeedResult[]> {
  const drawn = await Promise.all(deeds.map(async (d) => ({ id: d.id, images: await pageImages(d.file, d.type).catch((e: unknown) => e instanceof Error ? e : new Error('The pages could not be drawn.')) })))
  const sendable = drawn.filter((d): d is { id: string; images: string[] } => Array.isArray(d.images))
  const failed: AiDeedResult[] = drawn.filter((d) => !Array.isArray(d.images)).map((d) => ({ id: d.id, pages: 0, error: (d.images as Error).message }))
  if (sendable.length === 0) return failed
  let r: Response
  try {
    r = await fetch(import.meta.env.BASE_URL + 'api/process', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deeds: sendable, points }) })
  } catch {
    throw new Error('The AI reader is not running. Start it with "npm run server".')
  }
  const body = (await r.json().catch(() => ({}))) as { results?: (Omit<AiDeedResult, 'pages'>)[]; error?: string }
  if (!r.ok || !body.results) throw new Error(body.error ?? `The AI reader failed (${r.status}).`)
  const pages = new Map(sendable.map((d) => [d.id, d.images.length]))
  return [...failed, ...body.results.map((x) => ({ ...x, pages: pages.get(x.id) ?? 0 }))]
}
