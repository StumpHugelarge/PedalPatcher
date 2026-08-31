import type { LibraryPedal } from "./types";

// Raw shape of an entry in public/data/pedals.json, a one-time snapshot
// pulled from the PedalPlayground community dataset (see design spec §01
// and §02 for the reasoning + the credit that must ship in the app UI).
interface RawPedal {
  Brand: string;
  Name: string;
  Width: number;
  Height: number;
  Image: string;
}

export const PEDAL_DATA_SOURCE = {
  repoUrl: "https://github.com/PedalPlayground/pedalplayground",
  // Images are NOT copied into this app's bundle — only the factual
  // dimensions/names are snapshotted locally. Artwork is fetched live from
  // PedalPlayground's own repository at render time, both to avoid
  // shipping ~8.5k rehosted images and because the repo states no explicit
  // reuse license for the image assets themselves (only the app code is
  // ISC-licensed). If this app is ever distributed beyond personal use,
  // revisit this with the PedalPlayground maintainer first.
  imageBase:
    "https://raw.githubusercontent.com/PedalPlayground/pedalplayground/master/public/images/pedals/",
};

let cache: LibraryPedal[] | null = null;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function loadPedalLibrary(): Promise<LibraryPedal[]> {
  if (cache) return cache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/pedals.json`);
  if (!res.ok) throw new Error(`Failed to load pedal library (${res.status})`);
  const raw: RawPedal[] = await res.json();

  const seen = new Map<string, number>();
  cache = raw
    .filter((p) => p.Brand && p.Name && p.Width && p.Height)
    .map((p) => {
      const base = slugify(`${p.Brand}-${p.Name}`);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      return {
        id,
        brand: p.Brand,
        name: p.Name,
        widthIn: p.Width,
        heightIn: p.Height,
        image: p.Image,
      };
    });
  return cache;
}

export function pedalImageUrl(filename: string): string {
  return PEDAL_DATA_SOURCE.imageBase + encodeURIComponent(filename);
}

export function searchPedals(
  library: LibraryPedal[],
  query: string,
  limit = 60
): LibraryPedal[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const results: LibraryPedal[] = [];
  for (const p of library) {
    const hay = `${p.brand} ${p.name}`.toLowerCase();
    if (terms.every((t) => hay.includes(t))) {
      results.push(p);
      if (results.length >= limit) break;
    }
  }
  return results;
}
