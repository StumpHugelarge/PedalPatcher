// Committed end-to-end regression check, run against a production build
// (so it exercises the real `base: "/PedalPatcher/"` path like GitHub Pages
// does) with a headless Chromium via Playwright.
//
// Run it with `npm run test:e2e` after `npm run build` — or let
// .github/workflows/test.yml run both on every push/PR. The browser binary
// isn't downloaded by `npm install`; run `npx playwright install chromium`
// once first (CI does this itself).
//
// This isn't a unit-test suite — it's a short list of "does the app still
// actually work" checks for the handful of interactions that have broken
// silently before (free-drag distance, multi-select/duplicate, undo/redo,
// snap-to-jack routing, the snap-to-neighbor alignment guide). Add a new
// check here whenever a bug like that gets fixed, so it can't come back
// unnoticed.
//
// Pedals are explicitly dragged to known, well-separated coordinates right
// after being added, rather than relying on wherever the auto-placement
// (nextDropPosition) happens to put them — real pedal footprints are
// sometimes wider than that grid step, so two auto-placed pedals can
// visually overlap, and a real click goes to whichever one is on top, not
// necessarily the one a CSS-order index means to target.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";

const PORT = 4300;
const BASE = `http://localhost:${PORT}/PedalPatcher/`;

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > timeoutMs) reject(new Error(`Server didn't come up at ${url}`));
          else setTimeout(attempt, 250);
        });
    }
    attempt();
  });
}

async function dragPedalTo(page, pedalLocator, targetX, targetY) {
  const box = await pedalLocator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
}

/** Picks a point on the connection's rendered route, without assuming
 * anything about the two pedals' relative position (the route is a plain
 * straight line only when both jacks share a height — otherwise it has
 * right-angle bends, so "the midpoint between the two jacks" can be empty
 * space). Reads the live SVG polyline and clicks the middle of its single
 * longest segment, which is never a near-zero-length lead-in stub. */
async function clickConnectionLine(page) {
  const surfaceBox = await page.locator(".board-surface").boundingBox();
  const points = await page.locator(".connection-layer .connection").first().evaluate((el) =>
    el
      .getAttribute("points")
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number))
  );
  let best = { len: -1, mid: [0, 0] };
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len > best.len) best = { len, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
  }
  await page.mouse.click(surfaceBox.x + best.mid[0], surfaceBox.y + best.mid[1]);
}

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

// ---- checks ----

check("app loads with the pedal library", async (page) => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator(".app-title").waitFor();
  const hint = await page.locator(".library-hint").first().textContent();
  if (!/pedals available/.test(hint ?? "")) throw new Error(`Unexpected library hint: ${hint}`);
});

check("search + add a pedal from the library", async (page) => {
  await page.locator(".library-search").fill("boss");
  await page.locator(".library-card").first().waitFor();
  await page.locator(".library-card-add").first().click();
  await page.locator(".pedal").first().waitFor();
  if ((await page.locator(".pedal").count()) !== 1) throw new Error("Expected 1 pedal on the board");

  const surfaceBox = await page.locator(".board-surface").boundingBox();
  await dragPedalTo(page, page.locator(".pedal").nth(0), surfaceBox.x + 100, surfaceBox.y + 100);
});

check("free-drag moves a pedal a large distance", async (page) => {
  const pedal = page.locator(".pedal").nth(0);
  const before = await pedal.boundingBox();
  await dragPedalTo(page, pedal, before.x + before.width / 2 + 260, before.y + before.height / 2 + 160);
  const after = await pedal.boundingBox();
  const movedPx = Math.hypot(after.x - before.x, after.y - before.y);
  if (movedPx < 150) throw new Error(`Pedal only moved ${movedPx.toFixed(0)}px — free-drag may be stuck again`);
  // Put it back in a predictable spot for the checks that follow.
  const surfaceBox = await page.locator(".board-surface").boundingBox();
  await dragPedalTo(page, pedal, surfaceBox.x + 100, surfaceBox.y + 100);
});

check("zoom controls change the zoom readout", async (page) => {
  const label = page.locator(".zoom-pct");
  const before = await label.textContent();
  await page.locator('.zoom-btn[title="Zoom in"]').click();
  await page.locator('.zoom-btn[title="Zoom in"]').click();
  const after = await label.textContent();
  if (after === before) throw new Error("Zoom-in didn't change the % readout");
  await page.locator(".zoom-fit").click();
});

check("add a 2nd pedal, multi-select + duplicate, undo/redo", async (page) => {
  await page.locator(".library-card-add").nth(1).click();
  await page.locator(".pedal").nth(1).waitFor();
  if ((await page.locator(".pedal").count()) !== 2) throw new Error("Expected 2 pedals before duplicating");

  const surfaceBox = await page.locator(".board-surface").boundingBox();
  await dragPedalTo(page, page.locator(".pedal").nth(1), surfaceBox.x + 400, surfaceBox.y + 100);

  // Adding a pedal auto-selects it, so clear that first — otherwise the
  // first shift-click below would *add to* that selection instead of
  // starting a fresh one.
  await page.keyboard.press("Escape");

  await page.locator(".pedal").nth(0).click({ modifiers: ["Shift"] });
  await page.locator(".pedal").nth(1).click({ modifiers: ["Shift"] });
  await page.locator(".panel-title", { hasText: "pedals selected" }).waitFor();

  await page.getByRole("button", { name: "Duplicate here" }).click();
  if ((await page.locator(".pedal").count()) !== 4) throw new Error("Duplicate didn't add the expected 2 pedals");

  await page.locator('button[title^="Undo"]').click();
  if ((await page.locator(".pedal").count()) !== 2) throw new Error("Undo didn't remove the duplicated pair");

  await page.locator('button[title^="Redo"]').click();
  if ((await page.locator(".pedal").count()) !== 4) throw new Error("Redo didn't restore the duplicated pair");

  // Spread the two new duplicates (cascade-offset from their sources, so
  // likely still close together) out of everyone else's way.
  const surfaceBox2 = await page.locator(".board-surface").boundingBox();
  await dragPedalTo(page, page.locator(".pedal").nth(2), surfaceBox2.x + 100, surfaceBox2.y + 320);
  await dragPedalTo(page, page.locator(".pedal").nth(3), surfaceBox2.x + 400, surfaceBox2.y + 320);
});

check("snap-to-jack connection + elbow drag handle", async (page) => {
  const jackOut = page.locator(".jack.jack-out").nth(0);
  const jackIn = page.locator(".jack.jack-in").nth(1);
  await jackOut.click();
  await jackIn.click();
  await page.locator(".connection-layer .connection").first().waitFor();

  await clickConnectionLine(page);
  const handle = page.locator(".connection-handle");
  await handle.waitFor();

  const before = await handle.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const afterBox = await page.locator(".connection-handle").boundingBox();
  if (Math.abs(afterBox.y - before.y) < 20) throw new Error("Dragging the elbow handle didn't move the route");
});

check("snap-to-neighbor shows an alignment guide while dragging", async (page) => {
  await page.locator(".library-card-add").nth(2).click();
  await page.locator(".pedal").nth(4).waitFor();
  await page.locator(".library-card-add").nth(3).click();
  await page.locator(".pedal").nth(5).waitFor();

  const surfaceBox = await page.locator(".board-surface").boundingBox();
  const anchor = page.locator(".pedal").nth(4);
  const mover = page.locator(".pedal").nth(5);
  // Kept well inside the board surface's own bounds (not just an arbitrary
  // offset) — a pedal placed past the surface's right edge ends up
  // underneath the inspector column instead, where a click lands on
  // inspector content rather than the pedal.
  await dragPedalTo(page, anchor, surfaceBox.x + Math.min(300, surfaceBox.width * 0.4), surfaceBox.y + Math.min(100, surfaceBox.height * 0.2));
  await dragPedalTo(page, mover, surfaceBox.x + Math.min(500, surfaceBox.width * 0.65), surfaceBox.y + Math.min(320, surfaceBox.height * 0.65));

  await page.locator(".toolbar-snap label", { hasText: "Snap: neighbors" }).locator("input").check();
  // Selecting a pedal changes the inspector panel's height, which can
  // reflow the board column's available width under auto-fit zoom — wait
  // for that to settle so the coordinates read below are still accurate
  // once the drag actually dispatches.
  await page.waitForTimeout(150);

  const anchorBox = await anchor.boundingBox();
  const moverBox = await mover.boundingBox();
  await page.mouse.move(moverBox.x + moverBox.width / 2, moverBox.y + moverBox.height / 2);
  await page.mouse.down();
  // The mouse tracks the pedal's *center* 1:1 as it's dragged, so to line
  // up the two pedals' left edges the target needs the mover's half-width
  // added back on — aiming the mouse at anchorBox.x itself would leave the
  // mover's edge short by exactly that much. Well within the neighbor-snap
  // threshold either way; don't release yet.
  await page.mouse.move(anchorBox.x + moverBox.width / 2, moverBox.y + moverBox.height / 2, { steps: 10 });

  const guideVisible = await page.evaluate(() => {
    const v = document.querySelector(".snap-guide-v");
    const h = document.querySelector(".snap-guide-h");
    return (v && getComputedStyle(v).display !== "none") || (h && getComputedStyle(h).display !== "none");
  });
  await page.mouse.up();
  if (!guideVisible) throw new Error("No alignment guide appeared while dragging near a neighbor");

  const guideHiddenAfter = await page.evaluate(() => {
    const v = document.querySelector(".snap-guide-v");
    const h = document.querySelector(".snap-guide-h");
    return getComputedStyle(v).display === "none" && getComputedStyle(h).display === "none";
  });
  if (!guideHiddenAfter) throw new Error("Alignment guide stayed visible after the drag ended");

  await page.locator(".toolbar-snap label", { hasText: "Snap: neighbors" }).locator("input").uncheck();
});

check("multi-jack toggles add the expected jack dots", async (page) => {
  // The anchor pedal from the previous check: alone at a known spot, so a
  // plain click can't land on a different, overlapping pedal instead.
  await page.locator(".pedal").nth(4).click();
  const before = await page.locator(".jack").count();
  const checkboxes = page.locator(".inspector-panel .checkbox-field input[type=checkbox]");
  await checkboxes.nth(0).check(); // Stereo I/O
  await checkboxes.nth(1).check(); // MIDI
  const after = await page.locator(".jack").count();
  if (after - before !== 4) throw new Error(`Expected 4 new jacks (stereo + MIDI), got ${after - before}`);
});

check("new board tab starts empty, and copy/paste duplicates across boards", async (page) => {
  // Same anchor pedal — still isolated, still a safe, unambiguous click target.
  await page.locator(".pedal").nth(4).click();
  await page.keyboard.press("Control+c");

  page.once("dialog", (d) => d.accept("Test board"));
  await page.locator(".board-tab-add").click();
  await page.locator(".board-tab.is-active", { hasText: "Test board" }).waitFor();
  if ((await page.locator(".pedal").count()) !== 0) throw new Error("New board should start empty");

  await page.keyboard.press("Control+v");
  if ((await page.locator(".pedal").count()) !== 1) throw new Error("Paste didn't duplicate the copied pedal onto the new board");
});

// ---- runner ----

async function main() {
  const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "pipe",
  });
  let serverLog = "";
  preview.stdout.on("data", (d) => (serverLog += d));
  preview.stderr.on("data", (d) => (serverLog += d));

  const browser = await chromium.launch();
  let failures = 0;
  try {
    await waitForServer(BASE);
    const page = await browser.newPage();
    // Uncaught exceptions only — a blocked/failed network request (fonts,
    // pedal images from an external host) is expected in some environments
    // and isn't an app bug, so it's deliberately not treated as a failure
    // here.
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    for (const { name, fn } of checks) {
      try {
        await fn(page);
        console.log(`  ok  ${name}`);
      } catch (err) {
        failures++;
        console.error(`FAIL  ${name}`);
        console.error(`      ${err.message}`);
      }
    }

    if (pageErrors.length) {
      failures++;
      console.error(`FAIL  no uncaught page errors (${pageErrors.length} occurred)`);
      for (const e of pageErrors.slice(0, 5)) console.error(`      ${e}`);
    } else {
      console.log("  ok  no uncaught page errors");
    }
  } catch (err) {
    failures++;
    console.error(`FAIL  setup: ${err.message}`);
    console.error(serverLog);
  } finally {
    await browser.close();
    preview.kill();
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length + 1} checks passed.`);
}

main();
