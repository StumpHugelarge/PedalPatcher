import { el, clear } from "../dom";
import { store } from "../store";
import { cableStyle } from "./board";
import { saveProject, openProject, currentFileName } from "../fileIO";
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

    fileGroup.appendChild(fileLabel);
    fileGroup.appendChild(openBtn);
    fileGroup.appendChild(saveBtn);
    fileGroup.appendChild(saveAsBtn);
    bar.appendChild(fileGroup);
  }

  render();
  return { render };
}
