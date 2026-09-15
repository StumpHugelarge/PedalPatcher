import type { JackId, Rotation } from "./types";

export interface Footprint {
  w: number; // effective bounding-box width, in inches, after rotation
  h: number;
  jacks: Partial<Record<JackId, { xIn: number; yIn: number }>>; // board-space, inches
}

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
 * height) while letting extra jacks (stereo, MIDI) reuse the same rotation
 * logic instead of a duplicated switch per jack.
 */
export function getFootprint(
  x: number,
  y: number,
  baseW: number,
  baseH: number,
  rotation: Rotation,
  opts: { stereoIO?: boolean; midi?: boolean } = {}
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

  if (opts.midi) {
    local.midiIn = { xIn: baseW / 3, yIn: 0 };
    local.midiOut = { xIn: (baseW * 2) / 3, yIn: 0 };
  }

  const jacks: Partial<Record<JackId, { xIn: number; yIn: number }>> = {};
  for (const [id, p] of Object.entries(local) as [JackId, { xIn: number; yIn: number }][]) {
    jacks[id] = rotateLocal(p, x, y, baseW, baseH, rotation);
  }

  const rotated = rotation === 90 || rotation === 270;
  return {
    w: rotated ? baseH : baseW,
    h: rotated ? baseW : baseH,
    jacks,
  };
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

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
