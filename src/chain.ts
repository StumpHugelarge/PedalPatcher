import type { Board, JackId, LibraryPedal, PlacedPedal } from "./types";
import { JACK_FAMILY, JACK_LABEL, JACK_ROLE } from "./types";
import { pedalFootprint } from "./store";

// Traces the board's snap-to-jack connections into readable signal paths.
// Freeform cables have no jacks at either end, so there's nothing to follow
// and they're only counted, not traced.

export interface ChainPath {
  steps: string[]; // in signal order: pedal names, plus "Send from X" / "Return to X" markers
}

export interface ChainReport {
  paths: ChainPath[];
  isolated: string[]; // pedals with no snapped connection at all
  openJacks: { pedal: string; jacks: string[] }[]; // switched-on jacks nothing is plugged into
  inLoop: string[]; // pedals reachable only through a true feedback loop
  hasLoop: boolean;
  freeformIgnored: number;
  nonAudioIgnored: number; // MIDI / expression cables, which aren't part of the audio path
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

// Rules:
//  - A chain starts at a patched pedal whose main input has no cable and ends at
//    the pedal whose main output has no cable.
//  - Signal leaves a pedal by its Output. If the pedal's Send is patched, signal
//    detours out the Send, follows that cable chain, and re-enters the same pedal
//    at its Return, then carries on from the Output.
//  - Only audio cables are traced; MIDI / expression cables are just counted.
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
  // outgoing.get(pedalId).get(jack) = cables leaving that output-type jack
  const outgoing = new Map<string, Map<JackId, Edge[]>>();
  const connectedJacks = new Map<string, Set<JackId>>();
  const audioConnected = new Set<string>();
  const hasIncomingMain = new Set<string>(); // an audio cable lands on in1/in2
  let freeformIgnored = 0;
  let nonAudioIgnored = 0;

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

    markJack(conn.from.pedalId, conn.from.jack);
    markJack(conn.to.pedalId, conn.to.jack);

    if (JACK_FAMILY[conn.from.jack] !== "audio" || JACK_FAMILY[conn.to.jack] !== "audio") {
      nonAudioIgnored++;
      continue;
    }

    // Patching is unrestricted, so the cable may have been drawn input-first.
    const flip = JACK_ROLE[conn.from.jack] === "in" && JACK_ROLE[conn.to.jack] === "out";
    const src = flip ? conn.to : conn.from;
    const dst = flip ? conn.from : conn.to;

    if (!outgoing.has(src.pedalId)) outgoing.set(src.pedalId, new Map());
    const byJack = outgoing.get(src.pedalId)!;
    if (!byJack.has(src.jack)) byJack.set(src.jack, []);
    byJack.get(src.jack)!.push({ toPedalId: dst.pedalId, fromJack: src.jack, toJack: dst.jack });

    audioConnected.add(src.pedalId);
    audioConnected.add(dst.pedalId);
    if (dst.jack === "in1" || dst.jack === "in2") hasIncomingMain.add(dst.pedalId);
  }

  const isolated = board.pedals.filter((p) => !connectedJacks.has(p.id)).map((p) => labelOf.get(p.id)!);

  // Chains are listed right to left, the way signal runs on a board (inputs sit on a pedal's right).
  const byPosition = [...board.pedals].sort((a, b) => b.xIn - a.xIn || a.yIn - b.yIn);
  const starts = byPosition.filter((p) => audioConnected.has(p.id) && !hasIncomingMain.has(p.id));

  const paths: ChainPath[] = [];
  const visited = new Set<string>();
  let hasLoop = false;
  let truncated = false;

  const MAIN_OUTS: JackId[] = ["out1", "out2", "directOut"];

  // `via` is the jack the signal arrived on.
  function walk(
    pedalId: string,
    via: JackId,
    steps: string[],
    onPath: Set<string>,
    openSends: Set<string>
  ) {
    if (paths.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    const label = labelOf.get(pedalId)!;
    const returning = via === "return";

    if (returning) {
      // Only valid when we're inside this pedal's own send loop.
      if (!openSends.has(pedalId)) {
        hasLoop = true;
        return;
      }
    } else if (onPath.has(pedalId)) {
      hasLoop = true; // true feedback loop: don't go around again
      return;
    }

    visited.add(pedalId);
    const pushed: string[] = [returning ? `Return to ${label}` : label];
    if (!returning) onPath.add(pedalId);

    const jacks = outgoing.get(pedalId);
    let nextEdges: Edge[] = [];
    let enteringSend = false;

    if (!returning && jacks?.get("send")?.length) {
      enteringSend = true;
      nextEdges = jacks.get("send")!;
      pushed.push(`Send from ${label}`);
    } else {
      for (const jack of MAIN_OUTS) {
        const edges = jacks?.get(jack) ?? [];
        if (!edges.length) continue;
        nextEdges.push(...edges);
      }
    }

    steps.push(...pushed);
    const nextOpen = new Set(openSends);
    if (enteringSend) nextOpen.add(pedalId);
    if (returning) nextOpen.delete(pedalId);

    if (!nextEdges.length) {
      paths.push({ steps: [...steps] });
    } else {
      for (const edge of nextEdges) {
        const extra = edge.fromJack !== "out1" && edge.fromJack !== "send" ? `${JACK_LABEL[edge.fromJack]} from ${label}` : null;
        if (extra) steps.push(extra);
        walk(edge.toPedalId, edge.toJack, steps, onPath, nextOpen);
        if (extra) steps.pop();
      }
    }

    steps.length -= pushed.length;
    if (!returning) onPath.delete(pedalId);
  }

  for (const start of starts) walk(start.id, "in1", [], new Set(), new Set());

  // Patched pedals never reached from a start can only be inside a true loop.
  const inLoop = byPosition.filter((p) => audioConnected.has(p.id) && !visited.has(p.id)).map((p) => labelOf.get(p.id)!);
  if (inLoop.length) hasLoop = true;

  // Switched-on jacks nothing is plugged into. The chain's open ends are normal:
  // a main input with no cable is where the chain begins (your guitar), and a
  // main output with no cable is where it ends (your amp), so those aren't listed.
  const openJacks: { pedal: string; jacks: string[] }[] = [];
  for (const p of byPosition) {
    const plugged = connectedJacks.get(p.id);
    if (!plugged) continue; // already reported as not connected
    const open = (Object.keys(pedalFootprint(p, library).jacks) as JackId[]).filter((jack) => {
      if (plugged.has(jack)) return false;
      if (jack === "in1" || jack === "out1") return false;
      return true;
    });
    if (open.length) openJacks.push({ pedal: labelOf.get(p.id)!, jacks: open.map((j) => JACK_LABEL[j]) });
  }

  return { paths, isolated, openJacks, inLoop, hasLoop, freeformIgnored, nonAudioIgnored, truncated };
}
