import { defineConfig } from "vite";

// Served at https://StumpHugelarge.github.io/PedalPatcher/ — a GitHub Pages
// *project* page, not a user/org root page, so every asset URL needs this
// subpath baked in at build time. If this ever moves to a root page (e.g.
// StumpHugelarge.github.io itself) or a custom domain, change this back to "/".
export default defineConfig({
  base: "/PedalPatcher/",
});
