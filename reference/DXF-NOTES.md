# Reference DXF findings

Source: `job-a.dxf` (a finished survey drawing; client data, kept locally). A finished, hand-drafted
deliverable from Civil 3D / Carlson-style tooling, not raw generator output.

## File
- AutoCAD 2018 (AC1032), CRLF, ANSI_1252, ~1 MB. Target for our writer: R2000 (AC1015) is enough.
- $INSUNITS = 0 (unitless), $MEASUREMENT = 0 (English). Coordinates are raw: X = Easting, Y = Northing, Z = elevation.
- 204 survey points in the DXF vs 202 in the sample .txt (the extra ones need explaining: the drafter's own control points).

## Per-point pattern (3 pieces, all on layer PNTS)
1. `INSERT SPT4`  - the point symbol block, at (E, N, Z).
2. `POINT`       - real DXF POINT at (E, N, Z) (so true 3D, PDMODE 0, PDSIZE 4).
3. `INSERT SRVPNO1` with 3 ATTRIBs (text height 1.0, style PTXT):
   - `PNTNO`   (layer PNTNO)   - point number, centered above
   - `PNTELEV` (layer PNTELEV) - elevation, to the right, below
   - `PNTDESC` (layer PNTDESC) - raw description, left/below
   Each point also carries XDATA (`PNTNO`, `PT_HANDLE`) linking the three.

## Layers (AIA/NCS style, prefix V- = survey)
Features seen carrying linework: V-PROP, V-PROP-SBCK, V-BLDG-OTLN, V-BLDG-PRCH, V-DTCH-TOPD, V-DTCH-CNTR,
V-ROAD-ASPH, V-DRIV-ASPH, V-DRIV-CONC, V-SWLK-CONC, V-SSWR-STRC, V-NODE-DECK, V-POWR-OVHD, V-WATR-PIPE,
V-NGAS-UNDR, V-SSWR-PIPE, V-ESMT. Symbols: V-POWR-POLE, V-WATR-STRC, V-SSWR-MHOL, V-NGAS-*.
Plus drafting layers: PNTS, PNTNO, PNTELEV, PNTDESC, LABEL, BRGTXT, CRDTXT, LEGEND, Text.
Custom linetypes are used for property lines, overhead power, gas, sewer, water, fence, etc.

## Linework = LWPOLYLINE, mostly open, vertices land exactly on survey points
Code -> layer, observed from which points sit on each polyline's vertices:
| Description code(s)                    | Layer            |
|----------------------------------------|------------------|
| IPF / IPS (property corners)           | V-PROP           |
| PP E-T (power poles)                   | V-POWR-OVHD (+ CG101 block on V-POWR-POLE) |
| TOP                                    | V-DTCH-TOPD      |
| CLD                                    | V-DTCH-CNTR      |
| EP / FOC / BOC / GUTTER (on the road)  | V-ROAD-ASPH      |
| EP / FOC (driveway apron)              | V-DRIV-ASPH      |
| C-DR                                   | V-DRIV-CONC      |
| CONC, CONC/EP, CONC/FOC/EP, CONC/BOC  | V-SWLK-CONC      |
| S-TANK                                 | V-SSWR-STRC      |
| CONC/EG                                | V-NODE-DECK      |
| STEPS, AC PAD, CRAWL SPACE             | V-BLDG-OTLN (on building outline) |

Caveats: building outlines are mostly NOT on survey points (91 of 107 vertices) - they are derived from
`3'O/S BLDG` offset shots, so a generator cannot reproduce them automatically. Many drafted lines also
mix codes (a CONC run picks up EP/FOC points), so "connect by shared code" is an approximation.

## Out of scope for the POC (present in the reference)
Title block, viewports, legend, north arrow, bar scale, bearing/distance labels (BRGTXT/CRDTXT), leaders,
MTEXT notes, raster IMAGEs, ACAD_TABLE, OBJECTS dictionary.
