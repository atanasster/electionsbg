// Guard for the carry-forward that keeps fetch_eu_peers.ts from destroying
// blocks other scripts merge into data/macro_peers.json.
//
// This exists because it already happened: re-running fetch_eu_peers.ts for an
// unrelated indicator deleted the whole `pricePli` block (24 COICOP categories
// × 9 geos), blanking /consumption/eu and reddening fetch_food_pli.test.ts —
// with a green run and no warning. fetch_food_pli.test.ts catches the symptom,
// but only after the artifact is committed, and it cannot tell "never fetched"
// from "fetched then clobbered". This holds the invariant itself.
//
//   npx vitest run scripts/macro/peers_foreign_blocks.test.ts

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FOREIGN_BLOCKS, readForeignBlocks } from "./fetch_eu_peers";

const ARTIFACT = resolve(__dirname, "../../data/macro_peers.json");

describe("readForeignBlocks", () => {
  it("carries every FOREIGN_BLOCKS key across a rewrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "peers-foreign-"));
    const file = join(dir, "macro_peers.json");
    try {
      const pricePli = { year: 2025, values: { BG: { A01: 60 } } };
      writeFileSync(
        file,
        JSON.stringify({ wgi: { series: {} }, pricePli, series: {} }),
      );
      const carried = readForeignBlocks(file);
      expect(Object.keys(carried)).toEqual(["pricePli"]);
      expect(carried.pricePli).toEqual(pricePli);
      // Spread into a fresh payload the way the writer does it.
      const payload = { series: {}, wgi: {}, ...carried };
      expect((payload as Record<string, unknown>).pricePli).toEqual(pricePli);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns {} rather than throwing on a missing or unreadable file", () => {
    // A first-ever run on a clean machine legitimately has nothing to carry,
    // and a truncated file must not abort the whole peers fetch.
    const dir = mkdtempSync(join(tmpdir(), "peers-foreign-"));
    try {
      expect(readForeignBlocks(join(dir, "nope.json"))).toEqual({});
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{ not json");
      expect(readForeignBlocks(bad)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits a listed block that is absent, rather than writing undefined", () => {
    // Spreading `{ pricePli: undefined }` would put the key back as an explicit
    // undefined and JSON.stringify would drop it — same end state, but the
    // caller's "which did I carry?" log would lie.
    const dir = mkdtempSync(join(tmpdir(), "peers-foreign-"));
    const file = join(dir, "macro_peers.json");
    try {
      writeFileSync(file, JSON.stringify({ series: {}, wgi: {} }));
      expect(readForeignBlocks(file)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("FOREIGN_BLOCKS covers the committed artifact", () => {
  // Every top-level key fetch_eu_peers.ts emits itself. Anything in the
  // committed file outside this set and outside FOREIGN_BLOCKS is a block some
  // other script merges in — and one this writer would silently destroy.
  const EMITTED = [
    "fetchedAt",
    "source",
    "geos",
    "naItems",
    "latestYear",
    "series",
    "distribution",
    "indicators",
    "indicatorsAnnual",
    "wgi",
    "degraded",
  ];

  it("lists every foreign top-level key present in data/macro_peers.json", () => {
    const raw = JSON.parse(readFileSync(ARTIFACT, "utf8")) as Record<
      string,
      unknown
    >;
    const unaccounted = Object.keys(raw).filter(
      (k) =>
        !EMITTED.includes(k) &&
        !(FOREIGN_BLOCKS as readonly string[]).includes(k),
    );
    expect(
      unaccounted,
      `these top-level keys are written by neither this writer nor a listed ` +
        `foreign block — add them to FOREIGN_BLOCKS or they will be destroyed ` +
        `on the next fetch_eu_peers.ts run`,
    ).toEqual([]);
  });

  it("still finds pricePli in the committed artifact", () => {
    // The regression this whole file exists for: pricePli must be present.
    const raw = JSON.parse(readFileSync(ARTIFACT, "utf8")) as Record<
      string,
      unknown
    >;
    expect(
      raw.pricePli,
      "pricePli missing — run fetch_food_pli.ts",
    ).toBeTruthy();
  });
});
