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
 *  ⚠ RAISED TWICE IN ONE RUN, 10,100 → 10,200 → 10,300, AND THIS COMMENT SAID OTHERWISE.
 *  An earlier version of it claimed the raise was made once "covering two correctness fixes
 *  made together", and described raising the number once per fix as the thing it had avoided.
 *  The repository says otherwise: `2af130a202` shipped 10,200 for `factLabel`, and the column
 *  narrowing then took it to 10,300 in the very next commit. A ratchet whose comment
 *  misdescribes its own history is worse than one with no comment, because the next person
 *  reads it as precedent — so the history is recorded as it happened.
 *
 *  What the two bought, both being the shell rendering something FALSE rather than something
 *  large, and both surfaced by switching the local levels on:
 *
 *    `factLabel`         makes a fact's `labelParams` reach its label. Without it the strip
 *                        rendered „Първи · 106" with the party silently dropped on all 62
 *                        `labelParams`-bearing facts in the corpus — a true number whose
 *                        referent the adjacent council table then supplied falsely.
 *    `ballotFillsColumn` narrows a level's declared columns to what THIS ballot fills.
 *                        `rankedColumns` is per level and `local/municipality` carries two
 *                        ballots; measured, all 289 published municipality surfaces printed
 *                        „Тур" and „Избран" as headers over blank columns on the council table.
 *
 *  Measured after both: 10,224 B. Splitting was considered and rejected — together the two
 *  helpers are ~30 lines, one reading the label resolver the ranked rows already import, so a
 *  separate chunk would add a request to defer nothing.
 *
 *  ⚠ THE HEADROOM IS NOW 0.7%, AGAINST THE +5% THIS FILE SETS AS ITS OWN CONVENTION. That is
 *  deliberate and it is the point of a ratchet: the next change to this file gets ~76 bytes
 *  before it has to make the same argument in public. It is not an invitation to round up.
 *
 *  **10,300 → 10,440 (measured 10,364), 2026-09-06 — a THIRD `ElectionKind`.** The shell
 *  imports the kind × level descriptor matrix, so a presidential column is ~140 B brotli of
 *  DATA: six level entries declaring which ballot is active, what each map asks, which facts
 *  the strip may show and which sections follow. Nothing executable was added.
 *
 *  Deferring it was considered and rejected. The shell selects its descriptor by `kind` at
 *  render time, so splitting the matrix per kind means a dynamic import on the render path to
 *  save ~140 B — one request to defer a third of a pure-data table, on a page that has already
 *  decided which election it is about. The alternative that WOULD pay is dropping levels from
 *  the presidential column, and every one of the six is a route this plan ships.
 *
 *  **10,440 → 11,130 (measured 11,053), 2026-09-07 — the ranked result renders the party tile's
 *  own presentation again.** `/parliamentary` had led with a plain table ever since the canvas
 *  replaced `PartyResultsTile`: no party colours, no share bars, no prior-cycle column and — the
 *  substantive loss — no link from a row to that party's page. The rows carry the dot, the bar,
 *  the signed change and an anchor again, the caption is visible and offers „виж детайли", and a
 *  `delta` column joins the union for the one level whose shard can fill it. The last ~64 B of
 *  it are the phone: the table gained its own `overflow-x-auto` box and two columns dropped to
 *  `text-xs`, because at 375 px the five columns wanted 423 px in a 359 px slot and the slot
 *  clipped rather than scrolled.
 *
 *  Measured in halves, because only one of them is presentation: the schema, the producer, the
 *  descriptor and the label resolver together are **+99 B** (10,358 → 10,457, measured on an
 *  otherwise pristine HEAD tree). ⚠ THE REST IS NOT PURELY THIS CHANGE — the working tree it was
 *  measured in also carried the facts-grid extraction, a code MOVE that should be ~neutral but
 *  was not measured apart, so the shell half is an upper bound on what the rows cost.
 *
 *  ⚠ AND ONE IMPORT COST 6.6 KB BEFORE IT WAS SPLIT. `partyHref` lived in `lib/utils.ts`, whose
 *  first two lines are `clsx` and `tailwind-merge` for `cn` — so taking a three-line URL builder
 *  from there took the shell to **16,968 B** at a stroke, 63% over budget for a function that
 *  concatenates a path. The rule moved to `lib/partyHref.ts`, a leaf with no imports that
 *  `utils` re-exports, so every other call site is unchanged and there is still one definition.
 *  A budget that only ever gets raised would have absorbed that without anyone seeing it.
 *
 *  Splitting the ranked table into a chunk of its own was considered and rejected: it is the
 *  FIRST thing in the canvas's DOM and the page's primary content, so deferring it would put a
 *  request in front of the result the page exists to show.
 *
 *  **11,130 → 11,300 (measured 11,221), 2026-09-07 — a FIFTH lazy map adapter.**
 *  `local/country/winner` joins `MAP_ADAPTERS` (`LocalCountryMap`, the oblast choropleth the
 *  local country page draws instead of one line of „картата не е налична").
 *
 *  ⚠ NONE OF THE +172 B IS SHELL CODE, AND THAT IS THE THING TO KNOW BEFORE HUNTING FOR IT.
 *  The shell's own chunk moved 6,075 → 6,088 B — thirteen bytes, the two extra props on the
 *  `ElectionMapPanel` call (`cycle`, `ballot`). The rest is esbuild RE-SPLITTING the chunks
 *  shared between the entry and the lazily-imported adapters: with four adapters the shared
 *  modules landed in two chunks (3,165 + 1,386 B), with five they land in six (1,876 + 1,367 +
 *  1,268 + 247 + 229 + 179 B) — the same modules, more chunk boundaries, and a boundary is a
 *  module wrapper plus an export list that brotli cannot fold into its neighbour. Measured by
 *  removing ONLY the registry line: the gate passes without it and fails with it, and the
 *  adapter itself is never in these bytes (that is what the lazy indirection buys, and the
 *  „keeps the map slot out of the shell's own bytes" case below still holds).
 *
 *  So this raise cannot be worked off by writing the adapter differently — it is the price of
 *  the fifth entry, and the sixth will be cheaper rather than dearer, since the re-split has
 *  already happened. What WOULD work it off is the opposite of what this change is for: an
 *  unregistered level renders a permanent „not available" where its map belongs.
 *
 *  **11,300 → 11,510 (measured 11,433), 2026-09-07 — four more lazy adapters, and the
 *  prediction above held.** `local/region`, `local/municipality`, `presidential/region` and
 *  `presidential/municipality` join the registry, so every place page below the country draws
 *  the map its descriptor declares instead of „картата не е налична".
 *
 *  ⚠ +133 B FOR FOUR, against +172 B for the one before them — ~33 B each rather than ~172.
 *  That is the re-split being a ONE-TIME cost, as the entry above said it would be: the shared
 *  chunks between the entry and the lazy adapters were re-cut when the fifth adapter arrived,
 *  and the sixth through ninth pay only their own registry line. Measured by removing exactly
 *  those four entries: the gate passes without them and fails with them. Read that as the shape
 *  of the next raise too — a tenth adapter is ~30 B, not a re-argument.
 *
 *  **11,510 → 11,680 (measured 11,599), 2026-09-07 — a sixth adapter,
 *  `presidential/settlement/winner`.**
 *
 *  ⚠ +89 B, NOT THE ~30 B THE PARAGRAPH ABOVE PREDICTED, and the prediction failing is the part
 *  worth keeping. „The next one is just a registry line" holds only while the new adapter's own
 *  imports are ALREADY in the shared chunks. This is the first to reach `useSettlementVotes`
 *  and `useSettlementsInfo` — it joins the parliamentary archive's station coordinates onto
 *  presidential sections — so esbuild re-cut the shared boundary again instead of reusing it.
 *  Measured by removing exactly that entry: the gate passes without it.
 *
 *  So the rule is not „an adapter is ~30 B" but „~30 B when it shares its imports with one
 *  already registered, and a re-split otherwise". Measure rather than assume when the next
 *  adapter reaches a module no other one touches.
 */
const SHELL_BUDGET_BR = 11_680;

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
    // Recorded against §10.1's total, as item 4 asks: 3.20% of the critical path today, up from
    // ~2.5%. ⚠ THE BOUND TRACKS THE BUDGET ABOVE (11,680 / 363,000 = 3.22%) so that a change
    // which passes the byte budget cannot fail here instead — two ratchets on one number, one of
    // which nobody remembers to update, is how a gate starts failing for the wrong reason.
    expect(br / CRITICAL_PATH_BR).toBeLessThan(0.0323);
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
