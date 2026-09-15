import type { LibraryPedal } from "./types";

// Same shape and source as pedalData.ts, but for the physical board/case
// products themselves rather than individual pedals. See the design-spec
// note in pedalData.ts for why images are fetched live from PedalPlayground
// rather than rehosted — the same reasoning applies here.
interface RawPedalboard {
  Brand: string;
  Name: string;
  Width: number;
  Height: number;
  Image: string;
}

export const PEDALBOARD_DATA_SOURCE = {
  repoUrl: "https://github.com/PedalPlayground/pedalplayground",
  imageBase:
    "https://raw.githubusercontent.com/PedalPlayground/pedalplayground/master/public/images/pedalboards/",
};

let cache: LibraryPedal[] | null = null;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function loadPedalboardLibrary(): Promise<LibraryPedal[]> {
  if (cache) return cache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/pedalboards.json`);
  if (!res.ok) throw new Error(`Failed to load pedalboard library (${res.status})`);
  const raw: RawPedalboard[] = await res.json();

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

export function pedalboardImageUrl(filename: string): string {
  return PEDALBOARD_DATA_SOURCE.imageBase + encodeURIComponent(filename);
}

export function searchPedalboards(
  library: LibraryPedal[],
  query: string,
  limit = 20
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
