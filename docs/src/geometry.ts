import type { JackId, Rotation } from "./types";

export interface Footprint {
  w: number; // effective bounding-box width, in inches, after rotation
  h: number;
  jacks: Partial<Record<JackId, { xIn: number; yIn: number }>>; // board-space, inches
  // Unit outward-facing direction for each jack (board-space, post-rotation)
  // — which way a cable should lead out before bending, so it clears the
  // pedal's outline instead of running flush along it. See board.ts.
  jackDirs: Partial<Record<JackId, { dxIn: number; dyIn: number }>>;
}

export interface FootprintOptions {
  stereoIO?: boolean;
  midi?: boolean;
  sendReturn?: boolean;
  directOut?: boolean;
  expIn?: boolean;
}

// Fixed left-to-right order for whichever top-edge jacks are active on a
// given pedal, so they don't jump around as toggles are flipped.
const TOP_EDGE_JACKS: { id: JackId; optKey: keyof FootprintOptions; count: 1 | 2 }[] = [
  { id: "midiIn", optKey: "midi", count: 2 },
  { id: "send", optKey: "sendReturn", count: 2 },
  { id: "directOut", optKey: "directOut", count: 1 },
  { id: "expIn", optKey: "expIn", count: 1 },
];

/**
 * Given a pedal's unrotated footprint (baseW x baseH) placed with its
 * bounding-box top-left at (x, y) and rotated by one of the four right
 * angles, return the effective bounding box plus where each of the
 * pedal's active jacks land in board space.
 *
 * Jack layout is computed in the pedal's own unrotated (rotation-0) frame
 * first, then carried through rotation by a single shared mapping — this
 * keeps the in1/out1 result identical to the old hardcoded per-rotation
 * math (in1 on the left edge / mid-height, out1 on the right edge / mid-
 * height) while letting extra jacks reuse the same rotation logic instead
 * of a duplicated switch per jack.
 *
 * in1/in2/out1/out2 sit on the left/right edges (mirroring real stereo
 * in/out pairs). Every other extra — MIDI, send/return, direct out,
 * expression in — sits on the top edge, evenly spaced across however many
 * of them are active, matching where these usually sit on real pedals.
 */
export function getFootprint(
  x: number,
  y: number,
  baseW: number,
  baseH: number,
  rotation: Rotation,
  opts: FootprintOptions = {}
): Footprint {
  const local: Partial<Record<JackId, { xIn: number; yIn: number }>> = opts.stereoIO
    ? {
        in1: { xIn: 0, yIn: baseH / 3 },
        in2: { xIn: 0, yIn: (baseH * 2) / 3 },
        out1: { xIn: baseW, yIn: baseH / 3 },
        out2: { xIn: baseW, yIn: (baseH * 2) / 3 },
      }
    : {
        in1: { xIn: 0, yIn: baseH / 2 },
        out1: { xIn: baseW, yIn: baseH / 2 },
      };
  const localDirs: Partial<Record<JackId, { dxIn: number; dyIn: number }>> = {
    in1: { dxIn: -1, dyIn: 0 },
    in2: { dxIn: -1, dyIn: 0 },
    out1: { dxIn: 1, dyIn: 0 },
    out2: { dxIn: 1, dyIn: 0 },
  };

  const activeTopSlots = TOP_EDGE_JACKS.filter((slot) => opts[slot.optKey]).flatMap((slot) =>
    slot.count === 2 ? [slot.id, secondJackOf(slot.id)] : [slot.id]
  );
  const n = activeTopSlots.length;
  activeTopSlots.forEach((id, i) => {
    local[id] = { xIn: (baseW * (i + 1)) / (n + 1), yIn: 0 };
    localDirs[id] = { dxIn: 0, dyIn: -1 };
  });

  const jacks: Partial<Record<JackId, { xIn: number; yIn: number }>> = {};
  const jackDirs: Partial<Record<JackId, { dxIn: number; dyIn: number }>> = {};
  for (const [id, p] of Object.entries(local) as [JackId, { xIn: number; yIn: number }][]) {
    jacks[id] = rotateLocal(p, x, y, baseW, baseH, rotation);
    const dir = localDirs[id];
    if (dir) jackDirs[id] = rotateDirection(dir, rotation);
  }

  const rotated = rotation === 90 || rotation === 270;
  return {
    w: rotated ? baseH : baseW,
    h: rotated ? baseW : baseH,
    jacks,
    jackDirs,
  };
}

function secondJackOf(id: JackId): JackId {
  return id === "midiIn" ? "midiOut" : "return"; // send -> return
}

/** Maps a point in the pedal's unrotated local frame (0,0)-(baseW,baseH)
 * into board space, given the placed bounding box's top-left (x, y) and
 * one of the four orthogonal rotations. */
function rotateLocal(
  local: { xIn: number; yIn: number },
  x: number,
  y: number,
  baseW: number,
  baseH: number,
  rotation: Rotation
): { xIn: number; yIn: number } {
  switch (rotation) {
    case 0:
      return { xIn: x + local.xIn, yIn: y + local.yIn };
    case 180:
      return { xIn: x + (baseW - local.xIn), yIn: y + (baseH - local.yIn) };
    case 90:
      return { xIn: x + (baseH - local.yIn), yIn: y + local.xIn };
    case 270:
      return { xIn: x + local.yIn, yIn: y + (baseW - local.xIn) };
  }
}

/** Rotates a direction vector (no translation) the same way rotateLocal
 * carries a point, so a jack's outward-facing edge normal stays correct
 * after the pedal is rotated. */
function rotateDirection(
  dir: { dxIn: number; dyIn: number },
  rotation: Rotation
): { dxIn: number; dyIn: number } {
  switch (rotation) {
    case 0:
      return dir;
    case 180:
      return { dxIn: -dir.dxIn, dyIn: -dir.dyIn };
    case 90:
      return { dxIn: -dir.dyIn, dyIn: dir.dxIn };
    case 270:
      return { dxIn: dir.dyIn, dyIn: -dir.dxIn };
  }
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
