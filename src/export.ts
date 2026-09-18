import type { Board, LibraryPedal, PlacedPedal, Connection, JackId } from "./types";
import { pedalFootprint } from "./store";
import type { Footprint } from "./geometry";
import { pedalImageUrl } from "./pedalData";
import { pedalboardImageUrl } from "./pedalboardData";
import { leadPoint, elbowPath } from "./cableMath";
import { cableStyle } from "./ui/board";

const EXPORT_DPI = 150; // px per inch — independent of whatever on-screen zoom is active

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // pedal/case images serve permissive CORS headers
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Reads a CSS custom property's current resolved value (respects the
 * viewer's light/dark mode), for use as a literal canvas color — canvas
 * doesn't understand `var(...)` the way real CSS does. */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function parseDash(dash: string | undefined, scaleFactor: number): number[] {
  if (!dash) return [];
  return dash.split(/\s+/).map((n) => parseFloat(n) * scaleFactor);
}

async function drawPedal(
  ctx: CanvasRenderingContext2D,
  pedal: PlacedPedal,
  fp: Footprint,
  library: Map<string, LibraryPedal>
) {
  const lib = pedal.libraryId ? library.get(pedal.libraryId) : null;
  const baseW = lib?.widthIn ?? pedal.custom!.widthIn;
  const baseH = lib?.heightIn ?? pedal.custom!.heightIn;
  const brand = lib?.brand ?? pedal.custom!.brand;
  const name = lib?.name ?? pedal.custom!.name;
  const imageUrl = lib ? pedalImageUrl(lib.image) : pedal.custom!.image;

  const x = pedal.xIn * EXPORT_DPI;
  const y = pedal.yIn * EXPORT_DPI;
  const w = fp.w * EXPORT_DPI;
  const h = fp.h * EXPORT_DPI;
  const cx = x + w / 2;
  const cy = y + h / 2;

  let img: HTMLImageElement | null = null;
  if (imageUrl) {
    try {
      img = await loadImage(imageUrl);
    } catch {
      img = null; // fall through to the plain fallback block below
    }
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((pedal.rotation * Math.PI) / 180);
  if (img) {
    ctx.drawImage(img, (-baseW * EXPORT_DPI) / 2, (-baseH * EXPORT_DPI) / 2, baseW * EXPORT_DPI, baseH * EXPORT_DPI);
  } else {
    ctx.fillStyle = pedal.custom?.color || cssVar("--panel-sunken");
    ctx.fillRect((-baseW * EXPORT_DPI) / 2, (-baseH * EXPORT_DPI) / 2, baseW * EXPORT_DPI, baseH * EXPORT_DPI);
    ctx.fillStyle = cssVar("--ink");
    ctx.font = "12px Archivo, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${brand} ${name}`, 0, 0, baseW * EXPORT_DPI - 8);
  }
  ctx.restore();
}

function drawJacks(ctx: CanvasRenderingContext2D, fp: Footprint) {
  const inColor = cssVar("--accent-2") || "#345170";
  const outColor = cssVar("--accent") || "#b24e18";
  const midiColor = "#8b6fb3";
  const controlColor = cssVar("--good") || "#3f7d4c";
  const panel = cssVar("--panel") || "#f7f8f5";

  for (const [jack, pos] of Object.entries(fp.jacks) as [JackId, { xIn: number; yIn: number }][]) {
    const isOut = jack.startsWith("out") || jack === "midiOut" || jack === "send" || jack === "directOut";
    const isMidi = jack === "midiIn" || jack === "midiOut";
    const isControl = jack === "expIn";
    ctx.beginPath();
    ctx.arc(pos.xIn * EXPORT_DPI, pos.yIn * EXPORT_DPI, 4, 0, Math.PI * 2);
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isMidi ? midiColor : isControl ? controlColor : isOut ? outColor : inColor;
    ctx.stroke();
  }
}

function drawConnection(
  ctx: CanvasRenderingContext2D,
  conn: Connection,
  board: Board,
  library: Map<string, LibraryPedal>
) {
  let points: { xIn: number; yIn: number }[] | null = null;

  if (conn.mode === "freeform") {
    points = conn.points && conn.points.length >= 2 ? conn.points : null;
  } else if (conn.from && conn.to) {
    const fromPedal = board.pedals.find((p) => p.id === conn.from!.pedalId);
    const toPedal = board.pedals.find((p) => p.id === conn.to!.pedalId);
    if (fromPedal && toPedal) {
      const fromFp = pedalFootprint(fromPedal, library);
      const toFp = pedalFootprint(toPedal, library);
      const p1 = fromFp.jacks[conn.from.jack];
      const p2 = toFp.jacks[conn.to.jack];
      if (p1 && p2) {
        const p1L = leadPoint(fromFp, conn.from.jack, p1);
        const p2L = leadPoint(toFp, conn.to.jack, p2);
        points = [p1, ...elbowPath(p1L, p2L, conn.bend), p2];
      }
    }
  }
  if (!points) return;

  const style = cableStyle(conn.cableType);
  const scaleFactor = EXPORT_DPI / 40; // dash sizes in cableStyle are tuned for the app's default 40px/in view
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = p.xIn * EXPORT_DPI;
    const y = p.yIn * EXPORT_DPI;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.setLineDash(parseDash(style.dash, scaleFactor));
  ctx.lineWidth = 2;
  ctx.strokeStyle = style.color.startsWith("var(") ? cssVar(style.color.slice(4, -1)) : style.color;
  ctx.stroke();
  ctx.setLineDash([]);
}

export async function renderBoardToCanvas(
  board: Board,
  library: Map<string, LibraryPedal>
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(board.widthIn * EXPORT_DPI));
  canvas.height = Math.max(1, Math.round(board.heightIn * EXPORT_DPI));
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = board.color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (board.image) {
    try {
      const bg = await loadImage(pedalboardImageUrl(board.image));
      drawCover(ctx, bg, 0, 0, canvas.width, canvas.height);
    } catch {
      /* keep the plain color fill drawn above */
    }
  }

  for (const pedal of board.pedals) {
    await drawPedal(ctx, pedal, pedalFootprint(pedal, library), library);
  }
  for (const conn of board.connections) {
    drawConnection(ctx, conn, board, library);
  }
  for (const pedal of board.pedals) {
    drawJacks(ctx, pedalFootprint(pedal, library));
  }

  return canvas;
}

export async function downloadBoardPng(board: Board, library: Map<string, LibraryPedal>): Promise<void> {
  const canvas = await renderBoardToCanvas(board, library);
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create the image — try again.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${board.name || "pedalboard"}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
