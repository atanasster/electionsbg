/**
 * Captures the app's REAL screens as high-DPI plates for the explainer.
 *
 *   npm run dev                       # in one terminal
 *   npm run video:screens             # here (auto-detects the dev port)
 *
 * ── WHY A STILL PLATE AND NOT A SCREEN RECORDING ──────────────────────────────
 * The scene needs to pan and zoom across the UI. Re-rendering the page per frame
 * (or replaying a recording) reintroduces every determinism problem the skill's
 * render-stability rules exist to avoid. Instead: capture ONCE, oversized, and
 * move it with a CSS transform — the "fixed plate" pattern. Deterministic, no
 * async harness, and a 2x plate stays inside Chromium's 4096px ceiling.
 *
 * The capture ALSO emits the element rectangles (in plate pixels), so the
 * composition can frame a specific row without anyone hand-measuring pixels off
 * a screenshot — the choreography is derived from the DOM, not eyeballed.
 *
 * ⚠️ STALENESS. This records real numbers off a real page, so it goes out of date
 * when the data does — unlike the drawn canvas, which is regenerated from
 * committed data with assertions. Re-run it whenever `data/macro_peers.json`
 * refreshes, and prefer it for beats about HOW THE TOOL WORKS rather than about a
 * specific figure. See .claude/skills/naiasno-video/references/scenes.md.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUT_DIR = resolve("video/public/screens");
const META = resolve("video/src/generated/screens.json");

/** 2x for crisp text when the composition zooms in; stays well under 4096px. */
const DPR = 2;

/** src/theme/utils.ts — `themeDark`. */
const DARK_THEME = "sunset";
const VIEWPORT = { width: 1600, height: 1000 };

/** Find the running Vite dev port rather than assuming 5173 (autoPort moves it). */
const detectPort = (): number => {
  const envPort = process.env.DEV_PORT;
  if (envPort) return Number(envPort);
  try {
    const out = execSync(
      "lsof -nP -iTCP -sTCP:LISTEN | grep -i node | awk '{print $9}'",
      { encoding: "utf8" },
    );
    const ports = [...out.matchAll(/:(\d+)$/gm)].map((m) => Number(m[1]));
    for (const p of ports) if (p === 5173) return p;
    // Vite's autoPort lands high; take the highest listening node port.
    const high = ports.filter((p) => p > 1024).sort((a, b) => b - a)[0];
    if (high) return high;
  } catch {
    /* fall through */
  }
  return 5173;
};

const SHOTS = [
  {
    name: "eu-compare-peers",
    path: "/indicators/compare",
    /** Section heading to frame — resolved in the page, never a pixel guess. */
    sectionHeading: "Последни стойности",
    /** Row to zoom onto, by its exact label. */
    focusRow: "Инфлация (ХИПЦ)",
  },
];

const main = async () => {
  const port = detectPort();
  const base = `http://localhost:${port}`;
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(resolve("video/src/generated"), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    // The videos are dark-themed; a light plate would sit on the stage as an
    // obvious foreign object. The app's ThemeContext seeds from this key (and
    // falls back to prefers-color-scheme), so setting both gets a dark capture
    // without touching app code.
    colorScheme: "dark",
  });
  // NOTE the token: the app's dark theme is stored as "sunset", not "dark"
  // (src/theme/utils.ts). Writing "dark" silently does nothing — the context
  // treats it as an unknown value and falls back to light, which is exactly what
  // the first capture did.
  await page.addInitScript((t: string) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* storage can be blocked; colorScheme is the fallback */
    }
  }, DARK_THEME);

  const meta: Record<string, unknown> = {};

  for (const shot of SHOTS) {
    const url = `${base}${shot.path}`;
    await page.goto(url, { waitUntil: "networkidle" });
    // Charts animate in; give layout and any entry transition time to settle so
    // the plate is the RESTING state rather than a frame mid-animation.
    await page.waitForTimeout(2500);

    const box = await page.evaluate((s) => {
      const sec = [...document.querySelectorAll("section")].find((el) =>
        el.querySelector("h2,h3")?.textContent?.includes(s.sectionHeading),
      );
      if (!sec) return null;
      const r = sec.getBoundingClientRect();
      const abs = {
        x: r.left + scrollX,
        y: r.top + scrollY,
        w: r.width,
        h: r.height,
      };
      // The element whose text IS the label is only the label CELL, and centring
      // the zoom on it pushes the values — the point of the beat — off-frame.
      // Walking UP does not help either: the table is a grid, so cells are
      // siblings and the first full-width ancestor is the whole table.
      //
      // The right target is a BAND: the label's vertical extent at the section's
      // full width, which is exactly the row a reader would trace with a finger.
      const labelEl = [...sec.querySelectorAll("div")].find(
        (d) => (d.textContent || "").trim() === s.focusRow,
      );
      const lr = labelEl?.getBoundingClientRect();
      // Span the CONTENT, not the section. The table is one grid with
      // `w-max min-w-full`, so it stretches to the section width while its cells
      // occupy roughly half of it — a band across the section is mostly empty,
      // which makes "fit the band" identical to "fit the plate" and kills the zoom.
      // First cell's left to last cell's right is the actual row.
      const cells = labelEl?.parentElement
        ? [...labelEl.parentElement.children].map((c) =>
            c.getBoundingClientRect(),
          )
        : [];
      const left = cells.length
        ? Math.min(...cells.map((c) => c.left))
        : r.left;
      const right = cells.length
        ? Math.max(...cells.map((c) => c.right))
        : r.right;
      const rr = lr
        ? ({
            left,
            top: lr.top,
            width: right - left,
            height: lr.height,
          } as DOMRect)
        : undefined;
      return {
        abs,
        row: rr
          ? {
              x: rr.left + scrollX,
              y: rr.top + scrollY,
              w: rr.width,
              h: rr.height,
            }
          : null,
      };
    }, shot);

    if (!box) {
      console.error(
        `  ✗ ${shot.name}: section "${shot.sectionHeading}" not found`,
      );
      continue;
    }

    const file = `${shot.name}.png`;
    // `fullPage` is required WITH the clip: the rects above are document
    // coordinates, and the target section sits ~1700px down. Without it Playwright
    // clips against the VIEWPORT and throws once the region falls outside it.
    await page.screenshot({
      path: resolve(OUT_DIR, file),
      fullPage: true,
      clip: { x: box.abs.x, y: box.abs.y, width: box.abs.w, height: box.abs.h },
    });

    // Rects are recorded in PLATE pixels (CSS px x DPR) and relative to the clip,
    // which is the coordinate space the composition actually transforms in.
    meta[shot.name] = {
      file: `screens/${file}`,
      plate: { w: Math.round(box.abs.w * DPR), h: Math.round(box.abs.h * DPR) },
      focus: box.row
        ? {
            x: Math.round((box.row.x - box.abs.x) * DPR),
            y: Math.round((box.row.y - box.abs.y) * DPR),
            w: Math.round(box.row.w * DPR),
            h: Math.round(box.row.h * DPR),
          }
        : null,
      capturedFrom: url,
    };
    console.log(
      `  ✓ ${file}  ${Math.round(box.abs.w * DPR)}x${Math.round(box.abs.h * DPR)}` +
        (box.row
          ? `  focus row @${Math.round((box.row.y - box.abs.y) * DPR)}`
          : ""),
    );
  }

  await browser.close();
  writeFileSync(META, JSON.stringify(meta, null, 2), "utf8");
  console.log(`  → ${META}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
