import { el, clear } from "../dom";
import { store } from "../store";
import { connectionLengthIn } from "../store";
import { nextRotation } from "../geometry";
import { cableStyle } from "./board";
import type { CableType, LibraryPedal } from "../types";
import { pedalboardImageUrl } from "../pedalboardData";
import type { PedalboardPreset } from "../pedalboardData";
import { CABLE_SLACK_IN, cableSizeLabel, roundUpToStandardCable, buildShoppingList } from "../cableMath";

const CABLE_TYPES: CableType[] = ["instrument", "patch", "send-return", "midi", "power"];

export function createInspector(root: HTMLElement, library: Map<string, LibraryPedal>, presets: PedalboardPreset[]) {
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

      panel.appendChild(el("span", { class: "field-label" }, ["Jacks"]));
      const stereoCheck = el("input", { type: "checkbox", checked: !!pedal.stereoIO }) as HTMLInputElement;
      stereoCheck.addEventListener("change", () => store.setPedalOptions(pedal.id, { stereoIO: stereoCheck.checked }));
      const midiCheck = el("input", { type: "checkbox", checked: !!pedal.midi }) as HTMLInputElement;
      midiCheck.addEventListener("change", () => store.setPedalOptions(pedal.id, { midi: midiCheck.checked }));
      const sendReturnCheck = el("input", { type: "checkbox", checked: !!pedal.sendReturn }) as HTMLInputElement;
      sendReturnCheck.addEventListener("change", () =>
        store.setPedalOptions(pedal.id, { sendReturn: sendReturnCheck.checked })
      );
      const directOutCheck = el("input", { type: "checkbox", checked: !!pedal.directOut }) as HTMLInputElement;
      directOutCheck.addEventListener("change", () =>
        store.setPedalOptions(pedal.id, { directOut: directOutCheck.checked })
      );
      const expInCheck = el("input", { type: "checkbox", checked: !!pedal.expIn }) as HTMLInputElement;
      expInCheck.addEventListener("change", () => store.setPedalOptions(pedal.id, { expIn: expInCheck.checked }));
      panel.appendChild(
        el("label", { class: "checkbox-field" }, [stereoCheck, " Stereo I/O (adds a 2nd input + output)"])
      );
      panel.appendChild(el("label", { class: "checkbox-field" }, [midiCheck, " MIDI (adds MIDI in + out)"]));
      panel.appendChild(
        el("label", { class: "checkbox-field" }, [sendReturnCheck, " Send/return (effects loop)"])
      );
      panel.appendChild(el("label", { class: "checkbox-field" }, [directOutCheck, " Direct out"]));
      panel.appendChild(el("label", { class: "checkbox-field" }, [expInCheck, " Expression pedal in"]));

      panel.appendChild(el("label", { class: "field-label" }, ["Notes"]));
      const notesArea = el(
        "textarea",
        {
          class: "field notes-field",
          rows: "3",
          placeholder: "Settings, model, reminders…",
        },
        [pedal.notes ?? ""]
      ) as HTMLTextAreaElement;
      notesArea.addEventListener("change", () => store.setPedalNotes(pedal.id, notesArea.value));
      panel.appendChild(notesArea);

      if (isCustom) {
        panel.appendChild(el("p", { class: "library-hint" }, ["Custom pedal — not part of the imported library."]));
      }

      const copyBtn = el("button", { class: "secondary-btn" }, ["Copy (Ctrl/Cmd+C)"]);
      copyBtn.addEventListener("click", () => store.copySelection());
      panel.appendChild(copyBtn);

      const deleteBtn = el("button", { class: "danger-btn" }, ["Remove pedal"]);
      deleteBtn.addEventListener("click", () => store.removePedal(pedal.id));
      panel.appendChild(deleteBtn);
      return;
    }

    if (sel.type === "pedals") {
      panel.appendChild(el("h2", { class: "panel-title" }, [`${sel.ids.length} pedals selected`]));
      panel.appendChild(
        el("p", { class: "library-hint" }, [
          "Shift-click (or shift-drag) to adjust the selection. Delete/Backspace removes the whole set.",
        ])
      );

      const dupBtn = el("button", { class: "primary-btn" }, ["Duplicate here"]);
      dupBtn.addEventListener("click", () => {
        store.copySelection();
        store.pasteClipboard();
      });
      panel.appendChild(dupBtn);

      const copyBtn = el("button", { class: "secondary-btn" }, ["Copy (Ctrl/Cmd+C)"]);
      copyBtn.addEventListener("click", () => store.copySelection());
      panel.appendChild(copyBtn);
      panel.appendChild(
        el("p", { class: "library-hint" }, [
          "Copy, then switch to another board tab and press Ctrl/Cmd+V (or use the Paste button there) to duplicate this set onto that board.",
        ])
      );

      const deleteBtn = el("button", { class: "danger-btn" }, ["Remove pedals"]);
      deleteBtn.addEventListener("click", () => store.deleteSelection());
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

      const lengthIn = connectionLengthIn(conn, board, library);
      if (lengthIn !== null) {
        const needed = lengthIn + CABLE_SLACK_IN;
        panel.appendChild(
          el("div", { class: "inspector-field" }, [
            el("span", { class: "field-label" }, ["Cable length"]),
            el("span", { class: "mono-value" }, [
              `~${lengthIn.toFixed(1)}" routed → buy a ${cableSizeLabel(roundUpToStandardCable(needed))} cable`,
            ]),
          ])
        );
      }

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

    if (store.clipboardCount > 0) {
      const pasteBtn = el("button", { class: "secondary-btn" }, [
        `Paste ${store.clipboardCount} pedal${store.clipboardCount === 1 ? "" : "s"} here`,
      ]);
      pasteBtn.addEventListener("click", () => store.pasteClipboard());
      wrap.appendChild(pasteBtn);
    }

    if (presets.length) {
      const groups: HTMLOptGroupElement[] = [];
      let currentBrand = "";
      let currentGroup: HTMLOptGroupElement | null = null;
      for (const preset of presets) {
        if (preset.brand !== currentBrand) {
          currentBrand = preset.brand;
          currentGroup = el("optgroup", { label: preset.brand }) as HTMLOptGroupElement;
          groups.push(currentGroup);
        }
        currentGroup!.appendChild(
          el("option", { value: preset.id }, [`${preset.name} — ${preset.widthIn}" × ${preset.heightIn}"`])
        );
      }

      const presetSelect = el(
        "select",
        {
          class: "field",
          onchange: (e: Event) => {
            const select = e.target as HTMLSelectElement;
            const preset = presets.find((p) => p.id === select.value);
            if (preset) {
              store.updateBoardMeta({
                name: `${preset.brand} ${preset.name}`,
                widthIn: preset.widthIn,
                heightIn: preset.heightIn,
                image: preset.image,
              });
            }
          },
        },
        [el("option", { value: "", selected: true }, ["Apply a pedalboard preset…"]), ...groups]
      );
      wrap.appendChild(el("label", { class: "field-label" }, ["Pedalboard model"]));
      wrap.appendChild(presetSelect);

      if (board.image) {
        const clearImageBtn = el("button", { class: "secondary-btn" }, ["Remove board image"]);
        clearImageBtn.addEventListener("click", () => store.updateBoardMeta({ image: null }));
        wrap.appendChild(
          el("div", { class: "board-image-current" }, [
            el("img", { src: pedalboardImageUrl(board.image), alt: "" }),
            clearImageBtn,
          ])
        );
      }
    }

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

    const lengths = board.connections
      .map((c) => connectionLengthIn(c, board, library))
      .filter((n): n is number => n !== null);
    if (lengths.length) {
      const totalRawIn = lengths.reduce((a, b) => a + b, 0);
      const shoppingList = buildShoppingList(lengths.map((l) => l + CABLE_SLACK_IN));
      wrap.appendChild(el("label", { class: "field-label" }, ["Cable needed"]));
      wrap.appendChild(
        el("p", { class: "library-hint" }, [
          `~${totalRawIn.toFixed(0)}" routed total. Buy: ${shoppingList.map((s) => `${s.count}× ${s.label}`).join(", ")}.`,
        ])
      );
    }
    return wrap;
  }

  render();
  return { render };
}
