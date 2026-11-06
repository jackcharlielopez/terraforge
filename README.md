# TerraForge

Browser-only tool for surveyors: upload a point file (`P,N,E,Z,D` text) and get a DXF.
Everything runs client-side so it can be hosted on GitHub Pages.

## Develop
```
npm install
npm run dev     # http://localhost:5173/terraforge/
npm test        # vitest: parser, codes, linework, DXF writer
npm run build
```

Project decisions, open items and status live in [PROJECT.md](PROJECT.md). Keep it updated.

## How descriptions are read
There is no dictionary to load or edit. What a description means is worked out by built-in rules (`src/lib/rules.ts`): the starter codes in `src/data/starter-codes.json`
are the built-in knowledge for common surveyor codes, and everything else is decided from the words in the description (a stake or post stays a point; every `FENCE`
wording is one fence; `CL <road>` is a road centreline and `CL <creek>` a stream; `TREE LINE` and `EDGE OF FIELD` are one tree line; any other description used twice or more is
a line of its own). Drop a points file (`.txt`, `.csv`, `.asc`), a deed `.pdf` and a finished `.dxf` (to compare against) onto the canvas to start. `deriveRules` takes an `overrides` map,
which is where an AI classifier can plug in later.

## How lines are drawn
A line runs through shots of one kind taken one after another, and breaks when another kind of shot comes between, after `END`, or across a gap. Put these in a
point's description to steer it: `END` (finish here), `BEG` (start a new line here), `CLO` (close it), or a number after the code (`BLDG1`, `BLDG2`) for separate
lines; a numbered `BLDG` closes into a polygon. The linework settings (gap, discipline, turn limit) are fixed in code. Lines are also not allowed to cross each other: a segment that would cross another is left out (overhead power, pipes and property lines are exempt).

## When point numbers are out of order
Lines are normally found from shot order and codes, which is far more accurate when the numbering follows the work. TerraForge measures how orderly the numbers are; if they look scrambled it joins points by position instead and tells you.

## Reading a deed
Drop one or many deeds and plats (PDF or image) on the canvas, open the **Deeds** panel and press **Read all** (or **Read the land description** on one). The text comes from the PDF itself or from OCR in your browser (the deed is not uploaded; the OCR engine downloads its language data the first time). The calls (bearings and distances) are pulled out by rules and checked: they must close and match the acreage the deed states. A read that does not is marked "Not trusted" and nothing is drawn. **Place on the drawing** fits the outline to the iron pins found in the field and draws it as the property line. For scanned PDFs the decoders in `public/pdfjs/` are copied from `node_modules` by `npm run dev` / `npm run build`.

## Review mode
**Review** (top bar) marks the lines that were guessed (dashed amber), lets you keep or remove any line and add missing ones, and keeps a log of your changes on this computer only. **Export log** saves it as a file (positions relative to the job's centre; no file or client name).
