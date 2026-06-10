// Take the og:image screenshot of the /data map. Captures the live React Flow
// diagram at 1200x630 (the canonical og:image aspect ratio) and saves it to
// public/og/ so the prerender step can reference it in the per-page meta tags.
//
// The graph is a tall three-column flow (sources → datasets → features), so a
// straight viewport grab would only catch a sliver. Instead we pin the React
// Flow canvas to fill the 1200x630 card and lock its pan/zoom (via an
// !important transform that survives RF's own re-renders) to a full-width
// horizontal band across the top — all three tier columns with their flowing
// edges, the way the second screenshot in the design brief frames it.
//
// Run with the dev server up:
//   npm run dev    # in another shell
//   npx tsx scripts/og/screenshot_data_map.ts
//
// Output: public/og/data-map.png

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OG_DIR = path.join(REPO_ROOT, "public/og");

const BASE = process.env.OG_BASE_URL ?? "http://localhost:5173";

// Pan/zoom that frames all three columns (sources / datasets / features) as a
// full-width band from the top of the graph. The graph is ~996 units wide, so
// scale 1.18 fills the 1200px card with a hair of side margin; ty=0 starts the
// band at the tier labels. Tuned against the live render.
const FRAME = { scale: 1.18, tx: 12, ty: 0 };

const run = async (): Promise<void> => {
  fs.mkdirSync(OG_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 2, // existing og images are 2400x1260 — 2x retina
    });
    const page = await context.newPage();
    const url = `${BASE}/data`;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

    // Wait for the React Flow nodes to lay out (manifest fetch + ELK positions).
    await page
      .waitForFunction(
        () => document.querySelectorAll(".react-flow__node").length > 10,
        { timeout: 20_000 },
      )
      .catch(() => console.log("  ⚠ nodes didn't resolve — capturing anyway"));
    await page.waitForTimeout(800);

    await page.evaluate((frame) => {
      window.scrollTo(0, 0);
      const rf = document.querySelector(".react-flow") as HTMLElement | null;
      if (!rf) return;
      Object.assign(rf.style, {
        position: "fixed",
        left: "0px",
        top: "0px",
        width: "1200px",
        height: "630px",
        zIndex: "2147483647",
        background: "hsl(var(--background))",
        borderRadius: "0",
        border: "none",
        margin: "0",
        overflow: "hidden",
      });
      // Drop the interactive chrome — controls, zoom buttons, attribution.
      document
        .querySelectorAll(
          ".react-flow__controls, .react-flow__attribution, .react-flow__panel, .react-flow__minimap",
        )
        .forEach((e) =>
          (e as HTMLElement).style.setProperty("display", "none", "important"),
        );
      // Clamp the page so a full-page grab is exactly the card height.
      for (const el of [document.documentElement, document.body]) {
        el.style.setProperty("height", "630px", "important");
        el.style.setProperty("max-height", "630px", "important");
        el.style.setProperty("overflow", "hidden", "important");
        el.style.setProperty("margin", "0", "important");
      }
      // Pin the pan/zoom with !important so RF's own re-renders can't reset it.
      const st =
        document.getElementById("og-pin") ??
        (() => {
          const s = document.createElement("style");
          s.id = "og-pin";
          document.head.appendChild(s);
          return s;
        })();
      st.textContent = `.react-flow__viewport{transform: translate(${frame.tx}px, ${frame.ty}px) scale(${frame.scale}) !important;}`;
    }, FRAME);

    await page.waitForTimeout(400);
    const outPath = path.join(OG_DIR, "data-map.png");
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    const stat = fs.statSync(outPath);
    console.log(`  ✓ data-map.png (${Math.round(stat.size / 1024)} KB)`);
  } finally {
    await browser.close();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
