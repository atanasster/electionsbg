// One-shot screenshot helper for the MP connections tutorial.
// Usage: node /tmp/snap-connections.mjs
// Requires the dev server already running at http://localhost:5173

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = "/Users/atanasster/data-bg/docs/images/connections";
const BASE = "http://localhost:5173";

const SHOTS = [
  // [filename, route, prep-fn, capture-fn]
  // dashboard tile (full national dashboard, then crop tile)
  {
    file: "01-dashboard-tile.png",
    url: "/",
    prep: async (p) => {
      await p.waitForSelector("text=MP BUSINESS CONNECTIONS", { timeout: 30000 });
      await p.waitForTimeout(800);
    },
    capture: async (p) => {
      const handle = await p.locator("div", { hasText: "MP BUSINESS CONNECTIONS" })
        .filter({ hasText: "TOP COMPANIES" })
        .filter({ hasText: "All companies" })
        .last()
        .elementHandle();
      // Up two levels to grab the StatCard wrapper
      const card = await handle.evaluateHandle((el) => el.closest('[class*="rounded"]')?.parentElement || el);
      await card.scrollIntoViewIfNeeded();
      await p.waitForTimeout(500);
      return card;
    },
  },
  {
    file: "02-region-dashboard-tile.png",
    url: "/region/varna",
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(800);
    },
    capture: async (p) => {
      const handle = await p.locator("div", { hasText: "MP BUSINESS CONNECTIONS" })
        .last()
        .elementHandle()
        .catch(() => null);
      if (!handle) return null;
      const card = await handle.evaluateHandle((el) => el.closest('[class*="rounded"]')?.parentElement || el);
      await card.scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      return card;
    },
  },
  {
    file: "03-candidate-declarations.png",
    url: "/candidate/" + encodeURIComponent("ДИМИТЪР ГЕОРГИЕВ НАЙДЕНОВ"),
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(1200);
    },
    capture: async (p) => {
      // Find the financial declarations block
      const handle = await p.locator(":text-matches('financial declarations|Financial declarations|Имуществени декларации', 'i')")
        .first()
        .elementHandle()
        .catch(() => null);
      if (!handle) return null;
      const card = await handle.evaluateHandle((el) => {
        let cur = el;
        for (let i = 0; i < 5; i++) {
          if (cur.parentElement && cur.parentElement.classList.contains("rounded-xl")) return cur.parentElement;
          cur = cur.parentElement;
          if (!cur) break;
        }
        return el.closest('section, [class*="rounded"]') || el;
      });
      await card.scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      return card;
    },
  },
  {
    file: "04-candidate-management.png",
    url: "/candidate/" + encodeURIComponent("ДИМИТЪР ГЕОРГИЕВ НАЙДЕНОВ"),
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(1200);
    },
    capture: async (p) => {
      const handle = await p.locator(":text-matches('Management roles|Управленски роли', 'i')")
        .first()
        .elementHandle()
        .catch(() => null);
      if (!handle) return null;
      const card = await handle.evaluateHandle((el) => el.closest('[class*="rounded-xl"]') || el.parentElement?.parentElement || el);
      await card.scrollIntoViewIfNeeded();
      await p.waitForTimeout(400);
      return card;
    },
  },
  {
    file: "05-candidate-mini-graph.png",
    url: "/candidate/" + encodeURIComponent("ДИМИТЪР ГЕОРГИЕВ НАЙДЕНОВ"),
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(2500);
    },
    capture: async (p) => {
      const handle = await p.locator(":text-matches('mini|connections|Връзки', 'i'):below(:text(\"Management\"))")
        .first()
        .elementHandle()
        .catch(() => null);
      if (handle) {
        const card = await handle.evaluateHandle((el) => el.closest('[class*="rounded-xl"]') || el);
        await card.scrollIntoViewIfNeeded();
        await p.waitForTimeout(400);
        return card;
      }
      // Fallback: find canvas inside candidate page
      const canvas = await p.locator("canvas").first().elementHandle().catch(() => null);
      if (canvas) {
        const card = await canvas.evaluateHandle((el) => el.closest('[class*="rounded"]') || el.parentElement);
        await card.scrollIntoViewIfNeeded();
        await p.waitForTimeout(400);
        return card;
      }
      return null;
    },
  },
  {
    file: "06-orbital-default.png",
    url: "/connections",
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(4000);
    },
    capture: "fullpage",
  },
  {
    file: "07-orbital-cluster-by-party.png",
    url: "/connections",
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(2000);
      // Toggle "Cluster by party" if present
      const btn = await p.locator(":text-matches('cluster by party|Групирай по парти', 'i')")
        .first()
        .elementHandle()
        .catch(() => null);
      if (btn) await btn.click().catch(() => {});
      await p.waitForTimeout(3000);
    },
    capture: "fullpage",
  },
  {
    file: "08-orbital-largest-component.png",
    url: "/connections",
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(2000);
      const btn = await p.locator(":text-matches('largest component|Най-голям компонент', 'i')")
        .first()
        .elementHandle()
        .catch(() => null);
      if (btn) await btn.click().catch(() => {});
      await p.waitForTimeout(3000);
    },
    capture: "fullpage",
  },
  {
    file: "09-all-companies.png",
    url: "/mp/companies",
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(800);
    },
    capture: "fullpage-top",
  },
  {
    file: "10-company-detail.png",
    url: "/mp/company/" + encodeURIComponent("ПиВи-Квантум-ООД"),
    prep: async (p) => {
      await p.waitForLoadState("networkidle");
      await p.waitForTimeout(800);
    },
    capture: "fullpage-top",
  },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
// Pre-set i18n + theme
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("i18nextLng", "en");
    localStorage.setItem("language", "en");
    localStorage.setItem("theme", "light");
  } catch {}
});
const page = await ctx.newPage();

for (const shot of SHOTS) {
  const url = BASE + shot.url;
  console.log(`-> ${shot.file}  ${url}`);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (shot.prep) await shot.prep(page);
    const out = path.join(OUT, shot.file);
    if (shot.capture === "fullpage") {
      await page.screenshot({ path: out, fullPage: true });
    } else if (shot.capture === "fullpage-top") {
      // Capture viewport-sized screenshot from top
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await page.setViewportSize({ width: 1440, height: 1600 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: out, fullPage: false });
      await page.setViewportSize({ width: 1440, height: 900 });
    } else if (typeof shot.capture === "function") {
      const handle = await shot.capture(page);
      if (handle) {
        await handle.screenshot({ path: out });
      } else {
        console.log(`   (no element matched, falling back to viewport)`);
        await page.screenshot({ path: out, fullPage: false });
      }
    }
    console.log(`   saved ${out}`);
  } catch (e) {
    console.error(`   failed:`, e.message);
  }
}

await browser.close();
console.log("done.");
