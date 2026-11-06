/**
 * AutoCAD Colour Index (ACI) helpers.
 *
 * DXF R12 can only store an ACI number (1-255) per layer, not an arbitrary RGB colour. The app
 * lets people pick any colour; the preview shows it exactly and the DXF gets the nearest ACI.
 */
type Rgb = [number, number, number]

const BASIC: Rgb[] = [
  [0, 0, 0], // 0 (BYBLOCK, unused)
  [255, 0, 0],
  [255, 255, 0],
  [0, 255, 0],
  [0, 255, 255],
  [0, 0, 255],
  [255, 0, 255],
  [255, 255, 255], // 7: white on a dark background, black on a light one
  [128, 128, 128],
  [192, 192, 192],
]

/** Brightness of each pair of shades within a hue (full saturation, then half). */
const VALUE = [1, 0.8, 0.6, 0.5, 0.3]

function hsv(h: number, s: number, v: number): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)]
}

/** The 256-entry palette: 1-9 basic, 10-249 = 24 hues x 10 shades, 250-255 greys. */
const PALETTE: Rgb[] = (() => {
  const p: Rgb[] = [...BASIC]
  for (let i = 10; i <= 249; i++) {
    const hue = Math.floor((i - 10) / 10) * 15
    const row = (i - 10) % 10
    p[i] = hsv(hue, row % 2 === 0 ? 1 : 0.5, VALUE[Math.floor(row / 2)])
  }
  for (let i = 250; i <= 255; i++) {
    const g = [51, 91, 132, 173, 214, 255][i - 250]
    p[i] = [g, g, g]
  }
  return p
})()

export function aciToRgb(aci: number): Rgb {
  return PALETTE[aci] ?? PALETTE[7]
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** '#rgb', '#rrggbb' or 'rrggbb' -> '#rrggbb' (lower case), or null if not a colour. */
export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex) ?? '#000000'
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

/** Closest AutoCAD index colour to a hex colour (colour 7 is skipped: it flips between black and white). */
export function nearestAci(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  let best = 1
  let bestD = Infinity
  for (let i = 1; i <= 255; i++) {
    if (i === 7) continue
    const [pr, pg, pb] = PALETTE[i]
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Colour for drawing on the app's light paper background (white and very light yellows would vanish). */
export function aciToHex(aci: number): string {
  if (aci === 7) return '#1a1f1c'
  if (aci === 2) return '#b8860b'
  if (aci === 3) return '#2e8b57'
  if (aci === 4) return '#008b8b'
  return rgbToHex(aciToRgb(aci))
}
