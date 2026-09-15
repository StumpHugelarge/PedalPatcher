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
  // Per-instance jack options. Off by default so a plain mono pedal keeps
  // its original single input/output look; turning these on adds the
  // extra jacks below rather than trying to guess them from the (jack-less)
  // Pedal Playground dataset.
  stereoIO?: boolean; // adds a 2nd input + 2nd output
  midi?: boolean; // adds a MIDI in + MIDI out
}

// Every pedal always has in1/out1. stereoIO adds in2/out2; midi adds
// midiIn/midiOut. See geometry.ts for where these land on the pedal body.
export type JackId = "in1" | "in2" | "out1" | "out2" | "midiIn" | "midiOut";

export const JACK_ROLE: Record<JackId, "in" | "out"> = {
  in1: "in",
  in2: "in",
  out1: "out",
  out2: "out",
  midiIn: "in",
  midiOut: "out",
};

export const JACK_FAMILY: Record<JackId, "audio" | "midi"> = {
  in1: "audio",
  in2: "audio",
  out1: "audio",
  out2: "audio",
  midiIn: "midi",
  midiOut: "midi",
};

export const JACK_LABEL: Record<JackId, string> = {
  in1: "Input",
  in2: "Input 2 (stereo)",
  out1: "Output",
  out2: "Output 2 (stereo)",
  midiIn: "MIDI In",
  midiOut: "MIDI Out",
};

export type ConnectionMode = "snapped" | "freeform";

export type CableType =
  | "instrument"
  | "patch"
  | "send-return"
  | "midi"
  | "power";

export interface ConnectionEndpoint {
  pedalId: string;
  jack: JackId;
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
  // Snapped connections only: a two-bend ("Z") route is drawn from ->
  // corner -> corner -> to instead of one straight diagonal segment.
  // `bend` is a signed inch offset applied to the route's natural
  // (midpoint) corner position, adjustable via the connection's drag
  // handle in both directions. Undefined/{0,0} = untouched midpoint,
  // which renders as a plain straight line whenever both jacks are at
  // the same height (the common same-row case).
  bend?: { dx: number; dy: number };
}

export interface Board {
  id: string;
  name: string;
  widthIn: number;
  heightIn: number;
  color: string;
  image?: string | null; // filename of a chosen pedalboard-case product, resolved via pedalboardImageUrl()
  pedals: PlacedPedal[];
  connections: Connection[];
}

export interface Project {
  version: 1;
  boards: Board[];
  activeBoardId: string;
}
