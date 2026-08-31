import "./style.css";
import { el } from "./dom";
import { store } from "./store";
import { loadPedalLibrary } from "./pedalData";
import { createBoardView } from "./ui/board";
import { createLibraryPanel } from "./ui/library";
import { createInspector } from "./ui/inspector";
import { createToolbar } from "./ui/toolbar";

async function main() {
  const app = document.getElementById("app")!;

  const shell = el("div", { class: "app-shell" }, [
    el("header", { class: "app-header" }, [
      el("div", { class: "app-title" }, [
        el("span", { class: "app-title-mark" }, ["🎛️"]),
        el("span", {}, ["Board & Chain"]),
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

  const library = await loadPedalLibrary();
  const libraryMap = new Map(library.map((p) => [p.id, p]));

  const toolbar = createToolbar(toolbarRoot);
  const board = createBoardView(boardRoot, { library: libraryMap });
  const inspector = createInspector(inspectorRoot, libraryMap);
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

    if (e.key === "Escape") {
      if (store.pending) store.cancelPending();
      else store.clearSelection();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (store.selection) {
        e.preventDefault();
        store.deleteSelection();
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
