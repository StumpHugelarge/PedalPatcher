import { el, svgEl, clear } from "../dom";
import { store, pedalFootprint } from "../store";
import { clamp } from "../geometry";
import type { Footprint } from "../geometry";
import { pedalImageUrl } from "../pedalData";
import { pedalboardImageUrl } from "../pedalboardData";
import { onDrop } from "../dragState";
import type { LibraryPedal, PlacedPedal, Connection, CableType, JackKind } from "../types";

const MIN_SCALE = 14;
const MAX_SCALE = 72;

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

interface BoardViewOptions {
  library: Map<string, LibraryPedal>;
}

export function createBoardView(root: HTMLElement, opts: BoardViewOptions) {
  const scroll = el("div", { class: "board-scroll" });
  root.appendChild(scroll);

  let scale = 40;

  // While a pedal is actively being dragged, `render()` skips the normal
  // full rebuild and instead repositions just that pedal (see reposition()
  // below). A full rebuild mid-drag replaces the dragged element's DOM
  // node, which silently drops its pointer capture — the browser then has
  // nowhere reliable to deliver the eventual pointerup/pointercancel, so
  // the drag can appear "stuck" and never release. These maps hold
  // references from the last full render so reposition() can find them.
  let draggingPedalId: string | null = null;
  let pedalEls = new Map<string, HTMLElement>();
  let jackEls = new Map<string, HTMLElement>();
  let connectionLineEls = new Map<string, SVGPolylineElement>();

  new ResizeObserver(() => render()).observe(root);

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
    const availW = root.clientWidth - 48;
    const availH = root.clientHeight - 48;
    if (availW <= 0 || availH <= 0) return scale;
    return clamp(Math.min(availW / board.widthIn, availH / board.heightIn), MIN_SCALE, MAX_SCALE);
  }

  function render() {
    if (draggingPedalId) {
      reposition(draggingPedalId);
      return;
    }

    const board = store.getActiveBoard();
    scale = computeScale(board);
    clear(scroll);
    pedalEls = new Map();
    jackEls = new Map();
    connectionLineEls = new Map();

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

    const footprints = board.pedals.map((p) => ({ pedal: p, fp: pedalFootprint(p, opts.library) }));
    const collisions = findCollisions(footprints, board.widthIn, board.heightIn);

    for (const { pedal, fp } of footprints) {
      const outer = renderPedal(pedal, fp, collisions.has(pedal.id));
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
      const line = renderConnection(conn, board.pedals);
      if (line) {
        connectionLineEls.set(conn.id, line);
        svg.appendChild(line);
      }
    }

    const pending = store.pending;
    let previewStart: { xIn: number; yIn: number } | null = null;
    if (pending?.mode === "snapped" && pending.from) {
      const fromPedal = board.pedals.find((p) => p.id === pending.from!.pedalId);
      if (fromPedal) {
        const fp = pedalFootprint(fromPedal, opts.library);
        previewStart = pending.from.jack === "input" ? fp.inputIn : fp.outputIn;
      }
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

    for (const { pedal, fp } of footprints) {
      const inputDot = renderJack(pedal.id, "input", fp.inputIn);
      const outputDot = renderJack(pedal.id, "output", fp.outputIn);
      jackEls.set(`${pedal.id}:input`, inputDot);
      jackEls.set(`${pedal.id}:output`, outputDot);
      surface.appendChild(inputDot);
      surface.appendChild(outputDot);
    }

    surface.addEventListener("pointerdown", (e) => {
      if (e.target !== surface) return;
      const rect = surface.getBoundingClientRect();
      const xIn = (e.clientX - rect.left) / scale;
      const yIn = (e.clientY - rect.top) / scale;
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
  }

  // Lightweight mid-drag update: moves the already-existing DOM nodes for
  // one pedal (its body, its two jacks, and any snapped cables touching it)
  // without tearing down and recreating anything — see the note by
  // draggingPedalId above for why that matters.
  function reposition(pedalId: string) {
    const board = store.getActiveBoard();
    const pedal = board.pedals.find((p) => p.id === pedalId);
    if (!pedal) return;
    const fp = pedalFootprint(pedal, opts.library);

    const outer = pedalEls.get(pedalId);
    if (outer) {
      outer.style.left = `${pedal.xIn * scale}px`;
      outer.style.top = `${pedal.yIn * scale}px`;
    }

    const inputDot = jackEls.get(`${pedalId}:input`);
    if (inputDot) {
      inputDot.style.left = `${fp.inputIn.xIn * scale}px`;
      inputDot.style.top = `${fp.inputIn.yIn * scale}px`;
    }
    const outputDot = jackEls.get(`${pedalId}:output`);
    if (outputDot) {
      outputDot.style.left = `${fp.outputIn.xIn * scale}px`;
      outputDot.style.top = `${fp.outputIn.yIn * scale}px`;
    }

    for (const conn of board.connections) {
      if (conn.mode !== "snapped" || !conn.from || !conn.to) continue;
      if (conn.from.pedalId !== pedalId && conn.to.pedalId !== pedalId) continue;
      const line = connectionLineEls.get(conn.id);
      if (!line) continue;
      const fromPedal = board.pedals.find((p) => p.id === conn.from!.pedalId);
      const toPedal = board.pedals.find((p) => p.id === conn.to!.pedalId);
      if (!fromPedal || !toPedal) continue;
      const fromFp = pedalFootprint(fromPedal, opts.library);
      const toFp = pedalFootprint(toPedal, opts.library);
      const p1 = conn.from.jack === "input" ? fromFp.inputIn : fromFp.outputIn;
      const p2 = conn.to.jack === "input" ? toFp.inputIn : toFp.outputIn;
      line.setAttribute("points", `${p1.xIn * scale},${p1.yIn * scale} ${p2.xIn * scale},${p2.yIn * scale}`);
    }
  }

  function renderPedal(pedal: PlacedPedal, fp: Footprint, hasCollision: boolean) {
    const lib = pedal.libraryId ? opts.library.get(pedal.libraryId) : null;
    const baseW = lib?.widthIn ?? pedal.custom!.widthIn;
    const baseH = lib?.heightIn ?? pedal.custom!.heightIn;
    const brand = lib?.brand ?? pedal.custom!.brand;
    const name = lib?.name ?? pedal.custom!.name;
    const imageUrl = lib ? pedalImageUrl(lib.image) : pedal.custom!.image;
    const selected = store.selection?.type === "pedal" && store.selection.id === pedal.id;

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

    let dragStart: { x: number; y: number; origXIn: number; origYIn: number } | null = null;
    let moved = false;
    let rafPending = false;
    let latestMove: { xIn: number; yIn: number } | null = null;

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

      outer.setPointerCapture(e.pointerId);
      dragStart = { x: e.clientX, y: e.clientY, origXIn: pedal.xIn, origYIn: pedal.yIn };
      moved = false;
    });

    outer.addEventListener("pointermove", (e) => {
      if (!dragStart) return;
      const dxIn = (e.clientX - dragStart.x) / scale;
      const dyIn = (e.clientY - dragStart.y) / scale;
      if (Math.abs(dxIn) + Math.abs(dyIn) > 0.02) moved = true;
      if (!moved) return;
      draggingPedalId = pedal.id;
      latestMove = { xIn: dragStart.origXIn + dxIn, yIn: dragStart.origYIn + dyIn };
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          if (latestMove) store.movePedal(pedal.id, latestMove.xIn, latestMove.yIn);
        });
      }
    });

    function endDrag(wasComplete: boolean) {
      if (wasComplete && dragStart && !moved) {
        store.select({ type: "pedal", id: pedal.id });
      }
      dragStart = null;
      const wasDragging = draggingPedalId === pedal.id;
      draggingPedalId = null;
      // The drag is over, so it's now safe to let a full rebuild recreate
      // this node (recomputes collision highlighting, etc). Skipped when
      // nothing actually moved to avoid an unnecessary extra render.
      if (wasDragging) render();
    }

    outer.addEventListener("pointerup", () => endDrag(true));
    // Touch/pen gestures (and some trackpad interactions) can be cancelled
    // by the browser mid-gesture — without handling this, dragStart/
    // draggingPedalId would stay set forever, which reads as the pedal
    // refusing to let go.
    outer.addEventListener("pointercancel", () => endDrag(false));

    return outer;
  }

  function renderJack(pedalId: string, jack: JackKind, posIn: { xIn: number; yIn: number }) {
    const dot = el("div", {
      class: `jack jack-${jack}`,
      style: `left:${posIn.xIn * scale}px;top:${posIn.yIn * scale}px;`,
      title: jack,
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

  function renderConnection(conn: Connection, pedals: PlacedPedal[]) {
    const style = cableStyle(conn.cableType);
    const selected = store.selection?.type === "connection" && store.selection.id === conn.id;

    let points: { xIn: number; yIn: number }[];
    if (conn.mode === "snapped" && conn.from && conn.to) {
      const fromPedal = pedals.find((p) => p.id === conn.from!.pedalId);
      const toPedal = pedals.find((p) => p.id === conn.to!.pedalId);
      if (!fromPedal || !toPedal) return null;
      const fromFp = pedalFootprint(fromPedal, opts.library);
      const toFp = pedalFootprint(toPedal, opts.library);
      points = [
        conn.from.jack === "input" ? fromFp.inputIn : fromFp.outputIn,
        conn.to.jack === "input" ? toFp.inputIn : toFp.outputIn,
      ];
    } else if (conn.points) {
      points = conn.points;
    } else {
      return null;
    }

    const line = svgEl("polyline", {
      class: `connection${selected ? " is-selected" : ""}`,
      points: points.map((p) => `${p.xIn * scale},${p.yIn * scale}`).join(" "),
      fill: "none",
      stroke: style.color,
      "stroke-dasharray": style.dash,
    });
    line.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      store.select({ type: "connection", id: conn.id });
    });
    return line;
  }

  return { render };
}

function findCollisions(
  footprints: { pedal: PlacedPedal; fp: Footprint }[],
  boardW: number,
  boardH: number
): Set<string> {
  const flagged = new Set<string>();
  for (let i = 0; i < footprints.length; i++) {
    const a = footprints[i];
    const outOfBounds =
      a.pedal.xIn < -0.01 ||
      a.pedal.yIn < -0.01 ||
      a.pedal.xIn + a.fp.w > boardW + 0.01 ||
      a.pedal.yIn + a.fp.h > boardH + 0.01;
    if (outOfBounds) flagged.add(a.pedal.id);
    for (let j = i + 1; j < footprints.length; j++) {
      const b = footprints[j];
      const overlap = !(
        a.pedal.xIn + a.fp.w <= b.pedal.xIn ||
        b.pedal.xIn + b.fp.w <= a.pedal.xIn ||
        a.pedal.yIn + a.fp.h <= b.pedal.yIn ||
        b.pedal.yIn + b.fp.h <= a.pedal.yIn
      );
      if (overlap) {
        flagged.add(a.pedal.id);
        flagged.add(b.pedal.id);
      }
    }
  }
  return flagged;
}
