import { makeId } from "./id";
import { JACK_OPTION_KEYS, pickJackOptions } from "./types";
import type { CustomPedalData, JackOptions } from "./types";

// Personal workflow settings and personal libraries, not project data: they
// don't get saved into project files, aren't shared if you send someone a
// file or a share link, and aren't part of undo history. Stored locally
// per-device.
const PREFS_KEY = "board-and-chain:prefs:v1";

/** A custom pedal kept in "My pedals" so it can be re-added to any project. */
export interface SavedPedal {
  id: string;
  data: CustomPedalData;
  jacks?: JackOptions;
}

export interface Prefs {
  snapGrid: boolean;
  snapNeighbor: boolean;
  // Jack toggles remembered per library pedal id, pre-applied to new copies.
  jackPresets: Record<string, JackOptions>;
  savedPedals: SavedPedal[];
}

function defaultPrefs(): Prefs {
  return { snapGrid: false, snapNeighbor: false, jackPresets: {}, savedPedals: [] };
}

let cache: Prefs | null = null;

export function getPrefs(): Prefs {
  if (cache) return cache;
  const result = defaultPrefs();
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.snapGrid === "boolean") result.snapGrid = parsed.snapGrid;
      if (typeof parsed.snapNeighbor === "boolean") result.snapNeighbor = parsed.snapNeighbor;
      if (parsed.jackPresets && typeof parsed.jackPresets === "object" && !Array.isArray(parsed.jackPresets)) {
        result.jackPresets = parsed.jackPresets;
      }
      if (Array.isArray(parsed.savedPedals)) result.savedPedals = parsed.savedPedals;
    }
  } catch {
    /* ignore corrupt/unavailable storage — fall back to defaults */
  }
  cache = result;
  return result;
}

export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...getPrefs(), ...patch };
  cache = next;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — the change just won't persist across reloads */
  }
}

// ---- remembered jack setup, per library pedal model ----

export function getJackPreset(libraryId: string): JackOptions | undefined {
  const preset = getPrefs().jackPresets[libraryId];
  return preset && JACK_OPTION_KEYS.some((k) => preset[k]) ? pickJackOptions(preset) : undefined;
}

/** Remembers a model's jack toggles; turning every toggle off forgets the entry. */
export function rememberJackPreset(libraryId: string, options: JackOptions) {
  const picked = pickJackOptions(options);
  const next = { ...getPrefs().jackPresets };
  if (JACK_OPTION_KEYS.some((k) => picked[k])) next[libraryId] = picked;
  else delete next[libraryId];
  setPrefs({ jackPresets: next });
}

// ---- "My pedals" ----

const savedPedalListeners = new Set<() => void>();

/** Called whenever "My pedals" changes (the library panel re-renders from this). */
export function onSavedPedalsChange(fn: () => void) {
  savedPedalListeners.add(fn);
}

function notifySavedPedals() {
  for (const fn of savedPedalListeners) fn();
}

export function getSavedPedals(): SavedPedal[] {
  return getPrefs().savedPedals;
}

function sameModel(a: CustomPedalData, b: CustomPedalData): boolean {
  return (
    a.brand.trim().toLowerCase() === b.brand.trim().toLowerCase() &&
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    a.widthIn === b.widthIn &&
    a.heightIn === b.heightIn
  );
}

/** Adds a custom pedal to "My pedals", or updates the entry if the same
 * brand/model/size is already saved (so saving twice never duplicates it). */
export function saveCustomPedal(data: CustomPedalData, jacks?: JackOptions): SavedPedal {
  const list = getSavedPedals();
  const copy: CustomPedalData = { ...data };
  const picked = jacks ? pickJackOptions(jacks) : undefined;
  const existing = list.find((s) => sameModel(s.data, copy));
  let saved: SavedPedal;
  if (existing) {
    saved = { ...existing, data: copy, jacks: picked };
    setPrefs({ savedPedals: list.map((s) => (s.id === existing.id ? saved : s)) });
  } else {
    saved = { id: makeId("saved"), data: copy, jacks: picked };
    setPrefs({ savedPedals: [...list, saved] });
  }
  notifySavedPedals();
  return saved;
}

export function removeSavedPedal(id: string) {
  setPrefs({ savedPedals: getSavedPedals().filter((s) => s.id !== id) });
  notifySavedPedals();
}
