import { describe, expect, it } from "vitest";
import { CAPTIONS, CAPTION_KEYS, captionFor } from "./captions";
import type { FlyoverWorld } from "./types";
import { TEST_WORLD } from "./testWorld";

describe("the caption table", () => {
  it("emits a LITERAL key for every id, and the declared list is exactly those keys", () => {
    // ⚠️ A built template — `flyover_${id}` — makes i18n's key-usage scan treat the whole
    // family as reachable, after which `npm run i18n:prune` can no longer tell a live key from
    // a dead one and the bundle splitter cannot place any of them.
    const emitted = Object.keys(CAPTIONS)
      .map((id) => captionFor(id, TEST_WORLD)!.key)
      .sort();
    expect(emitted).toEqual([...CAPTION_KEYS].sort());
    expect(new Set(emitted).size).toBe(emitted.length);
    for (const key of emitted) expect(key).toMatch(/^flyover_caption_[a-z_]+$/);
  });

  it("returns no Cyrillic and no prose from any caption", () => {
    // The canvas draws city labels and nothing else; every sentence is DOM text through t().
    for (const id of Object.keys(CAPTIONS)) {
      const c = captionFor(id, TEST_WORLD)!;
      expect(JSON.stringify(c), id).not.toMatch(/[Ѐ-ӿ]/);
    }
  });

  it("gives every caption at least one number, and every number a finite value", () => {
    for (const id of Object.keys(CAPTIONS)) {
      const c = captionFor(id, TEST_WORLD)!;
      const values = Object.values(c.params);
      expect(values.length, id).toBeGreaterThan(0);
      for (const v of values) {
        if (typeof v === "number")
          expect(Number.isFinite(v), `${id}`).toBe(true);
      }
    }
  });

  it("reads its figures from the artifact rather than recomputing them", () => {
    // The data gate recounts `figures` against Postgres; a caption that derived its own
    // statistic would publish a number nothing checks.
    expect(captionFor("arcs_into_sofia", TEST_WORLD)!.params.pct).toBeCloseTo(
      31.1,
      1,
    );
    expect(captionFor("arcs_top_flow", TEST_WORLD)!.params).toEqual({
      from: "PDV",
      to: "SOF",
      eurM: 1116,
    });
    expect(captionFor("columns_proc", TEST_WORLD)!.params.contracts).toBe(
      407392,
    );
  });

  it("says NOTHING about prices rather than publishing a baseline nobody measured", () => {
    // ⚠️ The index is „100 = 2 January 2026", so a default of 100 is not a placeholder — it is
    // the measurement „the national basket is exactly at the changeover baseline", about a
    // corpus that is not there. Refusing is the only honest fallback, and `captionFor` already
    // returns null for an unknown id, so every host already handles it.
    const bare = structuredClone(TEST_WORLD) as FlyoverWorld;
    delete bare.prices;
    expect(captionFor("tour_prices", bare)).toBeNull();
    // …and with prices present it still says the real thing.
    expect(captionFor("tour_prices", TEST_WORLD)!.params.national).toBe(98);
  });

  it("emits no NaN for a corpus with no flows", () => {
    // An empty corpus is reachable — a fresh clone, a database mid-reload — and a NaN
    // interpolated through `t()` renders as the literal string „NaN" beside a euro figure.
    const empty = structuredClone(TEST_WORLD) as FlyoverWorld;
    empty.flows.coverage.totalEur = 0;
    empty.flows.coverage.bothPlacedEur = 0;
    empty.figures.fundsTotalEur = 0;
    empty.figures.fundsPlacedEur = 0;
    for (const id of Object.keys(CAPTIONS)) {
      const c = captionFor(id, empty);
      if (!c) continue;
      for (const v of Object.values(c.params)) {
        if (typeof v === "number") expect(Number.isFinite(v), id).toBe(true);
      }
    }
  });

  it("declares every caption's basis, so a number cannot travel alone", () => {
    // Plan §2.7: „every caption names its basis … a number without its basis is a defect".
    // The two partial corpora are the ones a reader can be misled by, so each must carry its
    // denominator in the SAME params object rather than in a translator's memory.
    expect(
      Object.keys(captionFor("columns_funds", TEST_WORLD)!.params),
    ).toEqual(expect.arrayContaining(["placedBn", "totalBn", "placedPct"]));
    expect(
      Object.keys(captionFor("arcs_coverage", TEST_WORLD)!.params),
    ).toEqual(expect.arrayContaining(["placedBn", "totalBn", "placedPct"]));
    expect(Object.keys(captionFor("tour_goes", TEST_WORLD)!.params)).toContain(
      "placedPct",
    );
    expect(Object.keys(captionFor("tour_funds", TEST_WORLD)!.params)).toEqual(
      expect.arrayContaining(["placedBn", "totalBn"]),
    );
  });

  it("never sums two money layers, in any combination", () => {
    // Three taps over overlapping corpora — an ИСУН-funded contract is in fund_projects AND
    // in contracts — so every one of these sums is a quantity with no name.
    const { procTotalEur, fundsTotalEur, fundsPlacedEur, agriTotalEur } =
      TEST_WORLD.figures;
    const forbidden = [
      procTotalEur + agriTotalEur,
      procTotalEur + fundsTotalEur,
      procTotalEur + fundsPlacedEur,
      fundsTotalEur + agriTotalEur,
      fundsPlacedEur + agriTotalEur,
      procTotalEur + fundsTotalEur + agriTotalEur,
      procTotalEur + fundsPlacedEur + agriTotalEur,
    ].map((eur) => Math.round(eur / 1e8) / 10);
    for (const id of Object.keys(CAPTIONS)) {
      const c = captionFor(id, TEST_WORLD);
      if (!c) continue;
      for (const v of Object.values(c.params)) {
        if (typeof v !== "number") continue;
        for (const bad of forbidden) {
          expect(Math.abs(v - bad), `${id} = ${v}`).toBeGreaterThan(0.5);
        }
      }
    }
  });
});
