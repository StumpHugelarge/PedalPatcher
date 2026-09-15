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

## Deploying to GitHub Pages

Currently deployed manually: **Settings → Pages → Build and deployment → Source** is set to **Deploy from a branch**, `main` / `/docs`. To publish an update, run `npm run build`, then copy `dist/index.html`, `dist/assets/`, and `dist/data/` into the repo's `docs/` folder (overwriting what's there) and commit. The live URL is `https://StumpHugelarge.github.io/PedalPatcher/`.

`vite.config.ts` sets `base: "/PedalPatcher/"` to match — required because this is a project page (`username.github.io/PedalPatcher/`), not a root page (`username.github.io/`).

A GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and publishes automatically on push is also in the repo if you'd rather switch back to that later — set **Source** back to **GitHub Actions** to use it instead of the manual `/docs` copy.

No environment variables, accounts, or backend services are needed — `npm run build` produces a `dist/` folder that can be hosted anywhere that serves static files (GitHub Pages, Vercel, Netlify, or just opened via a local static server).

## What's implemented

- **Boards.** Multiple named boards in one project (tabs across the top), each with its own width/height (inches) and color — so you can compare how a set of pedals fits across a few different boards, per the original ask.
- **Pedalboard presets.** The board-settings panel has a brand-grouped dropdown of ~260 real pedalboard models (Pedaltrain, Temple Audio, Rockboard, Voodoo Lab, and more, from Pedal Playground's own `pedalboards.json`) — picking one sets the board's name, width, and height to match instead of you having to measure and type it in by hand.
- **Pedal library.** Search across Pedal Playground's ~8,500-pedal community dataset by brand or model; drag a result onto the board, or use its **+** button. A custom-pedal form covers anything not in that dataset (DIY builds, boutique pedals) — brand, model, footprint, and an optional image URL.
- **Layout.** Freely drag placed pedals anywhere on the board (no travel-distance limit), rotate in 90° steps, and delete via the inspector panel or the Delete/Backspace key. Overlapping pedals or ones hanging off the board edge get a dashed outline as a soft warning, not a hard block.
- **Multi-select, copy & duplicate.** Shift-click pedals (or shift-drag a lasso over empty board space) to select several at once — the inspector shows a "Duplicate here" button (copies the set with an offset onto the same board, carrying along any connections that run *between* the selected pedals) plus a "Copy" action. Ctrl/Cmd+C copies a selection, and Ctrl/Cmd+V — or the "Paste N pedals here" button that appears in the board panel — pastes it onto whichever board is currently active, so switching board tabs after copying duplicates a set of pedals onto a different board.
- **Zoom.** A floating zoom control (bottom-right of the board) with −/+/Fit buttons and a live percentage readout, plus Ctrl/Cmd+scroll-wheel zoom — matching Pedal Playground's scale control. "Fit" returns to automatic fit-to-window sizing; +/− (or the wheel) switch to a manual zoom level that persists until you hit Fit again.
- **Multi-jack pedals.** Every pedal starts with a single input/output, matching a plain mono chain. Selecting a pedal reveals two checkboxes — **Stereo I/O** (adds a 2nd input + 2nd output) and **MIDI** (adds MIDI in + out) — since Pedal Playground's dataset doesn't carry per-pedal jack data, this is a per-instance toggle rather than something inferred automatically. A snap-to-jack line can only run between an input and an output of the same family (audio-to-audio or MIDI-to-MIDI); a mismatched attempt just cancels instead of creating a bad connection.
- **Signal flow.** Two line-drawing modes, toggled per line: **snap-to-jack** (click an output, click an input — the line re-routes automatically if either pedal moves, using a right-angle route rather than one straight diagonal line) and **freeform** (click any two points, including empty board space, matching how you'd draw a connector in Visio). Selecting a snapped connection reveals a small square drag handle at its elbow — drag it sideways to route the line around another pedal instead of through it. Each line has a cable type (instrument / patch / send-return / MIDI / power) that controls its color and dash style.
- **Save/load.** "Save" and "Open" use the browser's File System Access API where available (Chrome, Edge) for a real open/save-to-the-same-file feel; Safari and Firefox fall back to a plain file download and an upload picker. A project file is a JSON array of boards — human-readable, diffable, and safe to hand-edit if something needs fixing outside the app. The current board also autosaves to the browser's local storage as crash recovery between explicit saves. Older saves/autosaves that predate multi-jack pedals migrate automatically the first time they load.

## Pedal data & attribution

Pedal names/dimensions live in `public/data/pedals.json`, and pedalboard model dimensions live in `public/data/pedalboards.json` — both one-time snapshots pulled from [PedalPlayground/pedalplayground](https://github.com/PedalPlayground/pedalplayground) on GitHub (see the credit link in the app's library panel). Pedal *images* are **not** copied into this repo — they're fetched at render time directly from PedalPlayground's own hosting (`src/pedalData.ts`, `PEDAL_DATA_SOURCE.imageBase`). Two reasons: it avoids bundling ~8,500 rehosted images, and the PedalPlayground repo states no explicit reuse license for the image assets specifically (only its application code is ISC-licensed). If this app is ever distributed beyond personal use, that's worth raising with the PedalPlayground maintainer first — see `src/pedalData.ts` for the full note.

Because images are fetched live from GitHub's raw content host, they require normal internet access to load; there's no offline image cache in v0.

## Known v0 limitations

- Stereo I/O and MIDI jacks are a per-pedal on/off toggle at fixed positions (2nd input/output on the left/right edges, MIDI in/out on the top edge), not real per-model jack data — Pedal Playground's dataset doesn't include jack layouts. Power jacks still aren't modeled; draw those as freeform lines.
- A snapped connection's right-angle route has one adjustable bend (drag the handle left/right); it doesn't automatically route around pedals in its path — you dodge them by hand.
- Dragging one pedal in a multi-pedal selection moves only that pedal, not the whole group.
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
