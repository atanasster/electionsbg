import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Note: `path` is deliberately NOT imported — the CLS loops below bind `path`
// as a per-route variable and would shadow it.
const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));

// Static imports of a built chunk, as emitted by Rollup (`from"./chunk.js"`).
const staticImportsOf = (file: string): string[] => {
  const code = fs.readFileSync(`${DIST_DIR}/assets/${file}`, "utf8");
  return [...code.matchAll(/from"\.\/([A-Za-z0-9._-]+\.js)"/g)].map(
    (m) => m[1],
  );
};

// Performance regression checks. These don't try to assert real-world Web
// Vitals (localhost timings are too fast to be representative) — they assert
// on the structural decisions that drive CWV: how much JS gets pulled before
// LCP, total HTML size of the prerendered shell, and that long-task
// generators stay below a sane budget on the home page.

// The prerendered home shell has grown legitimately since this budget was first set
// (a 4th top-level nav view, richer "latest analyses" strip, bespoke OG tags). Raised
// 14k → 18k to match; ~17.2k today leaves a little headroom. This still guards against a
// runaway regression (e.g. a heavy chunk inlined into the shell) — re-tighten if the home
// markup is ever trimmed back.
const HOME_HTML_MAX_BYTES = 18_000;
// We trimmed the eagerly-modulepreloaded chunk count from 9 → 6 by stripping
// vendor-pdf, vendor-charts, vendor-leaflet, vendor-markdown. 7 leaves a
// little headroom (e.g. for adding back vendor-charts intentionally) before
// the test starts complaining.
const HOME_MODULEPRELOAD_MAX = 7;

test.describe("performance", () => {
  test("home HTML is under size budget", async ({ request }) => {
    const res = await request.get("/");
    const html = await res.text();
    expect(html.length).toBeLessThan(HOME_HTML_MAX_BYTES);
  });

  test("home page modulepreload count is under budget", async ({ request }) => {
    const res = await request.get("/");
    const html = await res.text();
    const preloads = Array.from(
      html.matchAll(
        /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
      ),
    ).map((m) => m[1]);
    expect(
      preloads.length,
      `modulepreload list: ${preloads.join("\n")}`,
    ).toBeLessThanOrEqual(HOME_MODULEPRELOAD_MAX);
  });

  test("home page does not eagerly preload heavy route-only chunks", async ({
    request,
  }) => {
    const res = await request.get("/");
    const html = await res.text();
    const preloads = Array.from(
      html.matchAll(
        /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
      ),
    ).map((m) => m[1]);
    // Each of these adds 100KB+ gzip and is only used by lazy-loaded screens.
    for (const banned of [
      "vendor-pdf",
      "vendor-charts",
      "vendor-leaflet",
      "vendor-markdown",
      "exportToPDF-",
    ]) {
      expect(
        preloads.find((p) => p.includes(banned)),
        `unexpected modulepreload: ${banned}`,
      ).toBeUndefined();
    }
  });

  // The critical path is defined by the entry chunk's STATIC imports, not by
  // the modulepreload hints the test above asserts. Those two drifted apart:
  // the hint list was filtered clean while vendor-pdf stayed a static import
  // of the entry and was downloaded on every page load — green gate, 122 KB
  // brotli regression (docs/plans/bundle-critical-path-v1.md §0c/A1). Assert
  // the real invariant too, so the fix cannot be silently lost to a Vite
  // rename of the preload-helper module or a reordering of manualChunks.
  test("entry chunk does not statically import route-only vendor chunks", () => {
    const html = fs.readFileSync(`${DIST_DIR}/index.html`, "utf8");
    const entry = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    expect(
      entry,
      `entry chunk not found in ${DIST_DIR}/index.html — run \`npm run build\` first`,
    ).toBeTruthy();
    const imports = staticImportsOf(entry!.replace("assets/", ""));
    // Ratchet: vendor-charts and vendor-leaflet are still static imports until
    // T2 lands (the eager DashboardScreen pulls the map stack in). Add them to
    // this list in that commit — do not weaken the assertion.
    for (const banned of ["vendor-pdf", "vendor-markdown", "vendor-flow"]) {
      expect(
        imports.find((i) => i.startsWith(banned)),
        `${banned} is back on the critical path: ${imports.join(", ")}`,
      ).toBeUndefined();
    }
  });

  test("vendor-react has no static imports (cycle guard)", () => {
    const file = fs
      .readdirSync(`${DIST_DIR}/assets`)
      .find((f) => /^vendor-react-.*\.js$/.test(f));
    expect(
      file,
      "vendor-react chunk not found — run `npm run build`",
    ).toBeTruthy();
    // vendor-react is the foundational chunk AND the home of Vite's
    // __vitePreload helper, so every dynamic-importing chunk depends on it. It
    // must import nothing, or the "Cannot access 'X' before initialization"
    // cycle the manualChunks comments record becomes reachable app-wide.
    expect(staticImportsOf(file!)).toEqual([]);
  });

  test("LCP fires within 4s on localhost (smoke)", async ({ page }) => {
    // 4s is generous; localhost should be under 1s. The point is to catch
    // regressions where LCP stops firing entirely (e.g. a new render-blocking
    // resource breaks the paint pipeline).
    await page.goto("/", { waitUntil: "networkidle" });
    const lcp = await page.evaluate(
      () =>
        new Promise<number | null>((resolve) => {
          let last: number | null = null;
          // Buffered observer surfaces entries that fired before the
          // observer was created, so on a fully-loaded `networkidle` page
          // the entries are already in the queue.
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length) {
              last = entries[entries.length - 1].startTime;
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
          // Poll for up to 6s in case the worker is contending with other
          // parallel tests on the firebase emulator. Resolve as soon as we
          // have any LCP entry.
          const start = Date.now();
          const tick = () => {
            if (last !== null) return resolve(last);
            if (Date.now() - start > 6000) return resolve(last);
            setTimeout(tick, 100);
          };
          tick();
        }),
    );
    expect(lcp, "LCP did not fire").not.toBeNull();
    expect(lcp!).toBeLessThan(4000);
  });

  // CLS gate: every route must stay in the CWV "good" range (< 0.1). Each
  // entry is a (path, label) tuple — we use the path as the test name suffix
  // so a regression points directly at which route broke. Use realistic
  // sample IDs (real party / municipality codes from the latest election).
  // If these IDs change in a future election, update them — failure msgs
  // make the source obvious.
  const CLS_ROUTES: Array<{ path: string; label: string }> = [
    { path: "/", label: "home" },
    { path: "/sofia", label: "sofia" },
    { path: "/parties", label: "parties" },
    { path: "/regions", label: "regions" },
    { path: "/timeline", label: "timeline" },
    { path: "/simulator", label: "simulator" },
    { path: "/compare", label: "compare" },
    { path: "/polls", label: "polls" },
    { path: "/about", label: "about" },
    {
      path: "/party/%D0%93%D0%95%D0%A0%D0%91-%D0%A1%D0%94%D0%A1",
      label: "party detail",
    },
    { path: "/municipality/SOF", label: "municipality detail" },
    { path: "/reports/section/turnout", label: "report — section turnout" },
    {
      path: "/reports/section/concentrated",
      label: "report — section concentrated",
    },
    {
      path: "/reports/municipality/turnout",
      label: "report — municipality turnout",
    },
    // Routes flagged in Search Console CWV report on 2026-05-09 — initially
    // not covered by the gate, each had a sub-component that returned `null`
    // until its query resolved and then injected hundreds of pixels mid-page.
    {
      path: "/candidate/%D0%9A%D0%B8%D1%80%D0%B8%D0%BB%20%D0%99%D0%BE%D1%81%D0%B8%D1%84%D0%BE%D0%B2%20%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B5%D0%B2",
      label: "candidate detail (MP)",
    },
    { path: "/sections/IT", label: "sections list — international" },
    {
      path: "/reports/section/problem_sections",
      label: "report — problem sections",
    },
    {
      path: "/en/articles/2026-05-04-mp-connections",
      label: "article — mp-connections",
    },
  ];

  for (const { path, label } of CLS_ROUTES) {
    test(`CLS stays under 0.1 — ${label} (${path})`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      const cls = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            new PerformanceObserver((list) => {
              for (const e of list.getEntries() as PerformanceEntry[] &
                {
                  hadRecentInput?: boolean;
                  value?: number;
                }[]) {
                const ls = e as PerformanceEntry & {
                  hadRecentInput?: boolean;
                  value?: number;
                };
                if (!ls.hadRecentInput && typeof ls.value === "number") {
                  total += ls.value;
                }
              }
            }).observe({ type: "layout-shift", buffered: true });
            setTimeout(() => resolve(total), 1500);
          }),
      );
      expect(cls, `CLS=${cls.toFixed(4)} on ${path}`).toBeLessThan(0.1);
    });
  }

  // Slow-network CLS check. The unthrottled tests above can pass even when a
  // page injects content asynchronously, because the firebase emulator
  // serves JSON fast enough that fetches complete before first paint. Field
  // CrUX (the metric Search Console reports) sees real-world latency, where
  // those late fetches manifest as layout shifts. We pick the routes whose
  // shape is most sensitive to staggered data arrival (multi-card pages
  // with per-card queries) and re-run the gate while delaying each /static
  // JSON response by 800ms — enough to push the data past first paint.
  const SLOW_CLS_ROUTES: Array<{ path: string; label: string }> = [
    {
      path: "/candidate/%D0%9A%D0%B8%D1%80%D0%B8%D0%BB%20%D0%99%D0%BE%D1%81%D0%B8%D1%84%D0%BE%D0%B2%20%D0%92%D0%B0%D1%81%D0%B8%D0%BB%D0%B5%D0%B2",
      label: "candidate detail (MP)",
    },
    {
      path: "/reports/section/problem_sections",
      label: "report — problem sections",
    },
    {
      path: "/en/articles/2026-05-04-mp-connections",
      label: "article — mp-connections",
    },
  ];

  for (const { path, label } of SLOW_CLS_ROUTES) {
    test(`CLS stays under 0.1 with slow JSON — ${label} (${path})`, async ({
      page,
    }) => {
      await page.route("**/*.json", async (route) => {
        await new Promise((r) => setTimeout(r, 800));
        await route.continue();
      });
      await page.route("**/*.md", async (route) => {
        await new Promise((r) => setTimeout(r, 800));
        await route.continue();
      });
      await page.goto(path, { waitUntil: "networkidle" });
      const cls = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            new PerformanceObserver((list) => {
              for (const e of list.getEntries() as PerformanceEntry[] &
                {
                  hadRecentInput?: boolean;
                  value?: number;
                }[]) {
                const ls = e as PerformanceEntry & {
                  hadRecentInput?: boolean;
                  value?: number;
                };
                if (!ls.hadRecentInput && typeof ls.value === "number") {
                  total += ls.value;
                }
              }
            }).observe({ type: "layout-shift", buffered: true });
            setTimeout(() => resolve(total), 2500);
          }),
      );
      expect(cls, `CLS=${cls.toFixed(4)} on ${path}`).toBeLessThan(0.1);
    });
  }

  test("no individual blocking resource is too large", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const oversized = await page.evaluate(() => {
      const entries = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      const blockingTypes = new Set(["script", "css", "link"]);
      return entries
        .filter((e) => blockingTypes.has(e.initiatorType))
        .filter((e) => (e.encodedBodySize ?? e.decodedBodySize ?? 0) > 600_000)
        .map((e) => ({
          name: e.name,
          encoded: e.encodedBodySize,
          decoded: e.decodedBodySize,
        }));
    });
    expect(oversized, JSON.stringify(oversized, null, 2)).toEqual([]);
  });
});
