import { makeId } from "./id";
import { getFootprint, clamp } from "./geometry";
import type {
  Board,
  CableType,
  Connection,
  ConnectionMode,
  CustomPedalData,
  JackKind,
  LibraryPedal,
  PlacedPedal,
  Project,
  Rotation,
} from "./types";

export type Selection =
  | { type: "pedal"; id: string }
  | { type: "connection"; id: string }
  | null;

export interface PendingConnection {
  mode: ConnectionMode;
  from: { pedalId: string; jack: JackKind } | null; // null while drawing freeform from a blank point
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
      return parsed as Project;
    }
  } catch {
    /* ignore corrupt autosave */
  }
  return null;
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
    this.state.project = project;
    this.state.selection = null;
    this.state.pending = null;
    this.emit();
  }

  resetToBlank() {
    this.replaceProject(defaultProject());
  }

  // ---- boards ----

  addBoard(name: string) {
    const board = defaultBoard(name);
    this.state.project.boards.push(board);
    this.state.project.activeBoardId = board.id;
    this.state.selection = null;
    this.emit();
  }

  duplicateActiveBoard() {
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

  removeBoard(id: string) {
    const boards = this.state.project.boards;
    if (boards.length <= 1) return; // always keep at least one board
    const idx = boards.findIndex((b) => b.id === id);
    if (idx === -1) return;
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

  updateBoardMeta(patch: Partial<Pick<Board, "name" | "widthIn" | "heightIn" | "color">>) {
    Object.assign(this.getActiveBoard(), patch);
    this.emit();
  }

  // ---- pedals ----

  addPedalFromLibrary(lib: LibraryPedal, xIn: number, yIn: number) {
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
    p.xIn = xIn;
    p.yIn = yIn;
    this.emit();
  }

  rotatePedal(id: string, rotation: Rotation) {
    const p = this.getActiveBoard().pedals.find((p) => p.id === id);
    if (!p) return;
    p.rotation = rotation;
    this.emit();
  }

  removePedal(id: string) {
    const board = this.getActiveBoard();
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

  beginPendingFromJack(pedalId: string, jack: JackKind) {
    this.state.pending = {
      mode: "snapped",
      from: { pedalId, jack },
      points: [],
    };
    this.emit();
  }

  beginFreeformAt(xIn: number, yIn: number, fromPedal?: { pedalId: string; jack: JackKind }) {
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

  completeSnappedTo(pedalId: string, jack: JackKind) {
    const pending = this.state.pending;
    if (!pending || pending.mode !== "snapped" || !pending.from) return;
    if (pending.from.pedalId === pedalId) {
      this.cancelPending();
      return;
    }
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
    board.connections = board.connections.filter((c) => c.id !== id);
    if (this.state.selection?.type === "connection" && this.state.selection.id === id) {
      this.state.selection = null;
    }
    this.emit();
  }

  setConnectionCableType(id: string, cableType: CableType) {
    const c = this.getActiveBoard().connections.find((c) => c.id === id);
    if (!c) return;
    c.cableType = cableType;
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

  deleteSelection() {
    const sel = this.state.selection;
    if (!sel) return;
    if (sel.type === "pedal") this.removePedal(sel.id);
    else this.removeConnection(sel.id);
  }
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
  return getFootprint(pedal.xIn, pedal.yIn, w, h, pedal.rotation);
}
