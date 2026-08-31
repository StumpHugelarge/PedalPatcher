import type { Rotation } from "./types";

export interface Footprint {
  w: number; // effective bounding-box width, in inches, after rotation
  h: number;
  inputIn: { xIn: number; yIn: number }; // board-space, inches
  outputIn: { xIn: number; yIn: number };
}

/**
 * Given a pedal's unrotated footprint (baseW x baseH) placed with its
 * bounding-box top-left at (x, y) and rotated by one of the four right
 * angles, return the effective bounding box plus where the input/output
 * jacks land in board space.
 *
 * Only orthogonal rotations are supported (v0 scope), so this is a small
 * lookup rather than general trig.
 */
export function getFootprint(
  x: number,
  y: number,
  baseW: number,
  baseH: number,
  rotation: Rotation
): Footprint {
  switch (rotation) {
    case 0:
      return {
        w: baseW,
        h: baseH,
        inputIn: { xIn: x, yIn: y + baseH / 2 },
        outputIn: { xIn: x + baseW, yIn: y + baseH / 2 },
      };
    case 180:
      return {
        w: baseW,
        h: baseH,
        inputIn: { xIn: x + baseW, yIn: y + baseH / 2 },
        outputIn: { xIn: x, yIn: y + baseH / 2 },
      };
    case 90:
      return {
        w: baseH,
        h: baseW,
        inputIn: { xIn: x + baseH / 2, yIn: y },
        outputIn: { xIn: x + baseH / 2, yIn: y + baseW },
      };
    case 270:
      return {
        w: baseH,
        h: baseW,
        inputIn: { xIn: x + baseH / 2, yIn: y + baseW },
        outputIn: { xIn: x + baseH / 2, yIn: y },
      };
  }
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
