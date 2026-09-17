import type { Footprint } from "./geometry";
import type { JackId } from "./types";

type Pt = { xIn: number; yIn: number };

// Snapped connections lead a short distance straight out from the pedal
// edge before bending, so the cable clears the pedal's outline (and its
// dashed collision/selection ring) instead of running flush along it.
export const CABLE_LEAD_IN = 0.18; // inches

export function leadPoint(fp: Footprint | undefined, jack: JackId, pos: Pt): Pt {
  const dir = fp?.jackDirs[jack];
  if (!dir) return pos;
  return { xIn: pos.xIn + dir.dxIn * CABLE_LEAD_IN, yIn: pos.yIn + dir.dyIn * CABLE_LEAD_IN };
}

/** Two-bend ("Z") route for a snapped connection: from -> corner -> corner
 * -> to, through a single drag handle that can move in both directions.
 * `bend` is a signed inch offset from the natural (midpoint) via-point —
 * {0,0}/undefined renders as a plain straight line whenever both jacks
 * share a height, since all points end up collinear. */
export function elbowPath(from: Pt, to: Pt, bend: { dx: number; dy: number } | undefined): Pt[] {
  const midX = (from.xIn + to.xIn) / 2 + (bend?.dx ?? 0);
  const midY = (from.yIn + to.yIn) / 2 + (bend?.dy ?? 0);
  return [from, { xIn: midX, yIn: from.yIn }, { xIn: midX, yIn: midY }, { xIn: to.xIn, yIn: midY }, to];
}

export function elbowHandlePos(from: Pt, to: Pt, bend: { dx: number; dy: number } | undefined): Pt {
  const midX = (from.xIn + to.xIn) / 2 + (bend?.dx ?? 0);
  const midY = (from.yIn + to.yIn) / 2 + (bend?.dy ?? 0);
  return { xIn: midX, yIn: midY };
}

/** Total length of a polyline, in inches — the same points used to draw a
 * connection, summed as straight segments. */
export function pathLengthIn(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].xIn - points[i - 1].xIn, points[i].yIn - points[i - 1].yIn);
  }
  return total;
}

// Common off-the-shelf guitar patch/instrument cable lengths, in inches.
// Anything longer than the largest size here is reported in a foot-based
// custom length instead of rounding up further.
export const STANDARD_CABLE_SIZES_IN = [3, 6, 8, 12, 18, 24, 36] as const;

// Real cables need a bit of give to actually plug in comfortably rather
// than being pulled taut corner-to-corner — added to a connection's raw
// routed length before rounding up to a standard size.
export const CABLE_SLACK_IN = 1;

export interface CableShoppingItem {
  sizeIn: number;
  label: string; // e.g. `6"` or `2 ft`
  count: number;
}

export function cableSizeLabel(sizeIn: number): string {
  return sizeIn >= 12 && sizeIn % 12 === 0 ? `${sizeIn / 12} ft` : `${sizeIn}"`;
}

/** Rounds a needed length up to the nearest standard cable size, or to the
 * nearest whole foot beyond the largest standard size. */
export function roundUpToStandardCable(neededIn: number): number {
  for (const size of STANDARD_CABLE_SIZES_IN) {
    if (neededIn <= size) return size;
  }
  return Math.ceil(neededIn / 12) * 12;
}

/** Turns a list of per-connection needed lengths (already including slack)
 * into a "buy N of size X" shopping list, sorted smallest to largest. */
export function buildShoppingList(neededLengthsIn: number[]): CableShoppingItem[] {
  const counts = new Map<number, number>();
  for (const needed of neededLengthsIn) {
    const size = roundUpToStandardCable(needed);
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([sizeIn, count]) => ({ sizeIn, label: cableSizeLabel(sizeIn), count }));
}
