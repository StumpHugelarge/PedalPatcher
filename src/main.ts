import "./style.css";
import { el } from "./dom";
import { store } from "./store";
import { loadPedalLibrary } from "./pedalData";
import { loadPedalboardPresets } from "./pedalboardData";
import { createBoardView } from "./ui/board";
import { createLibraryPanel } from "./ui/library";
import { createInspector } from "./ui/inspector";
import { createToolbar } from "./ui/toolbar";
import { readSharedBoardFromLocation } from "./shareLink";
import { renderBoardToCanvas } from "./export";

// Bumped by hand for each meaningful release — shown next to the title so
// it's easy to tell at a glance which build is live.
const APP_VERSION = "v4.1";

/** A share link (#share=...) opens straight into a static, non-editable
 * view of just that one board — no toolbar/library/inspector, since
 * there's nothing to edit. "Duplicate to edit" imports it into the
 * viewer's own local project and reloads into the normal app. Rendered as
 * a plain image (via the same renderer PNG export uses) rather than the
 * live interactive board view, so it's genuinely static rather than just
 * visually locked. */
async function renderShareView(app: HTMLElement) {
  const board = readSharedBoardFromLocation()!;
  const [library] = await Promise.all([loadPedalLibrary()]);
  const libraryMap = new Map(library.map((p) => [p.id, p]));

  const duplicateBtn = el("button", { class: "primary-btn" }, ["Duplicate to edit"]);
  duplicateBtn.addEventListener("click", () => {
    store.importBoard(board);
    location.hash = "";
    location.reload();
  });

  const canvasWrap = el("div", { class: "share-canvas-wrap" }, ["Rendering…"]);
  const shell = el("div", { class: "share-shell" }, [
    el("div", { class: "share-banner" }, [
      el("span", {}, [`Viewing "${board.name}" — shared as read-only.`]),
      duplicateBtn,
    ]),
    canvasWrap,
  ]);
  app.appendChild(shell);

  try {
    const canvas = await renderBoardToCanvas(board, libraryMap);
    canvasWrap.replaceChildren(el("img", { src: canvas.toDataURL("image/png"), alt: board.name }));
  } catch {
    canvasWrap.replaceChildren("Couldn't render this board's images — the layout data is still valid to duplicate.");
  }
}

async function main() {
  const app = document.getElementById("app")!;

  if (readSharedBoardFromLocation()) {
    await renderShareView(app);
    return;
  }

  const shell = el("div", { class: "app-shell" }, [
    el("header", { class: "app-header" }, [
      el("div", { class: "app-title" }, [
        el("span", { class: "app-title-mark" }, ["🎛️"]),
        el("span", {}, ["Board & Chain"]),
        el("span", { class: "app-version" }, [APP_VERSION]),
      ]),
    ]),
    el("div", { class: "toolbar-row" }),
    el("div", { class: "app-body" }, [
      el("aside", { class: "library-column" }),
      el("main", { class: "board-column" }),
      el("aside", { class: "inspector-column" }),
    ]),
  ]);
  app.appendChild(shell);

  const toolbarRoot = shell.querySelector(".toolbar-row") as HTMLElement;
  const libraryRoot = shell.querySelector(".library-column") as HTMLElement;
  const boardRoot = shell.querySelector(".board-column") as HTMLElement;
  const inspectorRoot = shell.querySelector(".inspector-column") as HTMLElement;

  const [library, presets] = await Promise.all([loadPedalLibrary(), loadPedalboardPresets()]);
  const libraryMap = new Map(library.map((p) => [p.id, p]));

  const toolbar = createToolbar(toolbarRoot, libraryMap);
  const board = createBoardView(boardRoot, { library: libraryMap });
  const inspector = createInspector(inspectorRoot, libraryMap, presets);
  await createLibraryPanel(libraryRoot);

  function renderAll() {
    toolbar.render();
    board.render();
    inspector.render();
  }
  renderAll();

  store.subscribe(renderAll);

  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    const inField = target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA";
    if (inField) return;

    const mod = e.ctrlKey || e.metaKey;

    if (e.key === "Escape") {
      if (store.pending) store.cancelPending();
      else store.clearSelection();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (store.selection) {
        e.preventDefault();
        store.deleteSelection();
      }
    } else if (mod && e.key.toLowerCase() === "c") {
      if (store.selection) {
        e.preventDefault();
        store.copySelection();
      }
    } else if (mod && e.key.toLowerCase() === "v") {
      if (store.clipboardCount > 0) {
        e.preventDefault();
        store.pasteClipboard();
      }
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
      if (store.canUndo) {
        e.preventDefault();
        store.undo();
      }
    } else if ((mod && e.shiftKey && e.key.toLowerCase() === "z") || (mod && e.key.toLowerCase() === "y")) {
      if (store.canRedo) {
        e.preventDefault();
        store.redo();
      }
    }
  });

  window.addEventListener("beforeunload", (e) => {
    // Autosave already covers crash recovery, but an accidental tab close
    // without an explicit Save should still get a native confirmation.
    if (store.getActiveBoard().pedals.length > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

main();
