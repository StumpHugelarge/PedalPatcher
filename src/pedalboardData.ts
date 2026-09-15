// Same data source and one-time-snapshot approach as pedalData.ts, but for
// commercial pedalboard models (Pedaltrain, Temple Audio, Boss, etc.) —
// see the design spec §01/§02 for why this is a snapshot rather than a
// live sync, and the credit link that must ship alongside it.

export interface PedalboardPreset {
  id: string;
  brand: string;
  name: string;
  widthIn: number;
  heightIn: number;
  image: string; // filename only, resolved via pedalboardImageUrl()
}

export const PEDALBOARD_DATA_SOURCE = {
  repoUrl: "https://github.com/PedalPlayground/pedalplayground",
  imageBase:
    "https://raw.githubusercontent.com/PedalPlayground/pedalplayground/master/public/images/pedalboards/",
};

export function pedalboardImageUrl(filename: string): string {
  return PEDALBOARD_DATA_SOURCE.imageBase + encodeURIComponent(filename);
}

interface RawBoard {
  Brand: string;
  Name: string;
  Width: number;
  Height: number;
  Image: string;
}

let cache: PedalboardPreset[] | null = null;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function loadPedalboardPresets(): Promise<PedalboardPreset[]> {
  if (cache) return cache;
  const res = await fetch(`${import.meta.env.BASE_URL}data/pedalboards.json`);
  if (!res.ok) throw new Error(`Failed to load pedalboard presets (${res.status})`);
  const raw: RawBoard[] = await res.json();

  const seen = new Map<string, number>();
  cache = raw
    .filter((b) => b.Brand && b.Name && b.Width && b.Height)
    .map((b) => {
      const base = slugify(`${b.Brand}-${b.Name}`);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      return { id, brand: b.Brand, name: b.Name, widthIn: b.Width, heightIn: b.Height, image: b.Image };
    })
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
  return cache;
}
