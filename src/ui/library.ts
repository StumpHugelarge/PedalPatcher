import { el, clear } from "../dom";
import { loadPedalLibrary, searchPedals, pedalImageUrl, PEDAL_DATA_SOURCE } from "../pedalData";
import { beginDrag } from "../dragState";
import { store, nextDropPosition } from "../store";
import type { LibraryPedal } from "../types";
import { getSavedPedals, onSavedPedalsChange, removeSavedPedal, saveCustomPedal } from "../prefs";
import type { SavedPedal } from "../prefs";

export async function createLibraryPanel(root: HTMLElement) {
  const library = await loadPedalLibrary();

  let query = "";
  let showCustomForm = false;
  onSavedPedalsChange(() => render());

  const panel = el("div", { class: "library-panel" });
  root.appendChild(panel);

  function render() {
    clear(panel);

    panel.appendChild(
      el("a", {
        class: "credit-btn",
        href: PEDAL_DATA_SOURCE.repoUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      }, [
        el("span", { class: "credit-source" }, ["Pedal data from"]),
        " PedalPlayground ",
        el("span", { class: "credit-arrow" }, ["↗"]),
      ])
    );

    panel.appendChild(el("h2", { class: "panel-title" }, ["Pedal library"]));

    const searchInput = el("input", {
      type: "search",
      placeholder: "Search brand or model…",
      value: query,
      class: "library-search",
      oninput: (e: Event) => {
        query = (e.target as HTMLInputElement).value;
        renderResults();
      },
    });
    panel.appendChild(searchInput);

    const results = el("div", { class: "library-results" });
    panel.appendChild(results);

    function renderResults() {
      clear(results);
      const trimmed = query.trim();
      if (!trimmed) {
        results.appendChild(
          el("p", { class: "library-hint" }, [
            `${library.length.toLocaleString()} pedals available — start typing to search.`,
          ])
        );
        return;
      }
      const matches = searchPedals(library, trimmed);
      if (!matches.length) {
        results.appendChild(el("p", { class: "library-hint" }, ["No matches — try a custom pedal below."]));
        return;
      }
      for (const pedal of matches) results.appendChild(renderLibraryCard(pedal));
    }
    renderResults();

    panel.appendChild(renderSavedPedals());
    panel.appendChild(renderCustomSection());
  }

  function renderSavedPedals() {
    const saved = getSavedPedals();
    const section = el("div", { class: "saved-section" });
    if (!saved.length) return section;

    section.appendChild(el("h2", { class: "panel-title" }, ["My pedals"]));
    for (const entry of saved) section.appendChild(renderSavedCard(entry));
    return section;
  }

  function renderSavedCard(entry: SavedPedal) {
    const { data } = entry;
    const addBtn = el("button", { class: "library-card-add", title: "Add to the active board" }, ["+"]);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const board = store.getActiveBoard();
      const { xIn, yIn } = nextDropPosition(board, data.widthIn, data.heightIn);
      store.addCustomPedal(data, xIn, yIn, entry.jacks);
    });
    const removeBtn = el("button", { class: "library-card-add library-card-remove", title: "Remove from My pedals" }, ["✕"]);
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeSavedPedal(entry.id);
    });

    const thumb = data.image
      ? el("img", { src: data.image, alt: `${data.brand} ${data.name}`, loading: "lazy", draggable: false })
      : el("div", { class: "saved-swatch", style: `background:${data.color || "#345170"};` });

    const card = el("div", { class: "library-card saved-card", title: "Drag onto the board, or use the + button" }, [
      thumb,
      el("div", { class: "library-card-info" }, [
        el("span", { class: "library-card-brand" }, [data.brand]),
        el("span", { class: "library-card-name" }, [data.name]),
        el("span", { class: "library-card-dims" }, [`${data.widthIn}" × ${data.heightIn}"`]),
      ]),
      el("div", { class: "saved-card-actions" }, [addBtn, removeBtn]),
    ]);

    card.addEventListener("pointerdown", (e) => {
      const target = e.target as HTMLElement;
      if (target === addBtn || target === removeBtn) return;
      beginDrag({ kind: "custom", data, jacks: entry.jacks }, `${data.brand} ${data.name}`, e.clientX, e.clientY);
    });

    return card;
  }

  function renderLibraryCard(pedal: LibraryPedal) {
    const addBtn = el("button", { class: "library-card-add", title: "Add to the active board" }, ["+"]);
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const board = store.getActiveBoard();
      const { xIn, yIn } = nextDropPosition(board, pedal.widthIn, pedal.heightIn);
      store.addPedalFromLibrary(pedal, xIn, yIn);
    });

    const card = el("div", { class: "library-card", title: "Drag onto the board, or use the + button" }, [
      el("img", {
        src: pedalImageUrl(pedal.image),
        alt: `${pedal.brand} ${pedal.name}`,
        loading: "lazy",
        draggable: false,
      }),
      el("div", { class: "library-card-info" }, [
        el("span", { class: "library-card-brand" }, [pedal.brand]),
        el("span", { class: "library-card-name" }, [pedal.name]),
        el("span", { class: "library-card-dims" }, [`${pedal.widthIn}" × ${pedal.heightIn}"`]),
      ]),
      addBtn,
    ]);

    card.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement) === addBtn) return;
      beginDrag({ kind: "library", pedal }, `${pedal.brand} ${pedal.name}`, e.clientX, e.clientY);
    });

    return card;
  }

  function renderCustomSection() {
    const section = el("div", { class: "custom-section" });
    const toggle = el("button", { class: "custom-toggle" }, [showCustomForm ? "− Custom pedal" : "+ Add a custom pedal"]);
    toggle.addEventListener("click", () => {
      showCustomForm = !showCustomForm;
      render();
    });
    section.appendChild(toggle);

    if (showCustomForm) {
      const brandInput = el("input", { type: "text", placeholder: "Brand", class: "field" }) as HTMLInputElement;
      const nameInput = el("input", { type: "text", placeholder: "Model", class: "field" }) as HTMLInputElement;
      const widthInput = el("input", { type: "number", placeholder: "Width (in)", step: "0.05", min: "0.1", class: "field" }) as HTMLInputElement;
      const heightInput = el("input", { type: "number", placeholder: "Height (in)", step: "0.05", min: "0.1", class: "field" }) as HTMLInputElement;
      const imageInput = el("input", { type: "url", placeholder: "Image URL (optional)", class: "field" }) as HTMLInputElement;
      const colorInput = el("input", { type: "color", class: "field field-color", value: "#345170" }) as HTMLInputElement;
      const saveCheck = el("input", { type: "checkbox", checked: true }) as HTMLInputElement;
      const error = el("p", { class: "field-error" }, []);

      const submit = el("button", { class: "primary-btn" }, ["Add to board"]);
      submit.addEventListener("click", () => {
        const brand = brandInput.value.trim();
        const name = nameInput.value.trim();
        const widthIn = parseFloat(widthInput.value);
        const heightIn = parseFloat(heightInput.value);
        if (!brand || !name || !(widthIn > 0) || !(heightIn > 0)) {
          error.textContent = "Brand, model, width, and height are required.";
          return;
        }
        const board = store.getActiveBoard();
        const { xIn, yIn } = nextDropPosition(board, widthIn, heightIn);
        const data = { brand, name, widthIn, heightIn, image: imageInput.value.trim() || undefined, color: colorInput.value };
        store.addCustomPedal(data, xIn, yIn);
        showCustomForm = false;
        if (saveCheck.checked) saveCustomPedal(data); // re-renders the panel via onSavedPedalsChange
        else render();
      });

      section.appendChild(
        el("div", { class: "custom-form" }, [
          brandInput,
          nameInput,
          widthInput,
          heightInput,
          imageInput,
          el("label", { class: "field-label" }, ["Color (used when there's no image)"]),
          colorInput,
          el("label", { class: "checkbox-field" }, [saveCheck, " Save to My pedals for future projects"]),
          error,
          submit,
        ])
      );
    }

    return section;
  }

  render();
  return { refresh: render };
}
