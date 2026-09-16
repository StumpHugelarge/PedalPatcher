import type { Project } from "./types";

// File System Access API isn't in the lib.dom.d.ts TS ships by default;
// declare just the pieces we use.
interface FSFileHandle {
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
  getFile(): Promise<File>;
}
declare global {
  interface Window {
    showSaveFilePicker?: (opts: unknown) => Promise<FSFileHandle>;
    showOpenFilePicker?: (opts: unknown) => Promise<FSFileHandle[]>;
  }
}

const PICKER_OPTS = {
  types: [
    {
      description: "Board & Chain project",
      accept: { "application/json": [".json"] },
    },
  ],
};

let activeHandle: FSFileHandle | null = null;
let activeFileName: string | null = null;

export function currentFileName(): string | null {
  return activeFileName;
}

const hasFSAccess =
  typeof window !== "undefined" && "showSaveFilePicker" in window;

export async function saveProject(project: Project, saveAs = false): Promise<string | null> {
  const json = JSON.stringify(project, null, 2);

  if (hasFSAccess) {
    try {
      if (saveAs || !activeHandle) {
        activeHandle = await window.showSaveFilePicker!({
          ...PICKER_OPTS,
          suggestedName: activeFileName ?? "pedalboard.json",
        });
      }
      const writable = await activeHandle!.createWritable();
      await writable.write(json);
      await writable.close();
      const file = await activeHandle!.getFile();
      activeFileName = file.name;
      return activeFileName;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return null; // user cancelled
      // fall through to download fallback on unexpected failure
    }
  }

  // Fallback: trigger a plain browser download.
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = activeFileName ?? "pedalboard.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return a.download;
}

export async function openProject(): Promise<Project | null> {
  if (hasFSAccess) {
    try {
      const [handle] = await window.showOpenFilePicker!(PICKER_OPTS);
      const file = await handle.getFile();
      const text = await file.text();
      activeHandle = handle;
      activeFileName = file.name;
      return JSON.parse(text) as Project;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return null;
      // fall through to input fallback
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      activeHandle = null;
      activeFileName = file.name;
      try {
        resolve(JSON.parse(text) as Project);
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
