import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Note: `path` is deliberately NOT imported — the CLS loops below bind `path`
// as a per-route variable and would shadow it.
const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));

// Static imports of a built chunk, as emitted by Rollup. Matches BOTH the
// binding form (`from"./chunk.js"`) and the side-effect form
// (`import"./chunk.js"`) — Rollup emits the latter when a chunk's bindings are
// all tree-shaken but it must still execute, and this build contains ~3,200 of
// them. Missing those would let a real edge pass a leaf assertion vacuously,
// which is the failure mode every gate in this file exists to prevent.
const staticImportsOf = (file: string): string[] => {
  const code = fs.readFileSync(`${DIST_DIR}/assets/${file}`, "utf8");
  return [...code.matchAll(/(?:from|import)"\.\/([A-Za-z0-9._-]+\.js)"/g)].map(
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
// Home's hint list is 6: vendor-react, vendor, vendor-i18n, vendor-query,
// vendor-radix, vendor-search. The locale chunk is hinted too, but by an inline
// script rather than a static <link> (the language is only knowable at
// runtime), so it does not appear in this count — the
// "locale preload hint" test below is what covers it.
//
// Since T2.1 the heavy route chunks are not in the entry's static graph at all,
// so they cannot appear here — the entry-static-import ratchet below is what
// enforces that, not this count. (Vite only hints the entry's static imports,
// so a lazy chunk never joins the list on its own.) 7 is one slot of headroom
// for a genuinely foundational new vendor chunk; it is NOT room to re-add
// vendor-charts/vendor-leaflet.
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
      "vendor-editor",
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
    // Ratchet only — never weaken. vendor-charts and vendor-leaflet joined the
    // list when the home dashboard stopped being an eager import (T2.1); they
    // were static imports of the entry before that, so a regression here means
    // some module reachable from main.tsx without a lazy() boundary pulled the
    // map or chart stack back in.
    for (const banned of [
      "vendor-pdf",
      "vendor-markdown",
      "vendor-flow",
      "vendor-editor",
      "vendor-charts",
      "vendor-leaflet",
    ]) {
      expect(
        imports.find((i) => i.startsWith(banned)),
        `${banned} is back on the critical path: ${imports.join(", ")}`,
      ).toBeUndefined();
    }
  });

  // One `import translation from "@/locales/bg/translation.json"` anywhere in
  // the static graph re-inlines the corpus into the entry and reverts the whole
  // T4 saving (1.37 MB raw / 272 KB brotli) — and every other gate here stays
  // green, because the hint count is unchanged and the ratchet above only bans
  // a fixed list of vendor-* names.
  test("entry chunk does not statically import a translation bundle", () => {
    const html = fs.readFileSync(`${DIST_DIR}/index.html`, "utf8");
    const entry = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    expect(entry, "entry chunk not found — run `npm run build`").toBeTruthy();
    const imports = staticImportsOf(entry!.replace("assets/", ""));
    expect(
      imports.find((i) => i.startsWith("translation-")),
      `a translation bundle re-entered the entry chunk: ${imports.join(", ")}`,
    ).toBeUndefined();
  });

  // The locale hint is injected as an inline script rather than a static link
  // because the language is only knowable at runtime (the /en/* path OR
  // localStorage). Assert it ships and offers both chunks — a static
  // single-language hint would make one cohort download a bundle it never uses
  // AND still pay the serial hop, which is worse than before the split.
  test("the locale preload hint offers both translation chunks", () => {
    const html = fs.readFileSync(`${DIST_DIR}/index.html`, "utf8");
    const script = html.match(
      /<script[^>]*data-locale-preload[^>]*>([\s\S]*?)<\/script>/,
    );
    expect(script, "no locale preload hint in dist/index.html").toBeTruthy();
    const hrefs = [...script![1].matchAll(/"(\/assets\/translation-[^"]+)"/g)];
    expect(
      hrefs.length,
      `expected both locale chunks in the hint, found ${hrefs.length}`,
    ).toBe(2);
    expect(hrefs[0][1], "the hint offers the same chunk twice").not.toBe(
      hrefs[1][1],
    );
  });

  // Every assertion around it is "chunk X is absent from list Y", and a
  // newly-lazy chunk is absent by construction — so nothing above can see
  // whether making the home dashboard lazy cost home a serial round-trip. It
  // does not, because resolveDependencies is scoped to hostType "html" and so
  // leaves dynamic-import dep lists intact: the dashboard's own mapDeps entry
  // preloads the map/chart chunks in parallel. Assert that directly, since
  // re-broadening that filter would silently reintroduce the waterfall.
  test("home dashboard chunk preloads its map/chart deps in parallel", () => {
    const html = fs.readFileSync(`${DIST_DIR}/index.html`, "utf8");
    const entry = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
    expect(entry, "entry chunk not found — run `npm run build`").toBeTruthy();
    const code = fs.readFileSync(
      `${DIST_DIR}/${entry!.replace("assets/", "assets/")}`,
      "utf8",
    );
    const table = [...code.matchAll(/"(assets\/[^"]+)"/g)].map((m) => m[1]);
    const call = code.match(
      /DashboardScreen-[A-Za-z0-9_-]+\.js"\),__vite__mapDeps\(\[([0-9,]+)\]\)/,
    );
    expect(call, "dashboard dynamic import not found in entry").toBeTruthy();
    const deps = call![1].split(",").map((i) => table[Number(i)]);
    // vendor-charts left this list in T3.5, and that is the win rather than a
    // regression: d3-geo was the dashboard's only path into the recharts
    // subgraph, so splitting vendor-geo out took ~115 KB brotli off the home
    // route. vendor-geo is now the map-side dep whose absence would mean a
    // real waterfall.
    for (const need of ["vendor-leaflet", "vendor-geo"]) {
      expect(
        deps.find((d) => d?.includes(need)),
        `${need} dropped from the dashboard's mapDeps — home now waterfalls`,
      ).toBeTruthy();
    }
  });

  // The banned-list assertions above are all of the form "chunk X is absent",
  // so every one of them is satisfied by X simply ceasing to exist — a
  // dependency upgrade that moves CodeMirror to an unmatched path would undo
  // the split with a fully green gate. Anchor them with a positive assertion.
  test("vendor-editor exists and owns the CodeMirror family", () => {
    const files = fs.readdirSync(`${DIST_DIR}/assets`);
    const editor = files.find((f) => /^vendor-editor-.*\.js$/.test(f));
    expect(
      editor,
      "vendor-editor chunk missing — the manualChunks rule stopped matching",
    ).toBeTruthy();
    const owners = files.filter(
      (f) =>
        f.endsWith(".js") &&
        fs
          .readFileSync(`${DIST_DIR}/assets/${f}`, "utf8")
          .includes("cm-editor"),
    );
    expect(owners).toEqual([editor]);
  });

  test("catch-all vendor does not import a route-only chunk (cycle guard)", () => {
    const file = fs
      .readdirSync(`${DIST_DIR}/assets`)
      .find(
        (f) =>
          /^vendor-[A-Za-z0-9_-]+\.js$/.test(f) && !/^vendor-[a-z]+-/.test(f),
      );
    expect(
      file,
      "catch-all vendor chunk not found — run `npm run build`",
    ).toBeTruthy();
    // vendor-editor / -charts / -pdf all statically import `vendor`. If
    // `vendor` imports one of them back, the split becomes a cycle and
    // surfaces in production as "Cannot access 'X' before initialization".
    // Only the foundational vendor-react may appear here.
    expect(
      staticImportsOf(file!).filter((i) => !i.startsWith("vendor-react")),
    ).toEqual([]);
  });

  // The whole point of splitting d3-geo out of vendor-charts is that a
  // geo-only route (every map and choropleth) stops downloading recharts for
  // three projection functions. Two assertions pin that down, and both have to
  // hold or the split silently saves nothing:
  //   1. vendor-geo is a LEAF. An edge to vendor-charts would mean the map
  //      route pulls recharts anyway — and the existing cycle guards below
  //      only cover the entry and the catch-all, so they would not see it.
  //   2. vendor-charts imports vendor-geo. This is what proves d3-array moved
  //      across with d3-geo: victory-vendor re-exports d3-array rather than
  //      inlining it, so if d3-array had stayed behind the edge would point
  //      the other way.
  test("vendor-geo is a leaf and vendor-charts depends on it, not vice versa", () => {
    const files = fs.readdirSync(`${DIST_DIR}/assets`);
    const geo = files.find((f) => /^vendor-geo-.*\.js$/.test(f));
    const charts = files.find((f) => /^vendor-charts-.*\.js$/.test(f));
    expect(
      geo,
      "vendor-geo chunk missing — the split stopped matching",
    ).toBeTruthy();
    expect(charts, "vendor-charts chunk missing").toBeTruthy();
    // Assert the invariant that costs bytes, not "imports nothing". vendor-geo
    // happens to be a true leaf today only because internmap is tree-shaken out
    // of d3-array's reachable subgraph; a d3-array upgrade that makes
    // group/rollup live would add a vendor-geo -> vendor edge that is entirely
    // harmless (vendor is always loaded, and vendor-editor has the same edge).
    // An edge to vendor-charts is the one that would undo the whole saving.
    expect(
      staticImportsOf(geo!).filter((i) => !i.startsWith("vendor-")),
      "vendor-geo gained an edge outside the vendor chunks",
    ).toEqual([]);
    expect(
      staticImportsOf(geo!).find((i) => i.startsWith("vendor-charts")),
      "vendor-geo imports vendor-charts — every map route downloads recharts again",
    ).toBeUndefined();
    expect(
      staticImportsOf(charts!).find((i) => i.startsWith("vendor-geo")),
      "vendor-charts no longer imports vendor-geo — d3-array probably drifted back out of vendor-geo",
    ).toBeTruthy();
  });

  // The assertions above prove the SHAPE of the split. This proves the PAYOFF:
  // the app's own geo helper chunk reaches vendor-geo without reaching
  // vendor-charts anywhere in its transitive static closure. FINDING-001 of the
  // T3.5 review is the argument for this layer — the change's one real
  // consequence surfaced in the dependency lists, not in the chunk graph.
  test("a geo-only chunk never reaches vendor-charts", () => {
    const files = fs.readdirSync(`${DIST_DIR}/assets`);
    const seed = files.find((f) => /^d3_utils-.*\.js$/.test(f));
    expect(
      seed,
      "d3_utils chunk missing — the geo helpers stopped being split out",
    ).toBeTruthy();

    const seen = new Set<string>();
    const stack = [seed!];
    while (stack.length) {
      for (const dep of staticImportsOf(stack.pop()!)) {
        if (!seen.has(dep)) {
          seen.add(dep);
          stack.push(dep);
        }
      }
    }
    const closure = [...seen];
    expect(
      closure.find((f) => f.startsWith("vendor-geo")),
      "d3_utils no longer reaches vendor-geo — the split stopped matching",
    ).toBeTruthy();
    expect(
      closure.find((f) => f.startsWith("vendor-charts")),
      `a geo-only chunk reaches vendor-charts (~115 KB brotli): ${closure.join(", ")}`,
    ).toBeUndefined();
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
