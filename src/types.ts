// Core data model — mirrors the shape sketched in the design spec (§04),
// with a couple of v0 simplifications noted inline.

export interface LibraryPedal {
  id: string; // stable slug: "brand-name"
  brand: string;
  name: string;
  widthIn: number;
  heightIn: number;
  image: string; // filename only, resolved via pedalImageUrl()
}

export type Rotation = 0 | 90 | 180 | 270;

export interface CustomPedalData {
  brand: string;
  name: string;
  widthIn: number;
  heightIn: number;
  image?: string; // full URL, optional
}

export interface PlacedPedal {
  id: string;
  libraryId: string | null; // set when sourced from the imported library
  custom?: CustomPedalData; // set when libraryId is null
  xIn: number; // top-left of the *placed* (post-rotation) bounding box
  yIn: number;
  rotation: Rotation;
}

// v0 jack model: every pedal exposes exactly one input and one output,
// which covers a plain mono chain. Effects loops, stereo pairs, MIDI and
// power are expected to be drawn as freeform connections instead of
// snapped ones — see the design spec's §03 note on mixing both modes.
export type JackKind = "input" | "output";

export type ConnectionMode = "snapped" | "freeform";

export type CableType =
  | "instrument"
  | "patch"
  | "send-return"
  | "midi"
  | "power";

export interface ConnectionEndpoint {
  pedalId: string;
  jack: JackKind;
}

export interface FreePoint {
  xIn: number;
  yIn: number;
}

export interface Connection {
  id: string;
  mode: ConnectionMode;
  cableType: CableType;
  label?: string;
  // Snapped connections: both ends reference a pedal + jack, and are
  // re-derived from pedal position on every render.
  from?: ConnectionEndpoint;
  to?: ConnectionEndpoint;
  // Freeform connections: an explicit polyline in board-inch space.
  points?: FreePoint[];
}

export interface Board {
  id: string;
  name: string;
  widthIn: number;
  heightIn: number;
  color: string;
  pedals: PlacedPedal[];
  connections: Connection[];
}

export interface Project {
  version: 1;
  boards: Board[];
  activeBoardId: string;
}
