import { el, clear } from "../dom";
import { loadPedalLibrary, searchPedals, pedalImageUrl, PEDAL_DATA_SOURCE } from "../pedalData";
import { beginDrag } from "../dragState";
import { store, nextDropPosition } from "../store";
import type { LibraryPedal } from "../types";

export async function createLibraryPanel(root: HTMLElement) {
  const library = await loadPedalLibrary();

  let query = "";
  let showCustomForm = false;

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

    panel.appendChild(renderCustomSection());
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
        store.addCustomPedal(
          { brand, name, widthIn, heightIn, image: imageInput.value.trim() || undefined },
          xIn,
          yIn
        );
        showCustomForm = false;
        render();
      });

      section.appendChild(
        el("div", { class: "custom-form" }, [brandInput, nameInput, widthInput, heightInput, imageInput, error, submit])
      );
    }

    return section;
  }

  render();
  return { refresh: render };
}
