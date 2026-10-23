// Pulls PedalPlayground's latest pedal + pedalboard lists, compares them with
// the copies in public/data, and — only if something changed — rewrites those
// files and writes public/data/changes.json (which the app reads to show its
// "pedals added" notice). Run by .github/workflows/update-pedal-data.yml.
//
// Run locally:  node scripts/sync-pedal-data.mjs
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/PedalPlayground/pedalplayground/master/public/data/";
const FILES = [
  { file: "pedals.json", label: "pedals" },
  { file: "pedalboards.json", label: "boards" },
];

const keyOf = (x) => `${x.Brand}\u0000${x.Name}`.toLowerCase();

async function fetchList(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`${file}: not a list`);
  return data;
}

const summary = { pedalsAdded: 0, pedalsRemoved: 0, boardsAdded: 0, boardsRemoved: 0 };
const writes = [];

for (const { file, label } of FILES) {
  const path = `public/data/${file}`;
  const current = JSON.parse(readFileSync(path, "utf8"));
  const latest = await fetchList(file);

  // Safety: never replace good data with something broken or suspiciously small.
  if (latest.length < current.length * 0.8 || !latest.every((x) => x && x.Brand && x.Name)) {
    throw new Error(`${file}: upstream looks wrong (${latest.length} entries vs ${current.length}); not updating`);
  }

  const have = new Set(current.map(keyOf));
  const want = new Set(latest.map(keyOf));
  const added = [...want].filter((k) => !have.has(k)).length;
  const removed = [...have].filter((k) => !want.has(k)).length;

  const text = JSON.stringify(latest, null, "\t") + "\n";
  const same = JSON.stringify(current) === JSON.stringify(latest);
  console.log(`${file}: ${current.length} -> ${latest.length} (+${added} / -${removed})${same ? " unchanged" : ""}`);
  if (same) continue;

  writes.push([path, text]);
  summary[label === "pedals" ? "pedalsAdded" : "boardsAdded"] = added;
  summary[label === "pedals" ? "pedalsRemoved" : "boardsRemoved"] = removed;
}

const changed = writes.length > 0;
if (changed) {
  for (const [path, text] of writes) writeFileSync(path, text);
  const now = new Date();
  writeFileSync(
    "public/data/changes.json",
    JSON.stringify({ id: now.toISOString(), date: now.toISOString().slice(0, 10), ...summary }, null, 2) + "\n"
  );
  console.log("Updated:", JSON.stringify(summary));
} else {
  console.log("No changes.");
}

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
