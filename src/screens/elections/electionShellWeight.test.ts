// @vitest-environment node
//
// ⚠ NODE, NOT jsdom. esbuild relies on synchronous callbacks that jsdom breaks, and the
// failure is a hard "your JavaScript environment is broken" at import time rather than a
// wrong number — so this pragma is load-bearing, not tidiness.
// What the migration COSTS, in the unit the CDN serves (Phase 2 item 4).
//
// ⚠ IT CANNOT BE MEASURED FROM `dist/` YET, and that is why this gate exists here rather than
// in `tests/perf.spec.ts`. Phase 2's exit criterion is that every production page still renders
// its legacy composition, so no route imports the shell and Rollup tree-shakes it out of the
// build entirely — a byte budget over `dist/` would report 0 B and keep reporting 0 B right up
// until Phase 4 wires ~15 screens at once, which is the moment it is too late to be told.
//
// So the shell's own closure is bundled here and compressed at brotli q11, the same unit and
// quality `tests/perf.spec.ts` uses: Firebase serves `content-encoding: br`, and gzip figures —
// what Vite's build log reports — run ~27% higher and must never be compared against these.
//
// ⚠ THE EXTERNALS ARE THE POINT OF THE NUMBER. React, i18next, React Query and the router are
// on every one of those pages already, so bundling them in would report the shell at roughly
// ten times its own weight and make the figure useless for the decision it exists to inform.
// What is measured is the code that is NEW on a migrated screen.

import { describe, expect, it } from "vitest";
import * as esbuild from "esbuild";
import { brotliCompressSync, constants } from "node:zlib";
import path from "node:path";

/** The libraries a migrated screen already loads. */
const EXTERNAL = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-i18next",
  "i18next",
  "@tanstack/react-query",
  "react-router-dom",
];

/** §10.1's critical-path total, restated here only as the denominator for the ratio below —
 *  `tests/perf.spec.ts` owns the budget itself. */
const CRITICAL_PATH_BR = 363_000;

/** Measured 2026-09-03 at **9,634 B br** — the entry chunk plus its static closure, with every
 *  map adapter deferred behind `import()` and correctly excluded.
 *
 *  ⚠ IT MOVED FROM 8,914 IN THIS PHASE AND THE GROWTH IS ACCOUNTED FOR, not absorbed. The
 *  largest input is `electionSurfaceDescriptors.ts` at 7,988 B, which gained `ballotMapMeta` —
 *  the map rule all three producers now read instead of restating — and the shell threads a
 *  `placeId` through the canvas so an adapter draws the surface's place rather than the
 *  router's. Verified by listing the closure: no map library, no data hook beyond the label
 *  resolvers. "Justify or split" is the rule, and this is the justification.
 *
 *  ⚠ IT WAS 7,891 UNDER A DIFFERENT MEASUREMENT and the two are not comparable: that figure was
 *  taken with the adapter registry EMPTY and no code splitting, so it was the shell's whole
 *  closure in one bundle. Registering the first real adapter is what forced splitting into the
 *  measurement, and the delta is shared code moving into a chunk the entry imports — not growth.
 *
 *  A ratchet, not a ceiling to grow into: failing means "justify or split", never "raise the
 *  number". +5%.
 *
 *  ⚠ RAISED ONCE, 10,100 → 10,200, FOR A CORRECTNESS FIX AND WITH THE JUSTIFICATION THE RULE
 *  ASKS FOR. `factLabel` in the shell is what makes a fact's `labelParams` reach its label;
 *  without it the strip rendered „Първи · 106" with the party silently dropped on all 62
 *  `labelParams`-bearing facts in the corpus — a true number whose referent the adjacent table
 *  then supplied falsely. Measured after: 10,139 B. The alternative — dropping the `winner` fact
 *  from `buildCountrySurface` — removes a real figure to save 39 bytes, which is the wrong trade.
 *  Splitting was considered and rejected: the helper is nine lines and reads the same label
 *  resolver the ranked rows already import, so a separate chunk would add a request to defer
 *  nothing. */
const SHELL_BUDGET_BR = 10_200;

/** ⚠ `splitting: true`, AND IT IS THE WHOLE MEASUREMENT. Without it esbuild inlines every
 *  `import()` into one bundle, so the moment a real map adapter was registered the "shell's own
 *  weight" became the shell PLUS Leaflet, d3 and their CSS — which is the opposite of the number
 *  this file exists to report, and it failed loudly rather than quietly only because Leaflet
 *  ships CSS that needs a loader. Splitting models what Rollup does in the real build: the entry
 *  chunk is what a migrated screen downloads, and each adapter is a chunk fetched on demand.
 *
 *  The non-JS loaders are `empty` for the same reason: Vite extracts CSS and assets into their
 *  own files, so counting them as JS bytes would measure something no browser parses. */
const measure = async (entry: string) => {
  const r = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    splitting: true,
    outdir: "out",
    write: false,
    metafile: true,
    external: EXTERNAL,
    loader: {
      ".json": "json",
      ".css": "empty",
      ".png": "empty",
      ".svg": "empty",
      ".webp": "empty",
    },
    alias: { "@": path.resolve(process.cwd(), "src") },
    logLevel: "silent",
  });
  // ⚠ THE ENTRY CHUNK PLUS WHAT IT STATICALLY IMPORTS, and never `outputFiles[0]`. With
  // splitting on, esbuild emits the entry, one chunk per lazily-imported adapter, and shared
  // chunks between them — so the entry ALONE under-reports (shared code has moved out of it)
  // while the sum of every output over-reports by the whole map adapter. What a migrated screen
  // actually downloads before it draws a map is the entry and its STATIC closure, which is what
  // the metafile's `import-statement` edges name. A `dynamic-import` edge is the thing the lazy
  // boundary exists to defer and is deliberately not counted.
  const meta = r.metafile!;
  const entryPath = Object.keys(meta.outputs).find(
    (o) => meta.outputs[o].entryPoint === entry,
  )!;
  const wanted = new Set<string>([entryPath]);
  for (const imp of meta.outputs[entryPath].imports)
    if (imp.kind === "import-statement") wanted.add(imp.path);
  const bytes = r.outputFiles
    .filter((f) => wanted.has(path.relative(process.cwd(), f.path)))
    .reduce(
      (sum, f) =>
        sum +
        brotliCompressSync(f.contents, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length,
      0,
    );
  return bytes;
};

describe("the shell's own weight", () => {
  it("stays inside its brotli budget", { timeout: 60_000 }, async () => {
    const br = await measure("src/screens/elections/ElectionResultsShell.tsx");
    expect(br, `the shell grew to ${br} B brotli`).toBeLessThanOrEqual(
      SHELL_BUDGET_BR,
    );
    // Recorded against §10.1's total, as item 4 asks: ~2.5% of the critical path today.
    expect(br / CRITICAL_PATH_BR).toBeLessThan(0.03);
  });

  it("is not measuring an empty bundle", { timeout: 60_000 }, async () => {
    // ⚠ ANTI-VACUITY, and this suite's own §0c/A1 shape: every assertion above is an upper
    // bound, so a failed resolve, a bad alias or an entry point that stopped existing reports a
    // spectacular improvement rather than an error.
    const br = await measure("src/screens/elections/ElectionResultsShell.tsx");
    expect(br).toBeGreaterThan(4_000);
  });

  it(
    "keeps the map slot out of the shell's own bytes",
    { timeout: 60_000 },
    async () => {
      // The lazy indirection is only worth its complexity if the adapters really are absent from
      // this bundle. `ElectionMapPanel`'s own closure is a few hundred bytes of Suspense wiring;
      // a static adapter reference would put a map library — tens of KB — inside it.
      const br = await measure("src/screens/elections/ElectionMapPanel.tsx");
      expect(br, `the map panel grew to ${br} B brotli`).toBeLessThanOrEqual(
        2_000,
      );
    },
  );
});
