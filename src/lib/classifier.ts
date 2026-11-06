/**
 * Seam for AI-assisted code classification (Phase 2). The UI already collects the
 * unknown codes; a backend-backed implementation can plug in here later.
 * AI only *suggests*: the surveyor accepts or edits every suggestion.
 */
export interface CodeSuggestion {
  /** The unknown description token. */
  code: string
  layer: string
  connect: boolean
  /** 0..1 */
  confidence: number
  reason?: string
}

export interface CodeClassifier {
  classify(codes: string[]): Promise<CodeSuggestion[]>
}

export const noopClassifier: CodeClassifier = {
  classify: async () => [],
}
