import type { Board } from "./types";

// The fragment after "#" is never sent to any server (GitHub Pages or
// otherwise) — it's purely client-side, so there's no backend involved in
// sharing a board this way and no real length limit to worry about beyond
// "does this look like a reasonable link to send someone".
const SHARE_PREFIX = "share=";
export const SHARE_LINK_WARN_LENGTH = 8000;

function toBase64Url(input: string): string {
  const base64 = btoa(unescape(encodeURIComponent(input)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(base64)));
}

export function encodeBoardForShare(board: Board): string {
  return toBase64Url(JSON.stringify(board));
}

export function buildShareUrl(board: Board): string {
  const encoded = encodeBoardForShare(board);
  return `${location.origin}${location.pathname}#${SHARE_PREFIX}${encoded}`;
}

/** Returns the shared board if the current URL is a share link, else null. */
export function readSharedBoardFromLocation(): Board | null {
  const hash = location.hash.slice(1); // drop leading "#"
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  try {
    const json = fromBase64Url(hash.slice(SHARE_PREFIX.length));
    const board = JSON.parse(json);
    if (board && typeof board === "object" && Array.isArray(board.pedals) && Array.isArray(board.connections)) {
      return board as Board;
    }
  } catch {
    /* malformed/corrupted share link */
  }
  return null;
}
