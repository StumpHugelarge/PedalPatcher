import { makeId } from "./id";
import { getFootprint, clamp } from "./geometry";
import { leadPoint, elbowPath, pathLengthIn } from "./cableMath";
import type {
  Board,
  CableType,
  Connection,
  ConnectionMode,
  CustomPedalData,
  JackId,
  LibraryPedal,
  PlacedPedal,
  Project,
  Rotation,
} from "./types";

export type Selection =
  | { type: "pedal"; id: string }
  | { type: "connection"; id: string }
  | { type: "pedals"; ids: string[] }
  | null;

export interface PendingConnection {
  mode: ConnectionMode;
  from: { pedalId: string; jack: JackId } | null; // null while drawing freeform from a blank point
  points: { xIn: number; yIn: number }[]; // freeform in-progress path, or anchor for snapped start
}

interface State {
  project: Project;
  selection: Selection;
  pending: PendingConnection | null;
  drawMode: ConnectionMode;
  cableType: CableType;
}

const AUTOSAVE_KEY = "board-and-chain:autosave:v1";

function defaultBoard(name: string): Board {
  return {
    id: makeId("board"),
    name,
    widthIn: 16,
    heightIn: 10,
    color: "#2b2b2b",
    pedals: [],
    connections: [],
  };
}

function defaultProject(): Project {
  const board = defaultBoard("Main board");
  return { version: 1, boards: [board], activeBoardId: board.id };
}

function loadAutosave(): Project | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.boards)) {
      return migrateProject(parsed as Project);
    }
  } catch {
    /* ignore corrupt autosave */
  }
  return null;
}

/** Projects saved before the multi-jack model used bare "input"/"output"
 * jack ids. Map those onto the new in1/out1 ids so older autosaves and
 * project files keep working instead of silently losing their routing. */
function migrateJackId(j: string): JackId {
  if (j === "input") return "in1";
  if (j === "output") return "out1";
  return j as JackId;
}

export function migrateProject(project: Project): Project {
  for (const board of project.boards) {
    for (const c of board.connections) {
      if (c.from) c.from.jack = migrateJackId(c.from.jack as unknown as string);
      if (c.to) c.to.jack = migrateJackId(c.to.jack as unknown as string);
    }
  }
  return project;
}

class Store {
  private state: State = {
    project: loadAutosave() ?? defaultProject(),
    selection: null,
    pending: null,
    drawMode: "snapped",
    cableType: "instrument",
  };

  private listeners = new Set<() => void>();
  private saveTimer: number | undefined;

  // ---- undo/redo ----
  // Snapshot-based rather than command-based: given how much of the store
  // already mutates `state.project` in place, recording "the whole project,
  // before this change" is far simpler and less error-prone than making
  // every mutation independently reversible. Every store method that
  // commits a project-data change (not selection/pending/UI-mode state)
  // calls snapshotForUndo() as its first line. Because drag gestures and
  // similar continuous interactions already only call their store method
  // once, on release — see movePedal/setConnectionBend call sites — this
  // naturally coalesces into one undo step per user action with no extra
  // debouncing needed here.
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly UNDO_CAP = 50;

  private snapshotForUndo() {
    this.undoStack.push(JSON.stringify(this.state.project));
    if (this.undoStack.length > this.UNDO_CAP) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.state.project));
    this.state.project = JSON.parse(prev);
    this.state.selection = null;
    this.state.pending = null;
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.state.project));
    this.state.project = JSON.parse(next);
    this.state.selection = null;
    this.state.pending = null;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
    this.scheduleAutosave();
  }

  private scheduleAutosave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.state.project));
      } catch {
        /* storage full or unavailable — not fatal, explicit save still works */
      }
    }, 400);
  }

  get project(): Project {
    return this.state.project;
  }

  get selection(): Selection {
    return this.state.selection;
  }

  get pending(): PendingConnection | null {
    return this.state.pending;
  }

  get drawMode(): ConnectionMode {
    return this.state.drawMode;
  }

  get cableType(): CableType {
    return this.state.cableType;
  }

  getActiveBoard(): Board {
    const b = this.state.project.boards.find(
      (b) => b.id === this.state.project.activeBoardId
    );
    return b ?? this.state.project.boards[0];
  }

  // ---- project-level ----

  replaceProject(project: Project) {
    this.state.project = migrateProject(project);
    this.state.selection = null;
    this.state.pending = null;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  resetToBlank() {
    this.replaceProject(defaultProject());
  }

  // ---- boards ----

  addBoard(name: string) {
    this.snapshotForUndo();
    const board = defaultBoard(name);
    this.state.project.boards.push(board);
    this.state.project.activeBoardId = board.id;
    this.state.selection = null;
    this.emit();
  }

  duplicateActiveBoard() {
    this.snapshotForUndo();
    const src = this.getActiveBoard();
    const copy: Board = JSON.parse(JSON.stringify(src));
    copy.id = makeId("board");
    copy.name = `${src.name} copy`;
    const idMap = new Map<string, string>();
    for (const p of copy.pedals) {
      const newId = makeId("pedal");
      idMap.set(p.id, newId);
      p.id = newId;
    }
    copy.connections = copy.connections.map((c) => ({
      ...c,
      id: makeId("conn"),
      from: c.from ? { ...c.from, pedalId: idMap.get(c.from.pedalId)! } : undefined,
      to: c.to ? { ...c.to, pedalId: idMap.get(c.to.pedalId)! } : undefined,
    }));
    this.state.project.boards.push(copy);
    this.state.project.activeBoardId = copy.id;
    this.emit();
  }

  /** Clones an externally-provided board (e.g. from a read-only share
   * link) into this project with fresh ids, mirroring duplicateActiveBoard's
   * remapping — the source board never gets mutated. */
  importBoard(board: Board) {
    this.snapshotForUndo();
    const copy: Board = JSON.parse(JSON.stringify(board));
    copy.id = makeId("board");
    const idMap = new Map<string, string>();
    for (const p of copy.pedals) {
      const newId = makeId("pedal");
      idMap.set(p.id, newId);
      p.id = newId;
    }
    copy.connections = copy.connections.map((c) => ({
      ...c,
      id: makeId("conn"),
      from: c.from ? { ...c.from, pedalId: idMap.get(c.from.pedalId)! } : undefined,
      to: c.to ? { ...c.to, pedalId: idMap.get(c.to.pedalId)! } : undefined,
    }));
    this.state.project.boards.push(copy);
    this.state.project.activeBoardId = copy.id;
    this.state.selection = null;
    this.emit();
  }

  removeBoard(id: string) {
    const boards = this.state.project.boards;
    if (boards.length <= 1) return; // always keep at least one board
    const idx = boards.findIndex((b) => b.id === id);
    if (idx === -1) return;
    this.snapshotForUndo();
    boards.splice(idx, 1);
    if (this.state.project.activeBoardId === id) {
      this.state.project.activeBoardId = boards[Math.max(0, idx - 1)].id;
    }
    this.state.selection = null;
    this.emit();
  }

  setActiveBoard(id: string) {
    this.state.project.activeBoardId = id;
    this.state.selection = null;
    this.state.pending = null;
    this.emit();
  }

  updateBoardMeta(patch: Partial<Pick<Board, "name" | "widthIn" | "heightIn" | "color" | "image">>) {
    this.snapshotForUndo();
    Object.assign(this.getActiveBoard(), patch);
    this.emit();
  }

  // ---- pedals ----

  addPedalFromLibrary(lib: LibraryPedal, xIn: number, yIn: number) {
    this.snapshotForUndo();
    const board = this.getActiveBoard();
    const pedal: PlacedPedal = {
      id: makeId("pedal"),
      libraryId: lib.id,
      xIn,
      yIn,
      rotation: 0,
    };
    board.pedals.push(pedal);
    this.state.selection = { type: "pedal", id: pedal.id };
    this.emit();
  }

  addCustomPedal(data: CustomPedalData, xIn: number, yIn: number) {
    this.snapshotForUndo();
    const board = this.getActiveBoard();
    const pedal: PlacedPedal = {
      id: makeId("pedal"),
      libraryId: null,
      custom: data,
      xIn,
      yIn,
      rotation: 0,
    };
    board.pedals.push(pedal);
    this.state.selection = { type: "pedal", id: pedal.id };
    this.emit();
  }

  movePedal(id: string, xIn: number, yIn: number) {
    const p = this.getActiveBoard().pedals.find((p) => p.id === id);
    if (!p) return;
    this.snapshotForUndo();
    p.xIn = xIn;
    p.yIn = yIn;
    this.emit();
  }

  rotatePedal(id: string, rotation: Rotation) {
    const p = this.getActiveBoard().pedals.find((p) => p.id === id);
    if (!p) return;
    this.snapshotForUndo();
    p.rotation = rotation;
    this.emit();
  }

  setPedalOptions(id: string, patch: Partial<Pick<PlacedPedal, "stereoIO" | "midi" | "sendReturn" | "directOut" | "expIn">>) {
    const p = this.getActiveBoard().pedals.find((p) => p.id === id);
    if (!p) return;
    this.snapshotForUndo();
    Object.assign(p, patch);
    this.emit();
  }

  setPedalNotes(id: string, notes: string) {
    const p = this.getActiveBoard().pedals.find((p) => p.id === id);
    if (!p) return;
    this.snapshotForUndo();
    p.notes = notes.trim() ? notes : undefined;
    this.emit();
  }

  removePedal(id: string) {
    const board = this.getActiveBoard();
    if (!board.pedals.some((p) => p.id === id)) return;
    this.snapshotForUndo();
    board.pedals = board.pedals.filter((p) => p.id !== id);
    board.connections = board.connections.filter(
      (c) => c.from?.pedalId !== id && c.to?.pedalId !== id
    );
    if (this.state.selection?.type === "pedal" && this.state.selection.id === id) {
      this.state.selection = null;
    }
    this.emit();
  }

  // ---- connections ----

  setDrawMode(mode: ConnectionMode) {
    this.state.drawMode = mode;
    this.state.pending = null;
    this.emit();
  }

  setCableType(type: CableType) {
    this.state.cableType = type;
    this.emit();
  }

  beginPendingFromJack(pedalId: string, jack: JackId) {
    this.state.pending = {
      mode: "snapped",
      from: { pedalId, jack },
      points: [],
    };
    this.emit();
  }

  beginFreeformAt(xIn: number, yIn: number, fromPedal?: { pedalId: string; jack: JackId }) {
    this.state.pending = {
      mode: "freeform",
      from: fromPedal ?? null,
      points: [{ xIn, yIn }],
    };
    this.emit();
  }

  extendFreeform(xIn: number, yIn: number) {
    if (!this.state.pending || this.state.pending.mode !== "freeform") return;
    this.state.pending.points.push({ xIn, yIn });
    this.emit();
  }

  cancelPending() {
    if (!this.state.pending) return;
    this.state.pending = null;
    this.emit();
  }

  completeSnappedTo(pedalId: string, jack: JackId) {
    const pending = this.state.pending;
    if (!pending || pending.mode !== "snapped" || !pending.from) return;
    if (pending.from.pedalId === pedalId) {
      this.cancelPending();
      return;
    }
    // Patching is intentionally unrestricted — plenty of real pedals have
    // non-standard jacks (expression inputs feeding a MIDI converter, send
    // used as a second output, etc.), so any jack can connect to any other.
    // The only remaining rule is: a jack can't connect to another jack on
    // the same pedal.
    this.snapshotForUndo();
    const conn: Connection = {
      id: makeId("conn"),
      mode: "snapped",
      cableType: this.state.cableType,
      from: pending.from,
      to: { pedalId, jack },
    };
    this.getActiveBoard().connections.push(conn);
    this.state.pending = null;
    this.state.selection = { type: "connection", id: conn.id };
    this.emit();
  }

  completeFreeformAt(xIn: number, yIn: number) {
    const pending = this.state.pending;
    if (!pending || pending.mode !== "freeform") return;
    const points = [...pending.points, { xIn, yIn }];
    if (points.length < 2) {
      this.cancelPending();
      return;
    }
    this.snapshotForUndo();
    const conn: Connection = {
      id: makeId("conn"),
      mode: "freeform",
      cableType: this.state.cableType,
      points,
    };
    this.getActiveBoard().connections.push(conn);
    this.state.pending = null;
    this.state.selection = { type: "connection", id: conn.id };
    this.emit();
  }

  removeConnection(id: string) {
    const board = this.getActiveBoard();
    if (!board.connections.some((c) => c.id === id)) return;
    this.snapshotForUndo();
    board.connections = board.connections.filter((c) => c.id !== id);
    if (this.state.selection?.type === "connection" && this.state.selection.id === id) {
      this.state.selection = null;
    }
    this.emit();
  }

  setConnectionCableType(id: string, cableType: CableType) {
    const c = this.getActiveBoard().connections.find((c) => c.id === id);
    if (!c) return;
    this.snapshotForUndo();
    c.cableType = cableType;
    this.emit();
  }

  setConnectionBend(id: string, bend: { dx: number; dy: number }) {
    const c = this.getActiveBoard().connections.find((c) => c.id === id);
    if (!c) return;
    this.snapshotForUndo();
    c.bend = bend;
    this.emit();
  }

  // ---- selection ----

  select(sel: Selection) {
    this.state.selection = sel;
    this.emit();
  }

  clearSelection() {
    if (!this.state.selection) return;
    this.state.selection = null;
    this.emit();
  }

  /** Shift-click a pedal: add/remove it from a multi-pedal selection,
   * collapsing back to a plain single-pedal selection when only one is left. */
  toggleMultiSelect(id: string) {
    const sel = this.state.selection;
    let ids: string[];
    if (sel?.type === "pedals") ids = sel.ids.slice();
    else if (sel?.type === "pedal") ids = [sel.id];
    else ids = [];
    const idx = ids.indexOf(id);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(id);
    this.setMultiSelectIds(ids);
  }

  /** Shift-drag lasso: union a batch of pedal ids into the current selection. */
  addToMultiSelect(ids: string[]) {
    const sel = this.state.selection;
    const base = sel?.type === "pedals" ? sel.ids : sel?.type === "pedal" ? [sel.id] : [];
    this.setMultiSelectIds(Array.from(new Set([...base, ...ids])));
  }

  private setMultiSelectIds(ids: string[]) {
    if (ids.length === 0) this.state.selection = null;
    else if (ids.length === 1) this.state.selection = { type: "pedal", id: ids[0] };
    else this.state.selection = { type: "pedals", ids };
    this.emit();
  }

  deleteSelection() {
    const sel = this.state.selection;
    if (!sel) return;
    if (sel.type === "pedal") {
      this.removePedal(sel.id);
    } else if (sel.type === "pedals") {
      const board = this.getActiveBoard();
      const idSet = new Set(sel.ids);
      this.snapshotForUndo();
      board.pedals = board.pedals.filter((p) => !idSet.has(p.id));
      board.connections = board.connections.filter(
        (c) => !(c.from && idSet.has(c.from.pedalId)) && !(c.to && idSet.has(c.to.pedalId))
      );
      this.state.selection = null;
      this.emit();
    } else {
      this.removeConnection(sel.id);
    }
  }

  // ---- copy / duplicate ----
  // Not part of Project/autosave — this is runtime-only clipboard state, so
  // it deliberately lives outside `state` (no autosave/undo implications).

  private clipboardData: { pedals: PlacedPedal[]; connections: Connection[] } | null = null;
  private pasteCount = 0;

  get clipboardCount(): number {
    return this.clipboardData?.pedals.length ?? 0;
  }

  copySelection() {
    const sel = this.state.selection;
    const ids = sel?.type === "pedal" ? [sel.id] : sel?.type === "pedals" ? sel.ids : null;
    if (!ids || !ids.length) return;
    const board = this.getActiveBoard();
    const idSet = new Set(ids);
    const pedals = board.pedals.filter((p) => idSet.has(p.id)).map((p) => structuredCloneLite(p));
    if (!pedals.length) return;
    // Only carry along connections that run entirely *within* the copied
    // set — a cable to a pedal outside the selection wouldn't have anywhere
    // valid to land once pasted elsewhere.
    const connections = board.connections
      .filter((c) => c.mode === "snapped" && c.from && c.to && idSet.has(c.from.pedalId) && idSet.has(c.to.pedalId))
      .map((c) => structuredCloneLite(c));
    this.clipboardData = { pedals, connections };
    this.pasteCount = 0;
  }

  /** Pastes the clipboard onto whichever board is currently active — so
   * "copy on board A, switch tabs, paste on board B" duplicates a set of
   * pedals across boards without a simultaneous multi-board view. */
  pasteClipboard() {
    if (!this.clipboardData || !this.clipboardData.pedals.length) return;
    this.snapshotForUndo();
    const board = this.getActiveBoard();
    this.pasteCount += 1;
    const offset = 0.6 * this.pasteCount; // inches; cascades further on repeated pastes

    const idMap = new Map<string, string>();
    const newPedals: PlacedPedal[] = this.clipboardData.pedals.map((p) => {
      const newId = makeId("pedal");
      idMap.set(p.id, newId);
      const clone = structuredCloneLite(p);
      clone.id = newId;
      clone.xIn = Math.max(0, p.xIn + offset);
      clone.yIn = Math.max(0, p.yIn + offset);
      return clone;
    });
    const newConnections: Connection[] = this.clipboardData.connections.map((c) => {
      const clone = structuredCloneLite(c);
      clone.id = makeId("conn");
      if (clone.from) clone.from.pedalId = idMap.get(clone.from.pedalId)!;
      if (clone.to) clone.to.pedalId = idMap.get(clone.to.pedalId)!;
      return clone;
    });

    board.pedals.push(...newPedals);
    board.connections.push(...newConnections);
    this.setMultiSelectIds(newPedals.map((p) => p.id));
  }
}

function structuredCloneLite<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export const store = new Store();

/** A simple cascading default spot for a newly added pedal, so repeated
 * clicks on "+" don't stack pedals exactly on top of one another. */
export function nextDropPosition(board: Board, w: number, h: number) {
  const count = board.pedals.length;
  const stepX = 2.4; // wider than a typical pedal footprint, to keep default drops from overlapping
  const stepY = 3.2;
  const cols = Math.max(1, Math.floor(board.widthIn / stepX));
  const col = count % cols;
  const row = Math.floor(count / cols);
  return {
    xIn: clamp(0.5 + col * stepX, 0, Math.max(0, board.widthIn - w)),
    yIn: clamp(0.5 + row * stepY, 0, Math.max(0, board.heightIn - h)),
  };
}

export function pedalFootprint(pedal: PlacedPedal, library: Map<string, LibraryPedal>) {
  const base =
    pedal.libraryId !== null
      ? library.get(pedal.libraryId)
      : { widthIn: pedal.custom!.widthIn, heightIn: pedal.custom!.heightIn };
  const w = base?.widthIn ?? 2.5;
  const h = base?.heightIn ?? 4.5;
  return getFootprint(pedal.xIn, pedal.yIn, w, h, pedal.rotation, {
    stereoIO: pedal.stereoIO,
    midi: pedal.midi,
    sendReturn: pedal.sendReturn,
    directOut: pedal.directOut,
    expIn: pedal.expIn,
  });
}

/** The actual routed length of a connection, in inches — the same path
 * board.ts draws (lead-stub + elbow bends for a snapped connection, or the
 * raw drawn points for a freeform one), summed as straight segments. */
export function connectionLengthIn(
  conn: Connection,
  board: Board,
  library: Map<string, LibraryPedal>
): number | null {
  if (conn.mode === "freeform") {
    const points = conn.points;
    return points && points.length >= 2 ? pathLengthIn(points) : null;
  }
  if (!conn.from || !conn.to) return null;
  const fromPedal = board.pedals.find((p) => p.id === conn.from!.pedalId);
  const toPedal = board.pedals.find((p) => p.id === conn.to!.pedalId);
  if (!fromPedal || !toPedal) return null;
  const fromFp = pedalFootprint(fromPedal, library);
  const toFp = pedalFootprint(toPedal, library);
  const p1 = fromFp.jacks[conn.from.jack];
  const p2 = toFp.jacks[conn.to.jack];
  if (!p1 || !p2) return null;
  const p1L = leadPoint(fromFp, conn.from.jack, p1);
  const p2L = leadPoint(toFp, conn.to.jack, p2);
  return pathLengthIn([p1, ...elbowPath(p1L, p2L, conn.bend), p2]);
}
