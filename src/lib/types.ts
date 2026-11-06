export interface SurveyPoint {
  /** Point number exactly as written in the file (kept as text). */
  no: string
  n: number
  e: number
  z: number
  desc: string
  /** 1-based line number in the source file. */
  line: number
}

export interface ParseWarning {
  line: number
  text: string
  reason: string
}

export interface ParseResult {
  points: SurveyPoint[]
  warnings: ParseWarning[]
}

/** How one point's description maps onto the code dictionary. */
export interface PointMatch {
  /** Dictionary keys that matched (e.g. ["GUTTER","EP","GAS"]). */
  codes: string[]
  /** Description tokens with no dictionary entry. */
  unknown: string[]
  /** "3'O/S ..." offset shot: plotted, but never used for linework. */
  offset: boolean
  /** "END" token: terminates the linework runs this point belongs to. */
  end: boolean
  /** "BEG" token: starts a fresh line at this point instead of continuing the previous one. */
  begin: boolean
  /** "CLO" token: closes the lines this point belongs to back to their first point, then ends them. */
  close: boolean
  /** Number suffix on a code (`BLDG2` -> {BLDG: '2'}): lines with different numbers are separate. */
  lineIds: Record<string, string>
  /** Markers attached to one specific code ("+FN" begins FN's line, "-FN" ends it, "*FN" closes it). */
  controls: Record<string, { begin?: boolean; end?: boolean; close?: boolean }>
}

export interface CodeDef {
  /** Dictionary key, upper case. */
  code: string
  label: string
  layer: string
  /** Join consecutive points of this code with a polyline. */
  connect: boolean
  /** Codes sharing a `line` key are chained together (e.g. EP/FOC/BOC). Defaults to the code. */
  line?: string
  /** Close the polyline back to its first point. */
  closed?: boolean
  /** Per-code override of the global gap limit (e.g. power poles are far apart). 0 = no limit. */
  maxGap?: number
  /** Per-code override of how many shots of other kinds may interrupt a line (see LineworkOptions.maxSkip). */
  maxSkip?: number
  /** A numbered suffix (BLDG1, BLDG2...) makes separate lines, and this code closes each into a polygon. */
  closeNumbered?: boolean
  /** This kind of line may legitimately cross others (overhead power, pipes, property lines), so it is left out of crossing removal. */
  mayCross?: boolean
  /** A shot with this code may be a boundary monument (iron pin, monument): offered in the Boundary section. */
  boundary?: boolean
  /**
   * This code runs alongside another line (e.g. TOP, the ditch bank, alongside CLD, the ditch centreline). Its points are
   * split to either side of that line and each side is run along it, instead of zig-zagging in shot order.
   */
  alongside?: string
  /** Man-made, so it runs square to the rest of the site (sidewalks, curbs, walls): gap-filling only joins it along those directions. */
  rectilinear?: boolean
  /**
   * Where this line (e.g. a road edge) turns well away from its own long axis, it is a spur (a driveway off the road) and
   * is drawn on this layer instead. The axis is the long direction of all the points of that line.
   */
  spurLayer?: string
  /** How many degrees off the axis a segment must be to count as a spur (default 35). */
  spurAngle?: number
  /** When the same segment would be drawn on two layers, the layer with the higher priority keeps it (default 0; equal = both). */
  priority?: number
}

export interface Vertex {
  e: number
  n: number
  z: number
}

export interface Polyline {
  layer: string
  key: string
  /** Set from the code's `mayCross`: exempt from crossing removal. */
  mayCross?: boolean
  vertices: Vertex[]
  closed: boolean
}

export interface LayerDef {
  name: string
  /** AutoCAD colour index: what the DXF stores (1-255). */
  aci: number
  /** Exact colour picked by the user, shown in the preview. When absent the ACI colour is used. */
  hex?: string
  label: string
}
