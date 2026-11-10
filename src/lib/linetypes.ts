/**
 * The firm's line types, named as in their template and legend. In their drawings the layers are continuous and each line carries its
 * own line type, so that is what the DXF does too. Several of their patterns carry a letter (G, W, SS, OHP) or a small shape in the
 * gap, which R12 cannot hold: here the same dash and gap rhythm is kept with the letter slot left empty. Because the names match, a
 * drafter who brings the lines into their own drawing gets their full pattern (with the letters), as theirs is already defined there.
 *
 * Pattern numbers are drawing units at line-type scale 1 (positive = dash, negative = gap), as in the template.
 */
export interface LineType {
  name: string
  description: string
  pattern: number[]
}

export const LINETYPES: LineType[] = [
  { name: 'PL_1-00_0-10_1-00', description: 'Property line', pattern: [0.7, -0.3] },
  { name: 'FENCELINE2', description: 'Setback line, square in the gap', pattern: [0.25, -0.2, 1.0] },
  { name: 'CLINE_1-00_0-10_1-00', description: 'Road centreline', pattern: [0.7, -0.3] },
  { name: 'DASHED2', description: 'Dashed (utility easement, right of way)', pattern: [0.25, -0.125] },
  { name: 'CENTER', description: 'Center (easement)', pattern: [1.25, -0.25, 0.25, -0.25] },
  { name: 'BLDG_0-50_0-10_1-00', description: 'Building outline (marked solid line)', pattern: [0.05] },
  { name: 'FENCES_0-50_0-10_1-00', description: 'Fence (marked solid line)', pattern: [1.0] },
  { name: 'WATER1_0-75_0-07_1-00', description: 'Water line, W in the gap', pattern: [0.5036, -0.2464] },
  { name: 'SANITARY_1-50_0-10_1-00', description: 'Sanitary sewer, SS in the gap', pattern: [1.0274, -0.4726] },
  { name: 'OHP_1-50_0-10_1-00', description: 'Overhead power, OHP in the gap', pattern: [0.9102, -0.5898] },
  { name: 'GAS_0-50_0-10_1-00', description: 'Gas line, G in the gap', pattern: [0.3074, -0.1926] },
  { name: 'FENCELINE1', description: 'Silt fence, circle in the gap', pattern: [0.25, -0.2, 0.1] },
]

/** Which line type each feature layer's lines are drawn with, from the legend sheet and the finished drawings. */
export const LAYER_LINETYPE: Record<string, string> = {
  'V-PROP': 'PL_1-00_0-10_1-00',
  'V-PROP-SBCK': 'FENCELINE2',
  'V-ROAD-CNTR': 'CLINE_1-00_0-10_1-00',
  'V-ESMT': 'CENTER',
  'V-ESMT-UTIL': 'DASHED2',
  'V-RWAY-LINE': 'DASHED2',
  'V-BLDG-OTLN': 'BLDG_0-50_0-10_1-00',
  'V-SITE-FENC': 'FENCES_0-50_0-10_1-00',
  'V-WATR-PIPE': 'WATER1_0-75_0-07_1-00',
  'V-SSWR-PIPE': 'SANITARY_1-50_0-10_1-00',
  'V-POWR-OVHD': 'OHP_1-50_0-10_1-00',
  'V-NGAS-UNDR': 'GAS_0-50_0-10_1-00',
  'V-CTRL': 'FENCELINE1',
}

/** What the legend sheet calls each line. */
export const LAYER_LABEL: Record<string, string> = {
  'V-PROP': 'Property Line',
  'V-PROP-SBCK': 'M.B.S.L.',
  'V-ROAD-CNTR': 'Road - Centerline',
  'V-ESMT': 'Easement',
  'V-ESMT-UTIL': 'Utility Easement',
  'V-RWAY-LINE': 'Road R.O.W.',
  'V-BLDG-OTLN': 'Building Outline',
  'V-SITE-FENC': 'Fence',
  'V-WATR-PIPE': 'Water Line',
  'V-SSWR-PIPE': 'Sanitary Sewer',
  'V-POWR-OVHD': 'Overhead Powerline',
  'V-NGAS-UNDR': 'Gas Line',
  'V-CTRL': 'Silt Fence',
}

const BY_NAME = new Map(LINETYPES.map((l) => [l.name, l]))
export const lineTypeOf = (layer: string): LineType | undefined => {
  const name = LAYER_LINETYPE[layer]
  return name ? BY_NAME.get(name) : undefined
}
