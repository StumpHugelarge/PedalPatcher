import type { CustomPedalData, LibraryPedal } from "./types";

export type DragPayload =
  | { kind: "library"; pedal: LibraryPedal }
  | { kind: "custom"; data: CustomPedalData };

interface DragSession {
  payload: DragPayload;
  ghost: HTMLElement;
}

let session: DragSession | null = null;
let dropHandler: ((payload: DragPayload, clientX: number, clientY: number) => void) | null = null;

export function onDrop(handler: (payload: DragPayload, clientX: number, clientY: number) => void) {
  dropHandler = handler;
}

export function beginDrag(payload: DragPayload, label: string, clientX: number, clientY: number) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  session = { payload, ghost };
  moveDrag(clientX, clientY);

  const onMove = (e: PointerEvent) => moveDrag(e.clientX, e.clientY);
  const onUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    finishDrag(e.clientX, e.clientY);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function moveDrag(clientX: number, clientY: number) {
  if (!session) return;
  session.ghost.style.transform = `translate(${clientX}px, ${clientY}px)`;
}

function finishDrag(clientX: number, clientY: number) {
  if (!session) return;
  const { payload, ghost } = session;
  ghost.remove();
  session = null;
  dropHandler?.(payload, clientX, clientY);
}

export function isDragging(): boolean {
  return session !== null;
}
