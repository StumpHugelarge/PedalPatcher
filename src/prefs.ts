// Personal workflow settings, not project data: they don't get saved into
// project files, aren't shared if you send someone a file, and aren't part
// of undo history. Stored locally per-device.
const PREFS_KEY = "board-and-chain:prefs:v1";

export interface Prefs {
  snapGrid: boolean;
  snapNeighbor: boolean;
}

const DEFAULT_PREFS: Prefs = { snapGrid: false, snapNeighbor: false };

let cache: Prefs | null = null;

export function getPrefs(): Prefs {
  if (cache) return cache;
  let result: Prefs = DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) result = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
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
    /* storage full or unavailable — the toggle just won't persist across reloads */
  }
}
