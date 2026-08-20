// One-off: capture the two screenshots the risk-methodology page and the
// "Отваряме сигналите" article embed — the A–F grades, and the signals firing
// on one contract. Runs against the local Vite dev server (which proxies
// /api/db to the deployed backend, so the numbers in the image are the SERVED
// ones rather than a local vintage).
//
// Usage:
//   npm run dev                          # in one terminal (port 5173)
//   node scripts/capture-risk-shots.mjs
//   BASE=http://localhost:57243 node scripts/capture-risk-shots.mjs
//
// ⚠️ WRITES WEBP, NOT PNG — unlike the older capture scripts here, and the
// difference is load-bearing rather than a style choice. `scripts/images/
// optimize.ts` converts every PNG under dist/articles/images to webp, DELETES
// the original and rewrites the references it can find — HTML, JSON, Markdown,
// XML. It does NOT rewrite the built JS bundle, so a PNG path hard-coded in a
// TSX component (ProcurementMethodologyScreen embeds both of these) would point
// at a file the postbuild had just deleted: a broken image on prod, at a 200,
// invisible in dev where the PNG still exists. Emitting webp keeps ONE copy of
// each shot that both the markdown and the component can name, because
// optimize.ts only ever considers png/jpg. `collectImageDimensions` already
// reads webp, so the prerendered <img> still gets its width/height and the page
// stays CLS-free.
//
// Sized for the article column (max-w-5xl ≈ 960 CSS px): captured at a 1000 px
// viewport, 2× DPI, so the source is ~2000 px wide — retina-sharp at the
// rendered size and nothing beyond it.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const BASE = process.env.BASE || "http://localhost:5173";
const OUT_DIR = resolve("public/articles/images/procurement-risk");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1000, height: 1200 };
const WEBP_QUALITY = 82;
const PAD = 12;

// The site header is sticky, so `scrollIntoView({block:"start"})` parks the
// target UNDER it and the clip loses its own first rows — which on both of
// these shots is the row carrying the grade. Measure whatever is actually
// pinned across the top and scroll clear of it. Installed as an init script
// because the clip callbacks below run in the PAGE, not in this process.
const SCROLL_CLEAR = `
window.__scrollClear = (el) => {
  el.scrollIntoView({ block: "start" });
  let pinned = 0;
  for (const e of document.querySelectorAll("body *")) {
    const s = getComputedStyle(e);
    if (s.position !== "fixed" && s.position !== "sticky") continue;
    const r = e.getBoundingClientRect();
    // Only bars parked at the top edge and spanning the page — a sticky table
    // column or a floating button is not in the way.
    if (r.top <= 4 && r.height > 0 && r.width > window.innerWidth * 0.5) {
      pinned = Math.max(pinned, r.bottom);
    }
  }
  window.scrollBy(0, -(pinned + 12));
};
`;

const SHOTS = [
  {
    // Автомагистрали ЕАД — one entity that is BOTH a buyer and a supplier, so
    // the page draws both grade cards: B as a buyer (23/100), F as a supplier
    // (90/100). That pair is the illustration the methodology's "Оценките A–F"
    // section and the article's third open question are about — two roles,
    // different component sets, different weights — which a single-role page
    // cannot show. A state-owned in-house contractor is also the fair subject
    // for a screenshot that names somebody: the exposure is structural and
    // already public, where the same picture of a private firm would be a much
    // stronger claim than the article is prepared to make.
    name: "01-grades",
    url: "/company/831646048",
    // Union of the two grade cards.
    clip: (heading) => {
      const cards = [...document.querySelectorAll("h1,h2,h3,h4")]
        .filter((e) => (e.textContent || "").includes(heading))
        .map((e) => e.closest(".rounded-xl"))
        .filter(Boolean);
      if (cards.length < 2) return null;
      window.__scrollClear(cards[0]);
      const boxes = cards.map((c) => c.getBoundingClientRect());
      const x = Math.min(...boxes.map((b) => b.left));
      const y = Math.min(...boxes.map((b) => b.top));
      return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.right)) - x,
        height: Math.max(...boxes.map((b) => b.bottom)) - y,
      };
    },
    arg: "Изложеност на риск при поръчки",
  },
  {
    // АПИ → Автомагистрали ЕАД, the €461M in-house road award: 4 of 10
    // applicable checks fired, grade E. The clip is the whole RiskBadges
    // `full` block — grade, meter and the ALWAYS-OPEN ledger — because the
    // ledger is what the article's denominator paragraph is about: it shows
    // the checks that PASSED and the ones that could not be made at all, not
    // only the four that fired.
    name: "02-signals",
    url: "/procurement/contract/7245425ff1c0",
    clip: (label) => {
      const el = [...document.querySelectorAll("span,div")].find(
        (e) => (e.textContent || "").trim() === label,
      );
      const block = el?.closest(".pt-2");
      if (!block) return null;
      window.__scrollClear(block);
      const r = block.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    arg: "Задействани сигнали",
  },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "bg-BG",
});
await ctx.addInitScript({ content: SCROLL_CLEAR });
const page = await ctx.newPage();

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.setItem("language", "bg");
  localStorage.setItem("i18nextLng", "bg");
  // The community CTA strip sits under the header and would eat the top of a
  // clip taken near the fold.
  localStorage.setItem("naiasno_cta_dismissed_until", String(9_999_999_999_999));
});

for (const shot of SHOTS) {
  await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  let box = await page.evaluate(shot.clip, shot.arg);
  if (!box) {
    console.warn(`  SKIP ${shot.name} — target not found on ${shot.url}`);
    continue;
  }
  // Re-measure once the scroll has settled: the first pass both scrolls and
  // measures, so its box is the pre-scroll geometry.
  await page.waitForTimeout(700);
  box = await page.evaluate(shot.clip, shot.arg);

  const png = await page.screenshot({
    clip: {
      x: Math.max(0, box.x - PAD),
      y: Math.max(0, box.y - PAD),
      width: box.width + PAD * 2,
      height: box.height + PAD * 2,
    },
  });
  const out = `${OUT_DIR}/${shot.name}.webp`;
  await sharp(png).webp({ quality: WEBP_QUALITY }).toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`  wrote ${shot.name}.webp (${meta.width}×${meta.height})`);
}

await browser.close();
console.log(`done. images in ${OUT_DIR}`);
// The article markdown gets its width/height from `collectImageDimensions` at
// prerender time; the methodology page cannot, so its <Shot> call sites state
// them by hand. A re-capture that changes a dimension and leaves those alone
// reserves the wrong aspect ratio — CLS, with nothing failing.
console.log(
  "if any dimension above changed, update the matching <Shot width/height> in " +
    "src/screens/procurement/ProcurementMethodologyScreen.tsx",
);
