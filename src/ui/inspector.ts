import { el, clear } from "../dom";
import { store } from "../store";
import { nextRotation } from "../geometry";
import { cableStyle } from "./board";
import type { CableType, LibraryPedal } from "../types";

const CABLE_TYPES: CableType[] = ["instrument", "patch", "send-return", "midi", "power"];

export function createInspector(root: HTMLElement, library: Map<string, LibraryPedal>) {
  const panel = el("div", { class: "inspector-panel" });
  root.appendChild(panel);

  function render() {
    clear(panel);
    const sel = store.selection;
    const board = store.getActiveBoard();

    if (!sel) {
      panel.appendChild(renderBoardSettings());
      return;
    }

    if (sel.type === "pedal") {
      const pedal = board.pedals.find((p) => p.id === sel.id);
      if (!pedal) return;
      const lib = pedal.libraryId ? library.get(pedal.libraryId) : null;
      const isCustom = !lib;

      panel.appendChild(el("h2", { class: "panel-title" }, ["Pedal"]));
      panel.appendChild(
        el("div", { class: "inspector-field" }, [
          el("span", { class: "field-label" }, ["Name"]),
          el("strong", {}, [lib ? `${lib.brand} ${lib.name}` : `${pedal.custom!.brand} ${pedal.custom!.name}`]),
        ])
      );
      panel.appendChild(
        el("div", { class: "inspector-field" }, [
          el("span", { class: "field-label" }, ["Footprint"]),
          el("span", {}, [
            `${(lib?.widthIn ?? pedal.custom!.widthIn).toFixed(2)}" × ${(lib?.heightIn ?? pedal.custom!.heightIn).toFixed(2)}"`,
          ]),
        ])
      );
      panel.appendChild(
        el("div", { class: "inspector-field" }, [
          el("span", { class: "field-label" }, ["Position"]),
          el("span", { class: "mono-value" }, [`x ${pedal.xIn.toFixed(2)}", y ${pedal.yIn.toFixed(2)}"`]),
        ])
      );

      const rotateBtn = el("button", { class: "secondary-btn" }, [`Rotate 90° (currently ${pedal.rotation}°)`]);
      rotateBtn.addEventListener("click", () => store.rotatePedal(pedal.id, nextRotation(pedal.rotation)));
      panel.appendChild(rotateBtn);

      if (isCustom) {
        panel.appendChild(el("p", { class: "library-hint" }, ["Custom pedal — not part of the imported library."]));
      }

      const deleteBtn = el("button", { class: "danger-btn" }, ["Remove pedal"]);
      deleteBtn.addEventListener("click", () => store.removePedal(pedal.id));
      panel.appendChild(deleteBtn);
      return;
    }

    if (sel.type === "connection") {
      const conn = board.connections.find((c) => c.id === sel.id);
      if (!conn) return;
      panel.appendChild(el("h2", { class: "panel-title" }, ["Connection"]));
      panel.appendChild(
        el("div", { class: "inspector-field" }, [
          el("span", { class: "field-label" }, ["Mode"]),
          el("span", {}, [conn.mode === "snapped" ? "Snap-to-jack (follows pedals)" : "Freeform"]),
        ])
      );

      const select = el(
        "select",
        {
          class: "field",
          onchange: (e: Event) => {
            store.setConnectionCableType(conn.id, (e.target as HTMLSelectElement).value as CableType);
          },
        },
        CABLE_TYPES.map((t) => el("option", { value: t, selected: t === conn.cableType }, [cableStyle(t).label]))
      );
      panel.appendChild(el("label", { class: "field-label" }, ["Cable type"]));
      panel.appendChild(select);

      const deleteBtn = el("button", { class: "danger-btn" }, ["Remove connection"]);
      deleteBtn.addEventListener("click", () => store.removeConnection(conn.id));
      panel.appendChild(deleteBtn);
    }
  }

  function renderBoardSettings() {
    const board = store.getActiveBoard();
    const wrap = el("div", {}, []);
    wrap.appendChild(el("h2", { class: "panel-title" }, ["Board"]));

    const nameInput = el("input", { type: "text", class: "field", value: board.name }) as HTMLInputElement;
    nameInput.addEventListener("change", () => store.updateBoardMeta({ name: nameInput.value || "Untitled board" }));

    const widthInput = el("input", { type: "number", class: "field", step: "0.25", min: "1", value: String(board.widthIn) }) as HTMLInputElement;
    widthInput.addEventListener("change", () => {
      const v = parseFloat(widthInput.value);
      if (v > 0) store.updateBoardMeta({ widthIn: v });
    });

    const heightInput = el("input", { type: "number", class: "field", step: "0.25", min: "1", value: String(board.heightIn) }) as HTMLInputElement;
    heightInput.addEventListener("change", () => {
      const v = parseFloat(heightInput.value);
      if (v > 0) store.updateBoardMeta({ heightIn: v });
    });

    const colorInput = el("input", { type: "color", class: "field field-color", value: board.color }) as HTMLInputElement;
    colorInput.addEventListener("input", () => store.updateBoardMeta({ color: colorInput.value }));

    wrap.appendChild(el("label", { class: "field-label" }, ["Name"]));
    wrap.appendChild(nameInput);
    wrap.appendChild(el("label", { class: "field-label" }, ["Width (in)"]));
    wrap.appendChild(widthInput);
    wrap.appendChild(el("label", { class: "field-label" }, ["Height (in)"]));
    wrap.appendChild(heightInput);
    wrap.appendChild(el("label", { class: "field-label" }, ["Board color"]));
    wrap.appendChild(colorInput);
    wrap.appendChild(
      el("p", { class: "library-hint" }, [
        `${board.pedals.length} pedal${board.pedals.length === 1 ? "" : "s"} · ${board.connections.length} connection${board.connections.length === 1 ? "" : "s"}`,
      ])
    );
    return wrap;
  }

  render();
  return { render };
}
