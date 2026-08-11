import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
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

// Every chunk that must never reach the critical path. ONE list, three gates:
// the modulepreload hint, the actual request log, and the entry's static import
// header. Keeping them in lockstep is the whole point — §0c/A1 was two gates
// where only one was telling the truth, and before this was hoisted the three
// copies had already drifted (vendor-flow was missing from the hint gate).
const HEAVY_VENDOR_CHUNKS = [
  "vendor-pdf",
  "vendor-charts",
  "vendor-leaflet",
  "vendor-markdown",
  "vendor-editor",
  "vendor-flow",
] as const;

// App-owned heavy chunks. Not named vendor-*, so the entry-static ratchet —
// which matches on chunk-name prefixes — does not use them.
const HEAVY_APP_CHUNKS = ["exportToPDF-"] as const;

// The entry chunk's filename, from the built HTML. Throws rather than
// returning undefined so a missing build fails at the lookup with an
// actionable message instead of somewhere downstream.
const entryChunk = (html: string): string => {
  const match = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!match) {
    throw new Error(
      `no entry chunk in ${DIST_DIR}/index.html — run \`npm run build\` first`,
    );
  }
  return match[0].replace("assets/", "");
};

// The catch-all `vendor` chunk — the one with no second name segment, as
// opposed to vendor-react / vendor-charts / vendor-geo and friends.
const catchAllVendorChunk = (): string | undefined =>
  fs
    .readdirSync(`${DIST_DIR}/assets`)
    .find(
      (f) =>
        /^vendor-[A-Za-z0-9_-]+\.js$/.test(f) && !/^vendor-[a-z]+-/.test(f),
    );

// Requests issued while loading a path. `networkidle` is a floor, not a
// ceiling: it cannot resolve before the entry → route-chunk → locale-bundle
// chain (there is no idle gap in it), but a chunk imported from a timer or a
// data-arrival effect lands after it and would not be seen. The entry-static
// ratchet covers that side.
const requestsFor = async (page: Page, path: string): Promise<string[]> => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.goto(path, { waitUntil: "networkidle" });
  return requested;
};

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
    for (const banned of [...HEAVY_VENDOR_CHUNKS, ...HEAVY_APP_CHUNKS]) {
      expect(
        preloads.find((p) => p.includes(banned)),
        `unexpected modulepreload: ${banned}`,
      ).toBeUndefined();
    }
  });

  // The load-level counterpart to the hint-level test above, and the reason
  // this file exists in its current shape: the preload-list assertion stayed
  // green for months while vendor-pdf was a static import of the entry and was
  // downloaded on every page load (docs/plans/bundle-critical-path-v1.md
  // §0c/A1). Assert what the browser actually requests.
  //
  // /procurement/settlement/10135 is the right probe: it renders KPI cards and
  // a table — no chart, no map, no editor, no PDF export — so every chunk below
  // would be pure waste. Its own route payload is ~5 KB.
  //
  // The /api/db call is stubbed: the hosting emulator runs with
  // `--only hosting:main`, and it does NOT 404 an un-emulated function rewrite,
  // it proxies to the DEPLOYED function. Left live, a bundle gate would depend
  // on production availability and an ~11 s cold start against a 30 s test
  // timeout. Stubbing also makes the page take the populated render path this
  // comment describes rather than the empty-state branch.
  test("a chart-free, map-free route downloads none of the heavy chunks", async ({
    page,
  }) => {
    await page.route("**/api/db/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: "Варна",
          province: "Варна",
          obshtina: "Варна",
          ekatte: "10135",
          totalEur: 1_000_000,
          contractCount: 10,
          awarders: [
            {
              eik: "000093442",
              name: "ОБЩИНА ВАРНА",
              tier: "municipal",
              totalEur: 1_000_000,
              contractCount: 10,
            },
          ],
          topContracts: [],
          byYear: [],
        }),
      }),
    );
    const requested = await requestsFor(page, "/procurement/settlement/10135");
    // Positive anchor. Every assertion below is "chunk X is absent", and an
    // empty request log satisfies all of them — a route that 404s, throws
    // before its lazy import, or never boots would otherwise turn this gate
    // from "the route is lean" into "the route is dead", silently.
    expect(
      requested.find((u) => u.includes("ProcurementSettlementDetailScreen-")),
      `the route chunk was never requested — the page did not render, so the ` +
        `absence assertions below would pass vacuously:\n${requested.join("\n")}`,
    ).toBeTruthy();
    // vendor-geo is included here but NOT in the entry-static ratchet: it is a
    // legitimate dashboard mapDeps entry, which the home-dashboard test asserts
    // is present.
    for (const banned of [
      ...HEAVY_VENDOR_CHUNKS,
      ...HEAVY_APP_CHUNKS,
      "vendor-geo",
    ]) {
      expect(
        requested.find((u) => u.includes(banned)),
        `downloaded ${banned} on a route that renders neither a chart nor a map:\n${requested
          .filter((u) => u.includes("/assets/"))
          .join("\n")}`,
      ).toBeUndefined();
    }
  });

  // Exactly one locale bundle may be fetched. Two means the runtime hint and
  // detectLanguage() disagree — the cohort bug T4's review caught, where a
  // visitor downloads one language's corpus and then serially fetches the
  // other. Zero means the corpus was re-inlined into the entry.
  //
  // Pairs with "the locale preload hint offers both translation chunks" below:
  // that one proves the hint SHIPS, this one proves it AGREES with
  // detectLanguage(). Deleting either leaves the serial-hop regression — one
  // bundle, fetched after the entry executes — uncovered.
  test("a page load fetches exactly one translation bundle", async ({
    page,
  }) => {
    const requested = await requestsFor(page, "/");
    const locales = requested.filter((u) => /\/assets\/translation-/.test(u));
    expect(
      new Set(locales).size,
      `expected 1 translation bundle, got:\n${[...new Set(locales)].join("\n")}`,
    ).toBe(1);
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
    const imports = staticImportsOf(entryChunk(html));
    // Ratchet only — never weaken. vendor-charts and vendor-leaflet joined the
    // list when the home dashboard stopped being an eager import (T2.1); they
    // were static imports of the entry before that, so a regression here means
    // some module reachable from main.tsx without a lazy() boundary pulled the
    // map or chart stack back in.
    for (const banned of HEAVY_VENDOR_CHUNKS) {
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
    const imports = staticImportsOf(entryChunk(html));
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
    const code = fs.readFileSync(
      `${DIST_DIR}/assets/${entryChunk(html)}`,
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
    const file = catchAllVendorChunk();
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

  // Byte budgets, in BROTLI. Firebase Hosting serves `content-encoding: br`
  // (verified against production), so brotli is the right unit — gzip figures,
  // which is what Vite's build log and `gzip -9` report, run ~27% higher and
  // must never be compared against these numbers.
  //
  // Quality is pinned at 11. That is NOT what a CDN compresses at on the fly
  // (measured: q5 is +14.2% over q11 on this asset set), so these figures are a
  // deterministic LOWER BOUND on wire bytes rather than the served size. That
  // is exactly what a ratchet needs: q11 is monotone in content, so a chunk
  // that grows always trips it. Pinned rather than left to Node's default so a
  // runtime upgrade cannot move every budget at once.
  //
  // A ratchet, not a ceiling to grow into: set to the measured output plus ~5%
  // when the critical-path work landed. Failing means "justify or split", not
  // "raise the number".
  test("critical-path chunks stay within their brotli budgets", async () => {
    // ~3-4 s of compression, and playwright.config sets no top-level timeout,
    // so the 30 s default would be the only headroom.
    test.setTimeout(60_000);
    const sizes = new Map<string, number>();
    const br = (file: string) => {
      const cached = sizes.get(file);
      if (cached !== undefined) return cached;
      const n = brotliCompressSync(
        fs.readFileSync(`${DIST_DIR}/assets/${file}`),
        { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } },
      ).length;
      sizes.set(file, n);
      return n;
    };
    const html = fs.readFileSync(`${DIST_DIR}/index.html`, "utf8");
    // Scoped to <link> tags, matching the other scrapes in this file. A bare
    // href= scan would also catch anything a future inline script embeds — the
    // locale hint already contains two /assets/translation-*.js hrefs, and it
    // is only luck of codegen (`l.href=e?"…"`) that they do not match today.
    const assets = [...html.matchAll(/<link[^>]+href="\/assets\/([^"]+)"/g)]
      .map((m) => m[1])
      .filter((f) => /\.(js|css)$/.test(f));
    const entry = entryChunk(html);

    // Anchor: the sum below is over a scraped set, so an empty or truncated
    // scrape reports a huge "improvement" at the moment the shell got slower —
    // the §0c/A1 shape again. Six modulepreloads plus one stylesheet today.
    expect(
      assets.length,
      `expected the shell's preloaded assets, scraped ${assets.length}: ${assets.join(", ")}`,
    ).toBeGreaterThanOrEqual(6);

    // The entry plus everything the HTML tells the browser to fetch up front.
    // Was 752,684 B br before this work, and a further 286,940 B arrived one
    // hop later — that second wave is now empty, nothing heavy being a static
    // import of the entry any more.
    const critical = [entry, ...assets].reduce((sum, f) => sum + br(f), 0);
    expect(
      critical,
      `entry + preloaded assets grew to ${critical} B brotli`,
    ).toBeLessThanOrEqual(377_000);

    expect(br(entry), "entry chunk").toBeLessThanOrEqual(71_000);

    // The catch-all vendor chunk. The plan's aspirational 100 KB target was NOT
    // met — CodeMirror leaving in T1.2 took it from 246 KB to 125 KB, and what
    // remains (lucide-react, tailwind-merge, react-ga4, @babel/runtime and the
    // long tail of unsplit deps) has no single dominant member left to extract.
    // Budgeted at the measured value rather than at the wish.
    const vendor = catchAllVendorChunk();
    expect(vendor, "catch-all vendor chunk not found").toBeTruthy();
    expect(br(vendor!), "catch-all vendor chunk").toBeLessThanOrEqual(131_000);

    // Per-language, not one shared ceiling — a shared one sized for Bulgarian
    // would leave English ~16% of slack, so the stated +5% policy would hold
    // for one language only. Exactly one of these is ever fetched, in parallel
    // with the entry.
    //
    // Re-ratcheted 2026-08-08 from 177_000 / 161_000, which both went ~0.45%
    // over. This is the one budget in this test that does NOT measure chunk
    // composition — it measures a translation corpus that grows with every
    // feature, so it burns headroom on a schedule the others do not. The +5%
    // set on 2026-07-29 was gone in ten days; the 38 keys that finally crossed
    // it (Interreg, the /funds bands, the НКИД risk flags, the
    // person-unavailable view) are all real strings, no regression, and nothing
    // that can be split out of the chunk. Measured at the commit that moved
    // these: bg 177_837, en 161_690.
    //
    // Note EN tripped at the same time but one commit later than BG, so a run
    // that only reports Bulgarian is not evidence English has room.
    //
    // A third bump is the wrong answer. bg is 947 KB raw and every page loads
    // all of it; the lever is an i18next namespace split so a screen pulls only
    // the strings it uses. Do that instead of widening this again.
    const LOCALE_BUDGETS: Record<string, number> = {
      bg: 186_000,
      en: 169_000,
    };
    const locales = fs
      .readdirSync(`${DIST_DIR}/assets`)
      .filter((f) => /^translation-.*\.js$/.test(f));
    // Anchor: without this the loop below asserts nothing whenever the corpora
    // are not chunked — which is precisely the T4 re-inlining regression, and
    // is the state a pre-T4 dist/ is in.
    expect(
      locales.length,
      `expected one translation chunk per language, found ${locales.length}: ${locales.join(", ")}`,
    ).toBe(Object.keys(LOCALE_BUDGETS).length);
    // Identify each by content rather than by hash, which changes every build.
    for (const f of locales) {
      const isBg = fs
        .readFileSync(`${DIST_DIR}/assets/${f}`, "utf8")
        .includes("Избори");
      const lang = isBg ? "bg" : "en";
      expect(br(f), `${lang} locale bundle`).toBeLessThanOrEqual(
        LOCALE_BUDGETS[lang],
      );
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

// The data preload hints (scripts/prerender/dataPreload.ts) are only useful if
// their href is the origin the bundle actually fetches. That is a BUILD-TIME
// coupling between two independent env resolutions — `vite build`'s and the
// prerender's — and when they disagree nothing fails: the hints just point at
// the hosting origin, which answers `/macro.json` with the SPA shell at 200.
//
// The unit test in scripts/prerender/dataPreload.test.ts cannot see this,
// because it supplies the base itself as a constant. This is the only gate that
// compares the emitted href against the base Vite inlined into the entry chunk.
test.describe("data preload hints", () => {
  const ECONOMY_HTML = `${DIST_DIR}/indicators/economy/index.html`;

  const hintsIn = (html: string): string[] =>
    [
      ...html.matchAll(/<link rel="preload" as="fetch"[^>]+href="([^"]+)"/g),
    ].map((m) => m[1]);

  test("the economy page declares its data hints", () => {
    const hints = hintsIn(fs.readFileSync(ECONOMY_HTML, "utf8"));
    expect(hints.length, "no data preload hints in the economy page").toBe(4);
    for (const h of hints) {
      // A hint the browser cannot reuse is worse than no hint: as="fetch"
      // without crossorigin is a different CORS mode than fetch() uses, so the
      // response is discarded and the file downloaded twice.
      expect(h).toMatch(/\.json$/);
    }
    const html = fs.readFileSync(ECONOMY_HTML, "utf8");
    expect(html).toContain('as="fetch" crossorigin fetchpriority="low"');
  });

  test("hint origins match the base inlined in the built bundle", () => {
    const html = fs.readFileSync(ECONOMY_HTML, "utf8");
    const entry = html.match(
      /src="\/assets\/(index-[A-Za-z0-9._-]+\.js)"/,
    )?.[1];
    expect(
      entry,
      "could not locate the entry chunk from the shell",
    ).toBeTruthy();
    const js = fs.readFileSync(`${DIST_DIR}/assets/${entry}`, "utf8");

    for (const href of hintsIn(html)) {
      const origin = new URL(href, "https://electionsbg.com").origin;
      expect(
        js.includes(origin) || origin === "https://electionsbg.com",
        `preload origin ${origin} is absent from the bundle — the prerender ` +
          `and \`vite build\` resolved different env modes, so every hint ` +
          `misses the fetch it is meant to warm`,
      ).toBe(true);
    }
  });
});
