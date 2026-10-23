import { el } from "./dom";

// public/data/changes.json is written by the weekly data-sync workflow, and
// only when PedalPlayground's lists actually changed. Show it once per update.
interface DataChanges {
  id: string;
  date: string; // YYYY-MM-DD
  pedalsAdded: number;
  pedalsRemoved: number;
  boardsAdded: number;
  boardsRemoved: number;
}

const SEEN_KEY = "board-and-chain:seen-data-update";
const FRESH_DAYS = 14; // a brand-new visitor only hears about recent updates

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function lastSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(id: string) {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* private mode etc. — worst case the notice shows again */
  }
}

export async function showDataUpdateNotice() {
  let changes: DataChanges;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/changes.json`, { cache: "no-cache" });
    if (!res.ok) return; // no file yet = no changes ever recorded
    changes = await res.json();
  } catch {
    return;
  }
  if (!changes || typeof changes.id !== "string" || changes.id === lastSeen()) return;

  const ageDays = (Date.now() - new Date(changes.date).getTime()) / 86_400_000;
  if (!(ageDays <= FRESH_DAYS)) return;

  const lines: string[] = [];
  if (changes.pedalsAdded > 0) lines.push(`${plural(changes.pedalsAdded, "pedal")} added`);
  if (changes.pedalsRemoved > 0) lines.push(`${plural(changes.pedalsRemoved, "pedal")} removed`);
  if (changes.boardsAdded > 0) lines.push(`${plural(changes.boardsAdded, "pedalboard")} added`);
  if (changes.boardsRemoved > 0) lines.push(`${plural(changes.boardsRemoved, "pedalboard")} removed`);
  if (!lines.length) return;

  const close = () => {
    markSeen(changes.id);
    overlay.remove();
  };
  const overlay = el("div", { class: "notice-overlay", role: "dialog", "aria-modal": "true" }, [
    el("div", { class: "notice-box" }, [
      el("h2", { class: "notice-title" }, ["Pedal library updated"]),
      el("ul", { class: "notice-list" }, lines.map((l) => el("li", {}, [l]))),
      el("button", { class: "primary-btn", onClick: close }, ["Got it"]),
    ]),
  ]);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
}
