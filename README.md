# Board & Chain

A single app for laying out a guitar pedalboard and drawing its signal flow — pedals get placed and sized to scale, and cables get drawn directly on top of that same layout, so the routing always reflects the current arrangement rather than a separately maintained diagram.

This is the v0/v1 build described in the [design spec](https://claude.ai/code/artifact/7e3df512-db32-49e4-94e3-39215c984561): a static, client-side app with no backend, using Pedal Playground's community pedal database and local project files.

## Running it

```
npm install
npm run dev       # local dev server with hot reload
npm run build      # type-checks, then builds dist/ for static hosting
npm run preview    # serves the production build locally
```

No environment variables, accounts, or backend services are needed — `npm run build` produces a `dist/` folder that can be hosted anywhere that serves static files (GitHub Pages, Vercel, Netlify, or just opened via a local static server).

## What's implemented

- **Boards.** Multiple named boards in one project (tabs across the top), each with its own width/height (inches) and color — so you can compare how a set of pedals fits across a few different boards, per the original ask.
- **Pedal library.** Search across Pedal Playground's ~8,500-pedal community dataset by brand or model; drag a result onto the board, or use its **+** button. A custom-pedal form covers anything not in that dataset (DIY builds, boutique pedals) — brand, model, footprint, and an optional image URL.
- **Layout.** Drag placed pedals anywhere on the board, rotate in 90° steps, and delete via the inspector panel or the Delete/Backspace key. Overlapping pedals or ones hanging off the board edge get a dashed outline as a soft warning, not a hard block.
- **Signal flow.** Two line-drawing modes, toggled per line: **snap-to-jack** (click an output, click an input — the line re-routes automatically if either pedal moves) and **freeform** (click any two points, including empty board space, matching how you'd draw a connector in Visio). Each line has a cable type (instrument / patch / send-return / MIDI / power) that controls its color and dash style.
- **Save/load.** "Save" and "Open" use the browser's File System Access API where available (Chrome, Edge) for a real open/save-to-the-same-file feel; Safari and Firefox fall back to a plain file download and an upload picker. A project file is a JSON array of boards — human-readable, diffable, and safe to hand-edit if something needs fixing outside the app. The current board also autosaves to the browser's local storage as crash recovery between explicit saves.

## Pedal data & attribution

Pedal names/dimensions live in `public/data/pedals.json`, a one-time snapshot pulled from [PedalPlayground/pedalplayground](https://github.com/PedalPlayground/pedalplayground) on GitHub (see the credit link in the app's library panel). Pedal *images* are **not** copied into this repo — they're fetched at render time directly from PedalPlayground's own hosting (`src/pedalData.ts`, `PEDAL_DATA_SOURCE.imageBase`). Two reasons: it avoids bundling ~8,500 rehosted images, and the PedalPlayground repo states no explicit reuse license for the image assets specifically (only its application code is ISC-licensed). If this app is ever distributed beyond personal use, that's worth raising with the PedalPlayground maintainer first — see `src/pedalData.ts` for the full note.

Because images are fetched live from GitHub's raw content host, they require normal internet access to load; there's no offline image cache in v0.

## Known v0 limitations

- Every pedal exposes exactly one input and one output jack for snap-to-jack routing. Effects loops, stereo pairs, MIDI, and power are expected to be drawn as freeform lines instead (this is why freeform mode exists alongside snap-to-jack, per the design spec's §03).
- Freeform lines are a single straight segment between two points, not multi-point polylines.
- No power-supply current-draw budgeting, cable-length estimates, or PNG/PDF export yet — see the design spec's roadmap (§05) for what's next.
- Rotation is limited to 90° steps.

## Project structure

```
src/
  types.ts        data model (Board, PlacedPedal, Connection, …)
  store.ts         central state + autosave, no framework
  geometry.ts       rotation/footprint/jack-position math
  pedalData.ts       loads + searches the pedal library, builds image URLs
  fileIO.ts          save/open via File System Access API + fallback
  dragState.ts       drag-from-library-panel-to-board plumbing
  dom.ts             tiny element-creation helper (no framework)
  ui/
    board.ts          the board canvas: pedals, jacks, connections, drag/drop
    library.ts         search + custom-pedal form
    inspector.ts        selected pedal/connection/board properties panel
    toolbar.ts           board tabs, draw-mode toggle, save/open
```

No UI framework — plain TypeScript and DOM/SVG. State changes flow through a single store (`store.ts`) with a subscribe/emit pattern; the whole UI re-renders on change, which is simple and fast enough at pedalboard scale (a handful to a few dozen pedals).
