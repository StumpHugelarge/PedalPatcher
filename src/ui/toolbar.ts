import { el, clear } from "../dom";
import { store } from "../store";
import { cableStyle } from "./board";
import { saveProject, openProject, currentFileName } from "../fileIO";
import { getPrefs, setPrefs } from "../prefs";
import type { CableType, ConnectionMode } from "../types";

const CABLE_TYPES: CableType[] = ["instrument", "patch", "send-return", "midi", "power"];

export function createToolbar(root: HTMLElement) {
  const bar = el("div", { class: "toolbar" });
  root.appendChild(bar);

  function render() {
    clear(bar);
    const project = store.project;

    // ---- board tabs ----
    const tabs = el("div", { class: "board-tabs" });
    for (const board of project.boards) {
      const tab = el(
        "button",
        { class: `board-tab${board.id === project.activeBoardId ? " is-active" : ""}` },
        [board.name]
      );
      tab.addEventListener("click", () => store.setActiveBoard(board.id));
      tabs.appendChild(tab);
    }
    const addTab = el("button", { class: "board-tab board-tab-add", title: "New board" }, ["+"]);
    addTab.addEventListener("click", () => {
      const name = prompt("Name this board", `Board ${project.boards.length + 1}`);
      if (name) store.addBoard(name);
    });
    tabs.appendChild(addTab);
    bar.appendChild(tabs);

    // ---- draw mode + cable type ----
    const drawGroup = el("div", { class: "toolbar-group" });
    (["snapped", "freeform"] as ConnectionMode[]).forEach((mode) => {
      const btn = el(
        "button",
        { class: `mode-btn${store.drawMode === mode ? " is-active" : ""}` },
        [mode === "snapped" ? "Snap-to-jack" : "Freeform"]
      );
      btn.addEventListener("click", () => store.setDrawMode(mode));
      drawGroup.appendChild(btn);
    });
    bar.appendChild(drawGroup);

    // ---- position snapping (personal device setting, not project data) ----
    const snapGroup = el("div", { class: "toolbar-group toolbar-snap" });
    const prefs = getPrefs();
    const gridCheck = el("input", { type: "checkbox", checked: prefs.snapGrid }) as HTMLInputElement;
    gridCheck.addEventListener("change", () => setPrefs({ snapGrid: gridCheck.checked }));
    const neighborCheck = el("input", { type: "checkbox", checked: prefs.snapNeighbor }) as HTMLInputElement;
    neighborCheck.addEventListener("change", () => setPrefs({ snapNeighbor: neighborCheck.checked }));
    snapGroup.appendChild(el("label", { class: "checkbox-field", title: "Snap dragged pedals to a 0.5\" grid" }, [gridCheck, " Snap: grid"]));
    snapGroup.appendChild(
      el("label", { class: "checkbox-field", title: "Snap dragged pedals to line up with nearby pedals" }, [
        neighborCheck,
        " Snap: neighbors",
      ])
    );
    bar.appendChild(snapGroup);

    const cableSelect = el(
      "select",
      {
        class: "field cable-select",
        title: "Cable type for the next line you draw",
        onchange: (e: Event) => store.setCableType((e.target as HTMLSelectElement).value as CableType),
      },
      CABLE_TYPES.map((t) => el("option", { value: t, selected: t === store.cableType }, [cableStyle(t).label]))
    );
    bar.appendChild(cableSelect);

    // ---- file actions ----
    // ---- undo/redo ----
    const historyGroup = el("div", { class: "toolbar-group" });
    const undoBtn = el("button", { class: "icon-btn", title: "Undo (Ctrl/Cmd+Z)" }, ["↶"]) as HTMLButtonElement;
    undoBtn.disabled = !store.canUndo;
    undoBtn.addEventListener("click", () => store.undo());
    const redoBtn = el("button", { class: "icon-btn", title: "Redo (Ctrl/Cmd+Shift+Z)" }, ["↷"]) as HTMLButtonElement;
    redoBtn.disabled = !store.canRedo;
    redoBtn.addEventListener("click", () => store.redo());
    historyGroup.appendChild(undoBtn);
    historyGroup.appendChild(redoBtn);
    bar.appendChild(historyGroup);

    const fileGroup = el("div", { class: "toolbar-group toolbar-file" });
    const fileLabel = el("span", { class: "file-name" }, [currentFileName() ?? "unsaved project"]);

    const openBtn = el("button", { class: "secondary-btn" }, ["Open…"]);
    openBtn.addEventListener("click", async () => {
      const project = await openProject();
      if (project) store.replaceProject(project);
      render();
    });

    const saveBtn = el("button", { class: "secondary-btn" }, ["Save"]);
    saveBtn.addEventListener("click", async () => {
      await saveProject(store.project, false);
      render();
    });

    const saveAsBtn = el("button", { class: "secondary-btn" }, ["Save as…"]);
    saveAsBtn.addEventListener("click", async () => {
      await saveProject(store.project, true);
      render();
    });

    const newProjectBtn = el("button", { class: "secondary-btn" }, ["New project"]);
    newProjectBtn.addEventListener("click", () => {
      const hasContent = project.boards.some((b) => b.pedals.length > 0);
      if (hasContent && !confirm("Start a new project? Anything not saved will be lost.")) return;
      store.resetToBlank();
    });

    fileGroup.appendChild(fileLabel);
    fileGroup.appendChild(openBtn);
    fileGroup.appendChild(saveBtn);
    fileGroup.appendChild(saveAsBtn);
    fileGroup.appendChild(newProjectBtn);
    bar.appendChild(fileGroup);
  }

  render();
  return { render };
}
