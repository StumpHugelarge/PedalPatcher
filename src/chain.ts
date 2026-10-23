import type { Board, JackId, LibraryPedal, PlacedPedal } from "./types";
import { JACK_LABEL, JACK_ROLE } from "./types";
import { pedalFootprint } from "./store";

// Traces the board's snap-to-jack connections into readable signal paths.
// Freeform cables have no jacks at either end, so there's nothing to follow
// and they're only counted, not traced.

export interface ChainPath {
  labels: string[]; // pedal names, in signal order
  links: string[]; // links[i] sits between labels[i] and labels[i + 1]; "" for a plain output -> input patch
}

export interface ChainReport {
  paths: ChainPath[];
  isolated: string[]; // pedals with no snapped connection at all
  openJacks: { pedal: string; jacks: string[] }[]; // switched-on jacks nothing is plugged into
  inLoop: string[]; // pedals that only appear in a feedback loop
  hasLoop: boolean;
  freeformIgnored: number;
  truncated: boolean; // path list was capped (very branchy boards)
}

const MAX_PATHS = 40;

function pedalLabel(pedal: PlacedPedal, library: Map<string, LibraryPedal>): string {
  const lib = pedal.libraryId ? library.get(pedal.libraryId) : null;
  if (lib) return `${lib.brand} ${lib.name}`;
  if (pedal.custom) return `${pedal.custom.brand} ${pedal.custom.name}`;
  return "Unknown pedal";
}

interface Edge {
  toPedalId: string;
  fromJack: JackId;
  toJack: JackId;
}

export function traceSignalChain(board: Board, library: Map<string, LibraryPedal>): ChainReport {
  // Labels, with " #2", " #3"... added when the same model is on the board more than once.
  const rawLabels = new Map(board.pedals.map((p) => [p.id, pedalLabel(p, library)]));
  const totals = new Map<string, number>();
  for (const label of rawLabels.values()) totals.set(label, (totals.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labelOf = new Map<string, string>();
  for (const p of board.pedals) {
    const base = rawLabels.get(p.id)!;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    labelOf.set(p.id, (totals.get(base) ?? 1) > 1 ? `${base} #${n}` : base);
  }

  const pedalIds = new Set(board.pedals.map((p) => p.id));
  const outgoing = new Map<string, Edge[]>();
  const incomingCount = new Map<string, number>();
  const connectedJacks = new Map<string, Set<JackId>>();
  let freeformIgnored = 0;

  const markJack = (pedalId: string, jack: JackId) => {
    if (!connectedJacks.has(pedalId)) connectedJacks.set(pedalId, new Set());
    connectedJacks.get(pedalId)!.add(jack);
  };

  for (const conn of board.connections) {
    if (conn.mode === "freeform" || !conn.from || !conn.to) {
      freeformIgnored++;
      continue;
    }
    if (!pedalIds.has(conn.from.pedalId) || !pedalIds.has(conn.to.pedalId)) continue;

    // Patching is unrestricted, so the cable may have been drawn input-first.
    // Signal flows out of an "out" jack into an "in" jack; if the roles tie
    // (out-to-out, in-to-in), fall back to the direction it was drawn in.
    const flip = JACK_ROLE[conn.from.jack] === "in" && JACK_ROLE[conn.to.jack] === "out";
    const src = flip ? conn.to : conn.from;
    const dst = flip ? conn.from : conn.to;

    if (!outgoing.has(src.pedalId)) outgoing.set(src.pedalId, []);
    outgoing.get(src.pedalId)!.push({ toPedalId: dst.pedalId, fromJack: src.jack, toJack: dst.jack });
    incomingCount.set(dst.pedalId, (incomingCount.get(dst.pedalId) ?? 0) + 1);
    markJack(src.pedalId, src.jack);
    markJack(dst.pedalId, dst.jack);
  }

  const hasConnection = (id: string) => connectedJacks.has(id);
  const isolated = board.pedals.filter((p) => !hasConnection(p.id)).map((p) => labelOf.get(p.id)!);

  // Chains read left to right, the way signal usually runs on a board.
  const byPosition = [...board.pedals].sort((a, b) => a.xIn - b.xIn || a.yIn - b.yIn);
  const starts = byPosition.filter((p) => hasConnection(p.id) && !(incomingCount.get(p.id) ?? 0));

  const paths: ChainPath[] = [];
  const visited = new Set<string>();
  let hasLoop = false;
  let truncated = false;

  const linkText = (e: Edge) =>
    e.fromJack === "out1" && e.toJack === "in1" ? "" : `${JACK_LABEL[e.fromJack]} → ${JACK_LABEL[e.toJack]}`;

  function walk(pedalId: string, labels: string[], links: string[], onPath: Set<string>) {
    if (paths.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    visited.add(pedalId);
    labels.push(labelOf.get(pedalId)!);
    onPath.add(pedalId);

    const edges = (outgoing.get(pedalId) ?? []).filter((e) => {
      if (onPath.has(e.toPedalId)) {
        hasLoop = true; // feedback loop: don't follow it around again
        return false;
      }
      return true;
    });

    if (!edges.length) {
      paths.push({ labels: [...labels], links: [...links] });
    } else {
      for (const edge of edges) {
        links.push(linkText(edge));
        walk(edge.toPedalId, labels, links, onPath);
        links.pop();
      }
    }

    onPath.delete(pedalId);
    labels.pop();
  }

  for (const start of starts) walk(start.id, [], [], new Set());

  // Pedals that are patched but never reached from a start can only be inside a loop.
  const inLoop = byPosition.filter((p) => hasConnection(p.id) && !visited.has(p.id)).map((p) => labelOf.get(p.id)!);
  if (inLoop.length) hasLoop = true;

  // Switched-on jacks nothing is plugged into. The open ends of a chain are
  // normal — the first pedal's main input (your guitar) and the last pedal's
  // main output (your amp) — so those aren't listed.
  const openJacks: { pedal: string; jacks: string[] }[] = [];
  for (const p of byPosition) {
    if (!hasConnection(p.id)) continue; // already reported as not connected
    const plugged = connectedJacks.get(p.id)!;
    const isStart = !(incomingCount.get(p.id) ?? 0);
    const isEnd = !(outgoing.get(p.id)?.length ?? 0);
    const open = (Object.keys(pedalFootprint(p, library).jacks) as JackId[]).filter((jack) => {
      if (plugged.has(jack)) return false;
      if (isStart && jack === "in1") return false;
      if (isEnd && jack === "out1") return false;
      return true;
    });
    if (open.length) openJacks.push({ pedal: labelOf.get(p.id)!, jacks: open.map((j) => JACK_LABEL[j]) });
  }

  return { paths, isolated, openJacks, inLoop, hasLoop, freeformIgnored, truncated };
}
