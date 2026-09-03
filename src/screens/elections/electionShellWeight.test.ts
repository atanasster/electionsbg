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

/** Measured 2026-09-03 at 7,891 B br (30,267 B raw), +5%. A ratchet, not a ceiling to grow
 *  into: failing means "justify or split", never "raise the number". */
const SHELL_BUDGET_BR = 8_300;

const measure = async (entry: string) => {
  const r = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    external: EXTERNAL,
    loader: { ".json": "json" },
    alias: { "@": path.resolve(process.cwd(), "src") },
    logLevel: "silent",
  });
  return brotliCompressSync(r.outputFiles[0].contents, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
};

describe("the shell's own weight", () => {
  it("stays inside its brotli budget", { timeout: 60_000 }, async () => {
    const br = await measure("src/screens/elections/ElectionResultsShell.tsx");
    expect(br, `the shell grew to ${br} B brotli`).toBeLessThanOrEqual(
      SHELL_BUDGET_BR,
    );
    // Recorded against §10.1's total, as item 4 asks: ~2.2% of the critical path today.
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
