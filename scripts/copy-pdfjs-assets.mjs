// The PDF reader needs its image decoders (JBIG2, JPEG 2000) and fonts as plain files it can fetch at run time.
// Without the decoders, scanned deeds draw as blank pages. They are copied from the package into public/pdfjs/ (not committed).
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', 'pdfjs-dist')
if (!existsSync(from)) {
  console.warn('pdfjs-dist is not installed; skipping the copy of its decoders')
  process.exit(0)
}
for (const dir of ['wasm', 'standard_fonts']) {
  mkdirSync(join(root, 'public', 'pdfjs', dir), { recursive: true })
  cpSync(join(from, dir), join(root, 'public', 'pdfjs', dir), { recursive: true })
}
console.log('copied the PDF decoders and fonts to public/pdfjs/')
