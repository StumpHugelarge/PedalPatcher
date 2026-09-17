import { el, svgEl, clear } from "../dom";
import { store, pedalFootprint } from "../store";
import { clamp, getFootprint } from "../geometry";
import type { Footprint } from "../geometry";
import { pedalImageUrl } from "../pedalData";
import { pedalboardImageUrl } from "../pedalboardData";
import { onDrop } from "../dragState";
import { JACK_FAMILY, JACK_LABEL, JACK_ROLE } from "../types";
import type { LibraryPedal, PlacedPedal, Connection, CableType, JackId } from "../types";

const MIN_FIT_SCALE = 14;
const MAX_FIT_SCALE = 72;
const MIN_ZOOM_SCALE = 8;
const MAX_ZOOM_SCALE = 160;
const ZOOM_STEP = 1.25;
const ZOOM_REFERENCE = 40; // px/in shown as "100%"

const CABLE_STYLE: Record<CableType, { color: string; dash?: string; label: string }> = {
  instrument: { color: "var(--accent)", label: "Instrument" },
  patch: { color: "var(--accent-2)", label: "Patch" },
  "send-return": { color: "var(--accent)", dash: "1 6", label: "Send / return" },
  midi: { color: "#8b6fb3", dash: "4 3", label: "MIDI" },
  power: { color: "#b3413f", dash: "6 4", label: "Power" },
};

export function cableStyle(type: CableType) {
  return CABLE_STYLE[type];
}

// Snapped connections lead a short distance straight out from the pedal
// edge before bending, so the cable clears the pedal's outline (and its
// dashed collision/selection ring) instead of running flush along it.
const CABLE_LEAD_IN = 0.18; // inches

function leadPoint(
  fp: Footprint | undefined,
  jack: JackId,
  pos: { xIn: number; yIn: number }
): { xIn: number; yIn: number } {
  const dir = fp?.jackDirs[jack];
  if (!dir) return pos;
  return { xIn: pos.xIn + dir.dxIn * CABLE_LEAD_IN, yIn: pos.yIn + dir.dyIn * CABLE_LEAD_IN };
}

/** Two-bend ("Z") route for a snapped connection: from -> corner -> corner
 * -> to, through a single drag handle that can move in both directions.
 * `bend` is a signed inch offset from the natural (midpoint) via-point —
 * {0,0}/undefined renders as a plain straight line whenever both jacks
 * share a height, since all points end up collinear. */
function elbowPath(
  from: { xIn: number; yIn: number },
  to: { xIn: number; yIn: number },
  bend: { dx: number; dy: number } | undefined
): { xIn: number; yIn: number }[] {
  const midX = (from.xIn + to.xIn) / 2 + (bend?.dx ?? 0);
  const midY = (from.yIn + to.yIn) / 2 + (bend?.dy ?? 0);
  return [
    from,
    { xIn: midX, yIn: from.yIn },
    { xIn: midX, yIn: midY },
    { xIn: to.xIn, yIn: midY },
    to,
  ];
}

function elbowHandlePos(
  from: { xIn: number; yIn: number },
  to: { xIn: number; yIn: number },
  bend: { dx: number; dy: number } | undefined
): { xIn: number; yIn: number } {
  const midX = (from.xIn + to.xIn) / 2 + (bend?.dx ?? 0);
  const midY = (from.yIn + to.yIn) / 2 + (bend?.dy ?? 0);
  return { xIn: midX, yIn: midY };
}

function pointsAttr(points: { xIn: number; yIn: number }[], scale: number): string {
  return points.map((p) => `${p.xIn * scale},${p.yIn * scale}`).join(" ");
}

interface BoardViewOptions {
  library: Map<string, LibraryPedal>;
}

export function createBoardView(root: HTMLElement, opts: BoardViewOptions) {
  const scroll = el("div", { class: "board-scroll" });
  root.appendChild(scroll);

  let scale = 40;
  // null = auto-fit the board to the available space; a number = the user
  // has taken manual control via the zoom controls, in px per inch.
  let zoomOverride: number | null = null;

  const zoomLabel = el("span", { class: "zoom-pct" }, ["100%"]);
  const zoomBar = el("div", { class: "zoom-bar" }, [
    el("button", { class: "zoom-btn", title: "Zoom out", onclick: () => nudgeZoom(1 / ZOOM_STEP) }, ["−"]),
    zoomLabel,
    el("button", { class: "zoom-btn", title: "Zoom in", onclick: () => nudgeZoom(ZOOM_STEP) }, ["+"]),
    el("button", { class: "zoom-btn zoom-fit", title: "Fit board to window", onclick: () => setZoom(null) }, ["Fit"]),
  ]);
  root.appendChild(zoomBar);

  function nudgeZoom(factor: number) {
    setZoom(clamp((zoomOverride ?? scale) * factor, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE));
  }
  function setZoom(value: number | null) {
    zoomOverride = value;
    render();
  }

  new ResizeObserver(() => render()).observe(root);

  root.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll still scrolls the board normally
      e.preventDefault();
      nudgeZoom(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    },
    { passive: false }
  );

  onDrop((payload, clientX, clientY) => {
    const surfaceEl = scroll.querySelector<HTMLElement>(".board-surface");
    if (!surfaceEl) return;
    const rect = surfaceEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return; // dropped outside the board
    }
    const w = payload.kind === "library" ? payload.pedal.widthIn : payload.data.widthIn;
    const h = payload.kind === "library" ? payload.pedal.heightIn : payload.data.heightIn;
    const board = store.getActiveBoard();
    const xIn = clamp((clientX - rect.left) / scale - w / 2, 0, Math.max(0, board.widthIn - w));
    const yIn = clamp((clientY - rect.top) / scale - h / 2, 0, Math.max(0, board.heightIn - h));
    if (payload.kind === "library") {
      store.addPedalFromLibrary(payload.pedal, xIn, yIn);
    } else {
      store.addCustomPedal(payload.data, xIn, yIn);
    }
  });

  function computeScale(board: { widthIn: number; heightIn: number }) {
    if (zoomOverride !== null) return zoomOverride;
    const availW = root.clientWidth - 48;
    const availH = root.clientHeight - 48;
    if (availW <= 0 || availH <= 0) return scale;
    return clamp(Math.min(availW / board.widthIn, availH / board.heightIn), MIN_FIT_SCALE, MAX_FIT_SCALE);
  }

  function render() {
    const board = store.getActiveBoard();
    scale = computeScale(board);
    zoomLabel.textContent = `${Math.round((scale / ZOOM_REFERENCE) * 100)}%`;
    clear(scroll);

    const surface = el("div", {
      class: "board-surface",
      style: `width:${board.widthIn * scale}px;height:${board.heightIn * scale}px;background:${board.color};`,
    });
    scroll.appendChild(surface);

    if (board.image) {
      surface.appendChild(
        el("img", {
          class: "board-surface-image",
          src: pedalboardImageUrl(board.image),
          alt: "",
          draggable: false,
        })
      );
    }

    // Per-render lookups that let a drag-in-progress patch the DOM directly
    // (position, jacks, attached cables) instead of going through the store
    // on every pointermove — routing every frame through the store would
    // re-render the whole board and tear down the very element pointer
    // capture is attached to, which is why dragging used to stall after a
    // pixel or two.
    const pedalEls = new Map<string, HTMLElement>();
    const jackEls = new Map<string, Partial<Record<JackId, HTMLElement>>>();
    const liveConnections: { conn: Connection; el: SVGPolylineElement; handleEl: HTMLElement | null }[] = [];
    const footprintByPedalId = new Map<string, Footprint>();
    const livePos = new Map<string, { xIn: number; yIn: number }>();

    for (const p of board.pedals) {
      footprintByPedalId.set(p.id, pedalFootprint(p, opts.library));
      livePos.set(p.id, { xIn: p.xIn, yIn: p.yIn });
    }

    function recomputeCollisions() {
      const items = board.pedals.map((p) => ({
        id: p.id,
        pos: livePos.get(p.id)!,
        fp: footprintByPedalId.get(p.id)!,
      }));
      const flagged = findCollisions(items, board.widthIn, board.heightIn);
      for (const item of items) {
        pedalEls.get(item.id)?.classList.toggle("has-collision", flagged.has(item.id));
      }
    }

    function updateConnectionRoute(entry: { conn: Connection; el: SVGPolylineElement; handleEl: HTMLElement | null }) {
      const conn = entry.conn;
      const fromFp = footprintByPedalId.get(conn.from!.pedalId);
      const toFp = footprintByPedalId.get(conn.to!.pedalId);
      const p1 = fromFp?.jacks[conn.from!.jack];
      const p2 = toFp?.jacks[conn.to!.jack];
      if (!p1 || !p2) return;
      const p1L = leadPoint(fromFp, conn.from!.jack, p1);
      const p2L = leadPoint(toFp, conn.to!.jack, p2);
      entry.el.setAttribute("points", pointsAttr([p1, ...elbowPath(p1L, p2L, conn.bend), p2], scale));
      if (entry.handleEl) {
        const hp = elbowHandlePos(p1L, p2L, conn.bend);
        entry.handleEl.style.left = `${hp.xIn * scale}px`;
        entry.handleEl.style.top = `${hp.yIn * scale}px`;
      }
    }

    function updateLivePosition(pedal: PlacedPedal, xIn: number, yIn: number) {
      const lib = pedal.libraryId ? opts.library.get(pedal.libraryId) : null;
      const baseW = lib?.widthIn ?? pedal.custom!.widthIn;
      const baseH = lib?.heightIn ?? pedal.custom!.heightIn;
      const fp = getFootprint(xIn, yIn, baseW, baseH, pedal.rotation, {
        stereoIO: pedal.stereoIO,
        midi: pedal.midi,
        sendReturn: pedal.sendReturn,
        directOut: pedal.directOut,
        expIn: pedal.expIn,
      });
      footprintByPedalId.set(pedal.id, fp);
      livePos.set(pedal.id, { xIn, yIn });

      const outerEl = pedalEls.get(pedal.id);
      if (outerEl) {
        outerEl.style.left = `${xIn * scale}px`;
        outerEl.style.top = `${yIn * scale}px`;
      }

      const jacks = jackEls.get(pedal.id);
      if (jacks) {
        for (const [jackId, dot] of Object.entries(jacks) as [JackId, HTMLElement][]) {
          const pos = fp.jacks[jackId];
          if (!pos) continue;
          dot.style.left = `${pos.xIn * scale}px`;
          dot.style.top = `${pos.yIn * scale}px`;
        }
      }

      for (const entry of liveConnections) {
        if (entry.conn.from!.pedalId !== pedal.id && entry.conn.to!.pedalId !== pedal.id) continue;
        updateConnectionRoute(entry);
      }

      recomputeCollisions();
    }

    function renderConnectionHandle(conn: Connection, posIn: { xIn: number; yIn: number }) {
      const handle = el("div", {
        class: "connection-handle",
        style: `left:${posIn.xIn * scale}px;top:${posIn.yIn * scale}px;`,
        title: "Drag to reroute",
      });
      surface.appendChild(handle);

      let dragging = false;
      let rafPending = false;
      let liveBend = conn.bend ?? { dx: 0, dy: 0 };

      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        dragging = true;
      });
      handle.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const rect = surface.getBoundingClientRect();
        const xIn = (e.clientX - rect.left) / scale;
        const yIn = (e.clientY - rect.top) / scale;
        const fromFp = footprintByPedalId.get(conn.from!.pedalId);
        const toFp = footprintByPedalId.get(conn.to!.pedalId);
        const p1 = fromFp?.jacks[conn.from!.jack];
        const p2 = toFp?.jacks[conn.to!.jack];
        if (!p1 || !p2) return;
        const p1L = leadPoint(fromFp, conn.from!.jack, p1);
        const p2L = leadPoint(toFp, conn.to!.jack, p2);
        liveBend = {
          dx: xIn - (p1L.xIn + p2L.xIn) / 2,
          dy: yIn - (p1L.yIn + p2L.yIn) / 2,
        };
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(() => {
            rafPending = false;
            const entry = liveConnections.find((lc) => lc.conn.id === conn.id);
            if (entry) {
              entry.conn = { ...entry.conn, bend: liveBend };
              updateConnectionRoute(entry);
            }
          });
        }
      });
      function endDrag() {
        if (!dragging) return;
        dragging = false;
        store.setConnectionBend(conn.id, liveBend);
      }
      handle.addEventListener("pointerup", endDrag);
      handle.addEventListener("pointercancel", endDrag);

      return handle;
    }

    const initialCollisions = findCollisions(
      board.pedals.map((p) => ({ id: p.id, pos: livePos.get(p.id)!, fp: footprintByPedalId.get(p.id)! })),
      board.widthIn,
      board.heightIn
    );

    for (const pedal of board.pedals) {
      const outer = renderPedal(pedal, footprintByPedalId.get(pedal.id)!, initialCollisions.has(pedal.id), updateLivePosition);
      pedalEls.set(pedal.id, outer);
      surface.appendChild(outer);
    }

    const svg = svgEl("svg", {
      class: "connection-layer",
      width: board.widthIn * scale,
      height: board.heightIn * scale,
    });
    surface.appendChild(svg);

    for (const conn of board.connections) {
      const selected = store.selection?.type === "connection" && store.selection.id === conn.id;

      if (conn.mode === "snapped" && conn.from && conn.to) {
        const fromFp = footprintByPedalId.get(conn.from.pedalId);
        const toFp = footprintByPedalId.get(conn.to.pedalId);
        const p1 = fromFp?.jacks[conn.from.jack];
        const p2 = toFp?.jacks[conn.to.jack];
        if (!p1 || !p2) continue;
        const p1L = leadPoint(fromFp, conn.from.jack, p1);
        const p2L = leadPoint(toFp, conn.to.jack, p2);
        const style = cableStyle(conn.cableType);
        const line = svgEl("polyline", {
          class: `connection${selected ? " is-selected" : ""}`,
          points: pointsAttr([p1, ...elbowPath(p1L, p2L, conn.bend), p2], scale),
          fill: "none",
          stroke: style.color,
          "stroke-dasharray": style.dash,
        });
        line.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          store.select({ type: "connection", id: conn.id });
        });
        svg.appendChild(line);

        const handleEl = selected ? renderConnectionHandle(conn, elbowHandlePos(p1L, p2L, conn.bend)) : null;
        liveConnections.push({ conn, el: line, handleEl });
      } else if (conn.mode === "freeform" && conn.points) {
        const style = cableStyle(conn.cableType);
        const line = svgEl("polyline", {
          class: `connection${selected ? " is-selected" : ""}`,
          points: pointsAttr(conn.points, scale),
          fill: "none",
          stroke: style.color,
          "stroke-dasharray": style.dash,
        });
        line.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          store.select({ type: "connection", id: conn.id });
        });
        svg.appendChild(line);
      }
    }

    const pending = store.pending;
    let previewStart: { xIn: number; yIn: number } | null = null;
    if (pending?.mode === "snapped" && pending.from) {
      const fp = footprintByPedalId.get(pending.from.pedalId);
      previewStart = fp?.jacks[pending.from.jack] ?? null;
    } else if (pending?.mode === "freeform" && pending.points.length) {
      previewStart = pending.points[pending.points.length - 1];
    }

    if (previewStart) {
      const px = previewStart.xIn * scale;
      const py = previewStart.yIn * scale;
      const previewLine = svgEl("line", {
        class: "connection-preview",
        x1: px,
        y1: py,
        x2: px,
        y2: py,
        stroke: cableStyle(store.cableType).color,
      });
      svg.appendChild(previewLine);
      surface.addEventListener("pointermove", (e) => {
        const rect = surface.getBoundingClientRect();
        previewLine.setAttribute("x2", String(e.clientX - rect.left));
        previewLine.setAttribute("y2", String(e.clientY - rect.top));
      });
    }

    for (const pedal of board.pedals) {
      const fp = footprintByPedalId.get(pedal.id)!;
      const dots: Partial<Record<JackId, HTMLElement>> = {};
      for (const jackId of Object.keys(fp.jacks) as JackId[]) {
        const pos = fp.jacks[jackId]!;
        const dot = renderJack(pedal.id, jackId, pos);
        dots[jackId] = dot;
        surface.appendChild(dot);
      }
      jackEls.set(pedal.id, dots);
    }

    // ---- background: click to clear/draw, shift+drag to lasso-select ----
    let marqueeStart: { xIn: number; yIn: number } | null = null;
    let marqueeEl: HTMLElement | null = null;

    surface.addEventListener("pointerdown", (e) => {
      if (e.target !== surface) return;
      const rect = surface.getBoundingClientRect();
      const xIn = (e.clientX - rect.left) / scale;
      const yIn = (e.clientY - rect.top) / scale;

      if (e.shiftKey) {
        surface.setPointerCapture(e.pointerId);
        marqueeStart = { xIn, yIn };
        marqueeEl = el("div", { class: "marquee-rect" });
        surface.appendChild(marqueeEl);
        return;
      }

      const pend = store.pending;
      if (pend?.mode === "freeform") {
        store.completeFreeformAt(xIn, yIn);
      } else if (pend?.mode === "snapped") {
        store.cancelPending();
      } else if (store.drawMode === "freeform") {
        store.beginFreeformAt(xIn, yIn);
      } else {
        store.clearSelection();
      }
    });

    surface.addEventListener("pointermove", (e) => {
      if (!marqueeStart || !marqueeEl) return;
      const rect = surface.getBoundingClientRect();
      const xIn = (e.clientX - rect.left) / scale;
      const yIn = (e.clientY - rect.top) / scale;
      const x0 = Math.min(marqueeStart.xIn, xIn);
      const x1 = Math.max(marqueeStart.xIn, xIn);
      const y0 = Math.min(marqueeStart.yIn, yIn);
      const y1 = Math.max(marqueeStart.yIn, yIn);
      marqueeEl.style.left = `${x0 * scale}px`;
      marqueeEl.style.top = `${y0 * scale}px`;
      marqueeEl.style.width = `${(x1 - x0) * scale}px`;
      marqueeEl.style.height = `${(y1 - y0) * scale}px`;
    });

    function endMarquee(e: PointerEvent) {
      if (!marqueeStart) return;
      const rect = surface.getBoundingClientRect();
      const xIn = (e.clientX - rect.left) / scale;
      const yIn = (e.clientY - rect.top) / scale;
      const x0 = Math.min(marqueeStart.xIn, xIn);
      const x1 = Math.max(marqueeStart.xIn, xIn);
      const y0 = Math.min(marqueeStart.yIn, yIn);
      const y1 = Math.max(marqueeStart.yIn, yIn);
      marqueeEl?.remove();
      marqueeEl = null;
      marqueeStart = null;

      const hitIds = board.pedals
        .filter((p) => {
          const fp = footprintByPedalId.get(p.id)!;
          const pos = livePos.get(p.id)!;
          return pos.xIn < x1 && pos.xIn + fp.w > x0 && pos.yIn < y1 && pos.yIn + fp.h > y0;
        })
        .map((p) => p.id);

      if (hitIds.length) store.addToMultiSelect(hitIds);
    }
    surface.addEventListener("pointerup", endMarquee);
    surface.addEventListener("pointercancel", endMarquee);
  }

  function renderPedal(
    pedal: PlacedPedal,
    fp: Footprint,
    hasCollision: boolean,
    updateLivePosition: (pedal: PlacedPedal, xIn: number, yIn: number) => void
  ) {
    const lib = pedal.libraryId ? opts.library.get(pedal.libraryId) : null;
    const baseW = lib?.widthIn ?? pedal.custom!.widthIn;
    const baseH = lib?.heightIn ?? pedal.custom!.heightIn;
    const brand = lib?.brand ?? pedal.custom!.brand;
    const name = lib?.name ?? pedal.custom!.name;
    const imageUrl = lib ? pedalImageUrl(lib.image) : pedal.custom!.image;
    const selected =
      (store.selection?.type === "pedal" && store.selection.id === pedal.id) ||
      (store.selection?.type === "pedals" && store.selection.ids.includes(pedal.id));

    const inner = el(
      "div",
      {
        class: "pedal-face",
        style: `width:${baseW * scale}px;height:${baseH * scale}px;transform:rotate(${pedal.rotation}deg);`,
      },
      [
        imageUrl
          ? el("img", { src: imageUrl, alt: `${brand} ${name}`, draggable: false })
          : el("div", { class: "pedal-face-fallback" }, [name]),
      ]
    );

    const outer = el(
      "div",
      {
        class: `pedal${selected ? " is-selected" : ""}${hasCollision ? " has-collision" : ""}`,
        style: `left:${pedal.xIn * scale}px;top:${pedal.yIn * scale}px;width:${fp.w * scale}px;height:${fp.h * scale}px;`,
        title: `${brand} ${name} — ${baseW}" × ${baseH}"`,
      },
      [inner]
    );

    if (pedal.notes) {
      outer.appendChild(el("div", { class: "pedal-notes-dot", title: "Has notes" }));
    }

    let dragStart: { x: number; y: number; origXIn: number; origYIn: number } | null = null;
    let liveXIn = pedal.xIn;
    let liveYIn = pedal.yIn;
    let moved = false;
    let rafPending = false;

    outer.addEventListener("pointerdown", (e) => {
      e.stopPropagation();

      // If a connection is mid-draw, clicking a pedal's body (rather than
      // one of its jacks) completes/cancels the line instead of grabbing
      // the pedal — otherwise a freeform line could never be finished on
      // top of a pedal, only on empty board space or an exact jack.
      const pending = store.pending;
      if (pending) {
        const surfaceEl = outer.parentElement as HTMLElement;
        const rect = surfaceEl.getBoundingClientRect();
        const xIn = (e.clientX - rect.left) / scale;
        const yIn = (e.clientY - rect.top) / scale;
        if (pending.mode === "freeform") {
          store.completeFreeformAt(xIn, yIn);
        } else {
          store.cancelPending();
        }
        return;
      }

      // Shift-click toggles this pedal in/out of a multi-pedal selection
      // instead of starting a drag, so a group can be built up one click
      // at a time (or combined with a shift-drag lasso on empty space).
      if (e.shiftKey) {
        store.toggleMultiSelect(pedal.id);
        return;
      }

      outer.setPointerCapture(e.pointerId);
      dragStart = { x: e.clientX, y: e.clientY, origXIn: pedal.xIn, origYIn: pedal.yIn };
      liveXIn = pedal.xIn;
      liveYIn = pedal.yIn;
      moved = false;
    });

    outer.addEventListener("pointermove", (e) => {
      if (!dragStart) return;
      const dxIn = (e.clientX - dragStart.x) / scale;
      const dyIn = (e.clientY - dragStart.y) / scale;
      if (Math.abs(dxIn) + Math.abs(dyIn) > 0.02) moved = true;
      if (!moved) return;
      liveXIn = dragStart.origXIn + dxIn;
      liveYIn = dragStart.origYIn + dyIn;
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          // Direct DOM update only — no store call, so no re-render tears
          // down this element (and its pointer capture) mid-drag. The
          // store is updated once, on release, below.
          updateLivePosition(pedal, liveXIn, liveYIn);
        });
      }
    });

    function endDrag() {
      if (!dragStart) return;
      if (moved) {
        store.movePedal(pedal.id, liveXIn, liveYIn);
      } else {
        store.select({ type: "pedal", id: pedal.id });
      }
      dragStart = null;
    }

    outer.addEventListener("pointerup", endDrag);
    outer.addEventListener("pointercancel", endDrag);

    return outer;
  }

  function renderJack(pedalId: string, jack: JackId, posIn: { xIn: number; yIn: number }) {
    const role = JACK_ROLE[jack];
    const family = JACK_FAMILY[jack];
    const dot = el("div", {
      class: `jack jack-${role} jack-family-${family}`,
      style: `left:${posIn.xIn * scale}px;top:${posIn.yIn * scale}px;`,
      title: JACK_LABEL[jack],
    });
    dot.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const pending = store.pending;
      if (!pending) {
        if (store.drawMode === "snapped") {
          store.beginPendingFromJack(pedalId, jack);
        } else {
          store.beginFreeformAt(posIn.xIn, posIn.yIn, { pedalId, jack });
        }
      } else if (pending.mode === "snapped") {
        store.completeSnappedTo(pedalId, jack);
      } else {
        store.completeFreeformAt(posIn.xIn, posIn.yIn);
      }
    });
    return dot;
  }

  return { render };
}

function findCollisions(
  items: { id: string; pos: { xIn: number; yIn: number }; fp: Footprint }[],
  boardW: number,
  boardH: number
): Set<string> {
  const flagged = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const outOfBounds =
      a.pos.xIn < -0.01 ||
      a.pos.yIn < -0.01 ||
      a.pos.xIn + a.fp.w > boardW + 0.01 ||
      a.pos.yIn + a.fp.h > boardH + 0.01;
    if (outOfBounds) flagged.add(a.id);
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const overlap = !(
        a.pos.xIn + a.fp.w <= b.pos.xIn ||
        b.pos.xIn + b.fp.w <= a.pos.xIn ||
        a.pos.yIn + a.fp.h <= b.pos.yIn ||
        b.pos.yIn + b.fp.h <= a.pos.yIn
      );
      if (overlap) {
        flagged.add(a.id);
        flagged.add(b.id);
      }
    }
  }
  return flagged;
}
