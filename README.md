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

Deployed automatically by `.github/workflows/deploy.yml`: every push to `main` builds the app and publishes `dist/` via GitHub's `actions/deploy-pages`. There's no `docs/` folder to copy by hand — **Settings → Pages → Build and deployment → Source** just needs to be set to **GitHub Actions** (one-time setup; see below if it's currently set to "Deploy from a branch" instead). The live URL is `https://StumpHugelarge.github.io/PedalPatcher/`.

`.github/workflows/test.yml` runs on every push and pull request too — it builds the app and runs the committed Playwright regression check (`tests/regression.mjs`) against it, so a broken interaction gets caught before it reaches `main`, separately from whether the code merely compiles.

`.github/workflows/update-pedal-data.yml` runs weekly (Mondays), checks PedalPlayground's pedal/pedalboard lists for changes, and — only if something changed — commits the new `public/data/*.json` plus `public/data/changes.json` (which drives the in-app "pedal library updated" notice) and triggers a fresh deploy. Because this pushes with the workflow's own built-in token, which doesn't trigger other workflows' `push` events, it explicitly runs `gh workflow run deploy.yml` afterward rather than relying on that push alone.

**If Pages is still set to "Deploy from a branch"** (an older `/docs`-folder setup this project used for a while): go to **Settings → Pages → Build and deployment → Source** and switch it to **GitHub Actions**. The very next push — or a manual run of `deploy.yml` from the Actions tab (**Run workflow**) — will then actually publish. Before this switch, the weekly data-sync workflow could run "successfully" every week without the new data ever reaching the live site, since the branch it was pushing to wasn't the one Pages was serving from.

`vite.config.ts` sets `base: "/PedalPatcher/"` to match — required because this is a project page (`username.github.io/PedalPatcher/`), not a root page (`username.github.io/`).

No environment variables, accounts, or backend services are needed — `npm run build` produces a `dist/` folder that can be hosted anywhere that serves static files (GitHub Pages, Vercel, Netlify, or just opened via a local static server).

## Testing

`npm run test:e2e` builds nothing itself — run `npm run build` first, then it starts a local preview server and drives it with a headless Chromium (Playwright) through the handful of interactions that have broken silently before: free-drag distance, multi-select/duplicate, undo/redo, snap-to-jack routing and its elbow drag handle, and the snap-to-neighbor alignment guide. The browser binary isn't downloaded by `npm install` — run `npx playwright install chromium` once first. `.github/workflows/test.yml` does both of these automatically on every push/PR; see `tests/regression.mjs` for what's actually checked, and add to it whenever a bug like one of the above gets fixed.

## What's implemented

- **Boards.** Multiple named boards in one project (tabs across the top), each with its own width/height (inches) and color — so you can compare how a set of pedals fits across a few different boards, per the original ask.
- **Pedalboard presets.** The board-settings panel has a brand-grouped dropdown of ~260 real pedalboard models (Pedaltrain, Temple Audio, Rockboard, Voodoo Lab, and more, from Pedal Playground's own `pedalboards.json`) — picking one sets the board's name, width, and height to match instead of you having to measure and type it in by hand.
- **Pedal library.** Search across Pedal Playground's ~8,500-pedal community dataset by brand or model; drag a result onto the board, or use its **+** button. A custom-pedal form covers anything not in that dataset (DIY builds, boutique pedals) — brand, model, footprint, and an optional image URL.
- **Layout.** Freely drag placed pedals anywhere on the board (no travel-distance limit), rotate in 90° steps, and delete via the inspector panel or the Delete/Backspace key. Overlapping pedals or ones hanging off the board edge get a dashed outline as a soft warning, not a hard block.
- **Multi-select, copy & duplicate.** Shift-click pedals (or shift-drag a lasso over empty board space) to select several at once — the inspector shows a "Duplicate here" button (copies the set with an offset onto the same board, carrying along any connections that run *between* the selected pedals) plus a "Copy" action. Ctrl/Cmd+C copies a selection, and Ctrl/Cmd+V — or the "Paste N pedals here" button that appears in the board panel — pastes it onto whichever board is currently active, so switching board tabs after copying duplicates a set of pedals onto a different board.
- **Zoom.** A floating zoom control (bottom-right of the board) with −/+/Fit buttons and a live percentage readout, plus Ctrl/Cmd+scroll-wheel zoom — matching Pedal Playground's scale control. "Fit" returns to automatic fit-to-window sizing; +/− (or the wheel) switch to a manual zoom level that persists until you hit Fit again.
- **Multi-jack pedals.** Every pedal starts with a single input/output, matching a plain mono chain. Selecting a pedal reveals five checkboxes — **Stereo I/O** (2nd input + output), **MIDI** (MIDI in + out), **Send/return** (effects loop), **Direct out**, and **Expression in** — since Pedal Playground's dataset doesn't carry per-pedal jack data, these are per-instance toggles rather than something inferred automatically. A model's jack choices are remembered and pre-applied the next time you add a copy of it. Patching is unrestricted — any jack can connect to any other except another jack on the same pedal — since plenty of real pedals route non-standard combinations (an expression input feeding a MIDI converter, a send used as a second output, and so on).
- **Signal flow.** Two line-drawing modes, toggled per line: **snap-to-jack** (click an output, click an input — the line re-routes automatically if either pedal moves, using a right-angle route rather than one straight diagonal line) and **freeform** (click any two points, including empty board space, matching how you'd draw a connector in Visio). Selecting a snapped connection reveals a small square drag handle at its elbow — drag it in any direction to route the line around another pedal instead of through it. Each line has a cable type (instrument / patch / send-return / MIDI / power) that controls its color and dash style. The inspector shows each connection's actual routed length and rounds it up to a real cable size to buy (see Cable planning, below).
- **Signal chain reader.** The board panel traces the snap-to-jack graph (following sends/returns and direct outs) into plain-English signal paths — "Guitar → Boss DS-1 → Strymon Timeline → Amp" — and separately calls out feedback loops, pedals that aren't patched to anything, switched-on jacks nothing is plugged into, and MIDI/freeform cables that aren't part of the audio path.
- **Cable planning.** Each connection's inspector panel shows its real routed length (including the lead-in stubs and elbow bend, not just a straight-line distance) and the nearest standard cable size to buy for it. The board panel totals this across every connection into a shopping list — "Buy: 2× 6", 1× 1 ft".
- **Undo/redo.** Every layout, jack, cable, and board-settings change is one undo step (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y, or the toolbar buttons) — a continuous drag or elbow-handle drag only commits once, on release, so it undoes as a single step rather than one per pixel moved.
- **Pedal notes & custom pedal color.** Any pedal can carry free-text notes (settings, model, reminders) shown as a small dot on its face when present. A custom pedal (not from the Pedal Playground dataset) also gets a color swatch used when it has no image.
- **"My pedals."** A custom pedal can be saved to a personal library (stored per-device, not in the project file) so it can be dropped onto any future project instead of re-entering its brand/model/dimensions/image each time. Saving the same brand/model/size again updates the existing entry rather than duplicating it.
- **Export & sharing.** "Download PNG" renders the active board at a fixed 150dpi, independent of the on-screen zoom level, and respects light/dark mode. "Print / Save as PDF" uses the browser's native print dialog. "Share board" builds a read-only link with the whole board encoded in the URL's hash fragment — nothing is uploaded anywhere, so there's no backend and no real length limit beyond "is this a reasonable link to send someone." Opening a share link shows a static rendered image of that board with a "Duplicate to edit" button that imports it into your own local project.
- **Save/load.** "Save" and "Open" use the browser's File System Access API where available (Chrome, Edge) for a real open/save-to-the-same-file feel; Safari and Firefox fall back to a plain file download and an upload picker. A project file is a JSON array of boards — human-readable, diffable, and safe to hand-edit if something needs fixing outside the app. The current board also autosaves to the browser's local storage as crash recovery between explicit saves. Older saves/autosaves that predate multi-jack pedals migrate automatically the first time they load.
- **Position snapping.** Two independent, personal (per-device, not saved in the project) toggles in the toolbar: **Snap: grid** rounds a dragged pedal's position to the nearest half-inch, and **Snap: neighbors** lines its edges up with a nearby pedal's edges within a few screen pixels — shown live as a thin guide line along the matched edge while dragging, so the snap is visible rather than the pedal just seeming to jump.
- **Pedal data stays current.** A weekly GitHub Actions workflow re-syncs the pedal and pedalboard-model lists from Pedal Playground; when something changed, visitors see a one-time "pedal library updated" notice summarizing what's new.

## Pedal data & attribution

Pedal names/dimensions live in `public/data/pedals.json`, and pedalboard model dimensions live in `public/data/pedalboards.json` — both one-time snapshots pulled from [PedalPlayground/pedalplayground](https://github.com/PedalPlayground/pedalplayground) on GitHub (see the credit link in the app's library panel). Pedal *images* are **not** copied into this repo — they're fetched at render time directly from PedalPlayground's own hosting (`src/pedalData.ts`, `PEDAL_DATA_SOURCE.imageBase`). Two reasons: it avoids bundling ~8,500 rehosted images, and the PedalPlayground repo states no explicit reuse license for the image assets specifically (only its application code is ISC-licensed). If this app is ever distributed beyond personal use, that's worth raising with the PedalPlayground maintainer first — see `src/pedalData.ts` for the full note.

Because images are fetched live from GitHub's raw content host, they require normal internet access to load; there's no offline image cache in v0.

## Known v0 limitations

- All five jack toggles sit at fixed positions per pedal (inputs on a pedal's right edge and outputs on its left, like a real pedal seen from above; the 2nd input/output share those same edges, everything else — MIDI, send/return, direct out, expression in — shares the top edge), not real per-model jack data — Pedal Playground's dataset doesn't include jack layouts. Power jacks still aren't modeled; draw those as freeform lines.
- A snapped connection's right-angle route has one adjustable bend (drag the handle in any direction); it doesn't automatically route around pedals in its path — you dodge them by hand.
- Dragging one pedal in a multi-pedal selection moves only that pedal, not the whole group.
- Freeform lines are a single straight segment between two points, not multi-point polylines, and aren't included in the cable-length shopping list or the signal chain reader (only snap-to-jack cables are).
- No power-supply current-draw budgeting yet — see the design spec's roadmap (§05) for what's next.
- Rotation is limited to 90° steps.

## Project structure

```
src/
  types.ts           data model (Board, PlacedPedal, Connection, jack options, …)
  store.ts            central state + undo/redo + autosave + clipboard, no framework
  geometry.ts          rotation/footprint/jack-position math
  cableMath.ts          cable lead-ins, elbow routing, length/shopping-list math
  chain.ts               traces snap-to-jack connections into signal-order paths
  export.ts               renders a board to a <canvas> for the PNG download
  shareLink.ts             encodes/decodes a board into a URL hash fragment
  prefs.ts                  personal settings: snap toggles, jack presets, "My pedals"
  updateNotice.ts            the one-time "pedal library updated" notice
  pedalData.ts               loads + searches the pedal library, builds image URLs
  pedalboardData.ts           loads the pedalboard-model preset list
  fileIO.ts                  save/open via File System Access API + fallback
  dragState.ts               drag-from-library-panel-to-board plumbing
  dom.ts                     tiny element-creation helper (no framework)
  ui/
    board.ts          the board canvas: pedals, jacks, connections, drag/drop, snap guides
    library.ts         search, "My pedals", custom-pedal form
    inspector.ts        selected pedal/connection/board properties panel, signal chain
    toolbar.ts           board tabs, draw-mode toggle, undo/redo, save/open, export/share
tests/
  regression.mjs        committed Playwright end-to-end check — see Testing, above
```

No UI framework — plain TypeScript and DOM/SVG. State changes flow through a single store (`store.ts`) with a subscribe/emit pattern; the whole UI re-renders on change, which is simple and fast enough at pedalboard scale (a handful to a few dozen pedals). Personal preferences (`prefs.ts`) deliberately live outside that store — they're per-device, not part of a project file, a share link, or undo history.
