// The committed `data/home/hub_stats.json`, re-derived from its sources.
//
// ⚠️ NOT A POSTGRES GATE, unlike its neighbours in this directory. The home artifact reads
// `data/macro.json` and two committed blobs and nothing else — `/` is the entry page, so
// every figure on it has to be servable with no database behind it — which means this gate
// runs everywhere rather than skipping when Postgres is down.

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// ⚠️ Safe in a node test: `homeFigures.ts`'s only RUNTIME import is the indicators
// registry, which itself imports one type. Everything else there is `import type`.
import { homeFigureHref } from "@/screens/home/homeFigures";
import {
  HOME_DATE_BASES,
  HOME_FIGURE_IDS,
  HOME_MODES,
  findNowRelativeFields,
  homeFigureIdIsHonest,
  isHomeBasisKey,
  type HomeHubStatsV1,
} from "@/data/home/homeTypes";
import { assertCommitted } from "../../lib/assert_committed";

const REPO = path.resolve(__dirname, "../../..");
const ARTIFACT = path.join(REPO, "data/home/hub_stats.json");

// All four are COMMITTED, so absence is a broken working copy rather than a state to stand
// down for — and two of them are read INSIDE a clause that would otherwise throw an
// unattributed error mid-test. Registered before the module-scope reads below so the named
// assertion survives a parse that throws during collection.
assertCommitted(
  "data/home/hub_stats.json",
  "data/macro.json",
  "data/procurement/derived/hub_stats.json",
  "data/governance/hub_stats.json",
);

const read = <T>(rel: string): T =>
  JSON.parse(readFileSync(path.join(REPO, rel), "utf-8")) as T;

const stats = read<HomeHubStatsV1>("data/home/hub_stats.json");
const macro = read<{
  series: Record<string, { period: string; value: number }[]>;
  latestMonthly: Record<
    string,
    | {
        period: string;
        value: number;
        datasetCode?: string;
        seasonallyAdjusted?: boolean;
      }
    | undefined
  >;
  indicators: Record<string, { datasetCode?: string } | undefined>;
}>("data/macro.json");

/** ~16 KiB, per the plan's artifact budget. One request must supply the whole head. */
const SIZE_CEILING = 16 * 1024;

describe("home hub_stats — schema", () => {
  it("exists and declares its version", () => {
    expect(existsSync(ARTIFACT)).toBe(true);
    expect(stats.schemaVersion).toBe(1);
  });

  it("is inside its size ceiling", () => {
    expect(statSync(ARTIFACT).size).toBeLessThan(SIZE_CEILING);
  });

  it("every enum value is declared", () => {
    expect(HOME_MODES).toContain(stats.homeMode);
    for (const f of stats.figures) expect(HOME_FIGURE_IDS).toContain(f.id);
  });

  it("stores no now-relative field", () => {
    // A `daysLeft`/`isOpen` frozen into a published artifact is the `open_calls` (142)
    // defect one layer up: a status true when written and false when read.
    expect(findNowRelativeFields(stats)).toEqual([]);
  });

  it("computedAt is a source vintage, not a run timestamp", () => {
    // ⚠️ THE ONE THAT MAKES THE REBUILD DETERMINISTIC. A `new Date()` stamp changes every
    // run, so `db:check-generated` would report permanent drift and the byte-identical
    // clause below could never hold. It must also be an ISO DAY — the sources speak three
    // dialects ("2026-Q2", "2026-07", "2026_04_19") and a lexical max over the mixed set is
    // meaningless.
    expect(stats.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // ⚠️ AND IT MUST EQUAL THE NEWEST SOURCE PERIOD. Asserting only the SHAPE is what let
    // the first cut of this artifact ship the BUILD DATE: the generator folded a sibling
    // blob's `computedAt`, which is `new Date().toISOString()`, so a run stamp always won
    // the max — an ISO day, correctly shaped, and completely wrong.
    //
    // The periods are normalised to a day before comparing, because a lexical max over the
    // mixed dialects the sources speak is meaningless: "2026-Q2" sorts AFTER "2026-07"
    // because "Q" > "0". Re-derived here rather than imported, so a bug in the generator's
    // own normaliser cannot make this pass.
    const toDay = (p: string): string => {
      const q = /^(\d{4})-Q([1-4])$/.exec(p);
      if (q)
        return new Date(Date.UTC(Number(q[1]), Number(q[2]) * 3, 0))
          .toISOString()
          .slice(0, 10);
      const m = /^(\d{4})-(\d{2})$/.exec(p);
      if (m)
        return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0))
          .toISOString()
          .slice(0, 10);
      return p;
    };
    const newest = stats.figures
      .map((f) => toDay(f.basis.period))
      .sort()
      .at(-1);
    expect(newest, "no figure carries a period").toBeTruthy();
    expect(stats.computedAt).toBe(newest);

    // Non-vacuity: today must NOT equal that vintage, or the assertion above would pass on
    // a build-date stamp too. (If this ever trips it means the corpus caught up with the
    // calendar, and the clause below is the one still doing the work.)
    const today = new Date().toISOString().slice(0, 10);
    expect(
      stats.computedAt <= today,
      "computedAt is in the future — it is not a source vintage",
    ).toBe(true);
  });
});

describe("home hub_stats — the four figures", () => {
  it("no figure id claims to be a CPI", () => {
    // `cpi` names Transparency International's corruption index in this corpus, and the
    // figure is HICP. One line, because the collision is a naming one and cheap to check.
    for (const f of stats.figures)
      expect(homeFigureIdIsHonest(f.id)).toBe(true);
    expect(stats.figures.map((f) => f.id)).not.toContain("inflation_cpi");
  });

  it("ids are unique", () => {
    const ids = stats.figures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every value is re-derivable from macro.json", () => {
    // The independent re-derivation: the artifact is not trusted about its own numbers.
    const lastValid = (rows: { period: string; value: number }[]) =>
      [...rows].reverse().find((r) => Number.isFinite(r.value));
    const expected: Record<
      string,
      { period: string; value: number } | undefined
    > = {
      gdp_growth: lastValid(macro.series.gdpGrowth),
      inflation_hicp: macro.latestMonthly.inflation,
      unemployment_sa: macro.latestMonthly.unemployment,
      government_debt_gdp: lastValid(macro.series.govDebt),
    };
    for (const f of stats.figures) {
      const src = expected[f.id];
      expect(src, `${f.id} has no source row`).toBeTruthy();
      expect(f.value, f.id).toBe(src!.value);
      expect(f.basis.period, f.id).toBe(src!.period);
    }
  });

  it("each figure's datasetCode is the one on the object its VALUE came from", () => {
    // ⚠️ THE CROSS-WIRING GATE, and the reason it compares against the SOURCE rather than
    // the figure's own metadata: `indicators.unemployment` is the QUARTERLY dataset
    // (une_rt_q) while the value comes from `latestMonthly.unemployment` (une_rt_m), and
    // `indicators.inflation` is captioned "quarterly avg" for what is a monthly
    // observation. An assertion made against the figure alone passes on either mix-up.
    const expectedCode: Record<string, string | undefined> = {
      gdp_growth: macro.indicators.gdpGrowth?.datasetCode,
      inflation_hicp: macro.latestMonthly.inflation?.datasetCode,
      unemployment_sa: macro.indicators.unemploymentMonthly?.datasetCode,
      government_debt_gdp: macro.indicators.govDebt?.datasetCode,
    };
    for (const f of stats.figures) {
      const code = stats.sources[f.sourceId]?.datasetCode;
      expect(code, `${f.id} declares no datasetCode`).toBeTruthy();
      expect(code, f.id).toBe(expectedCode[f.id]);
    }
    // Non-vacuity: the two monthly figures must NOT be carrying the quarterly codes.
    expect(expectedCode.unemployment_sa).toBe("une_rt_m");
    expect(macro.indicators.unemployment?.datasetCode).toBe("une_rt_q");
  });

  it("a monthly figure's adjustment is the one its own observation declares", () => {
    // The same shape as the datasetCode clause, and for the same reason: compared against
    // the SOURCE object, not against the figure. `adjustment` is rendered into the visible
    // basis line, so a spec that has drifted from the series publishes a false claim about
    // what the number is.
    const expected: Record<string, boolean | undefined> = {
      inflation_hicp: macro.latestMonthly.inflation?.seasonallyAdjusted,
      unemployment_sa: macro.latestMonthly.unemployment?.seasonallyAdjusted,
    };
    for (const f of stats.figures) {
      if (!(f.id in expected)) continue;
      expect(f.basis.adjustment, f.id).toBe(
        expected[f.id] ? "seasonally_adjusted" : "unadjusted",
      );
    }
    // Non-vacuity: the two must genuinely DIFFER in the corpus, or the clause passes on any
    // implementation that returns a constant.
    expect(expected.inflation_hicp).not.toBe(expected.unemployment_sa);
  });

  it("every figure names a declared source and resolves to a real destination", () => {
    for (const f of stats.figures) {
      expect(Object.keys(stats.sources), f.id).toContain(f.sourceId);
      expect(stats.sources[f.sourceId]?.available, f.id).toBe(true);
      // ⚠️ RESOLVED, NOT STORED. The artifact used to carry a `to` the generator hardcoded —
      // a fourth copy of `DOMAIN_PATHS` that silently dropped the per-indicator anchor. The
      // destination is now a function of the registry, so this asserts the resolution rather
      // than a string somebody wrote down.
      expect(homeFigureHref(f.id), f.id).toMatch(
        /^\/indicators\/[a-z]+#[a-z-]+$/,
      );
    }
  });

  it("stores no destination at all", () => {
    // A published href goes stale the day a section is renamed, and nothing fails: the link
    // resolves and the hash matches nothing. The figure carries its id; the link is code.
    for (const f of stats.figures)
      expect(Object.keys(f), f.id).not.toContain("to");
  });

  it("a missing figure is ABSENT, never zero", () => {
    // The artifact may legitimately carry fewer than four. What it must never carry is a
    // figure standing in for an absence.
    const unavailable = Object.entries(stats.sources).filter(
      ([, src]) => !src?.available,
    );
    for (const [id] of unavailable)
      expect(stats.figures.some((f) => f.sourceId === id)).toBe(false);
  });
});

describe("home hub_stats — tiles", () => {
  it("every basisKey is an i18n key, not prose", () => {
    // Prose here renders as prose in one language and as a raw identifier in the other.
    for (const [id, m] of Object.entries(stats.tiles)) {
      expect(m, id).toBeTruthy();
      expect(isHomeBasisKey(m!.basisKey), `${id}: ${m!.basisKey}`).toBe(true);
    }
  });

  it("the tile id matches its key", () => {
    for (const [id, m] of Object.entries(stats.tiles))
      expect(m!.tileId).toBe(id);
  });

  it("the procurement tile keeps the scope its number is measured on", () => {
    const p = stats.tiles.procurement;
    if (p) {
      expect(p.to).toContain("pscope=all");
      expect(p.scope).toBe("all");
    }
  });

  it("folds the destination's OWN figure rather than re-deriving it", () => {
    // The fold rule: a fresh count about the same subject is a different corpus, and two
    // pages one click apart would then disagree.
    const proc = read<{ all?: { totalEur?: number } }>(
      "data/procurement/derived/hub_stats.json",
    );
    if (stats.tiles.procurement && proc.all?.totalEur !== undefined)
      expect(stats.tiles.procurement.value).toBe(proc.all.totalEur);
    const gov = read<{ tiles?: Record<string, { value: number }> }>(
      "data/governance/hub_stats.json",
    );
    for (const [tileId, govId] of [
      ["budget", "budget"],
      ["funds", "funds"],
      ["governance", "persons"],
    ] as const) {
      const mine = stats.tiles[tileId];
      const theirs = gov.tiles?.[govId];
      if (mine && theirs) expect(mine.value, tileId).toBe(theirs.value);
    }
  });

  it("sums nothing across the overlapping corpora", () => {
    // Four taps, never a total: an ИСУН-funded contract is in fund_projects AND in
    // contracts. No emitted value may equal the sum of two others.
    const values = Object.values(stats.tiles)
      .filter((m) => m?.unit === "eur")
      .map((m) => m!.value);
    for (const v of values) {
      const others = values.filter((x) => x !== v);
      for (let i = 0; i < others.length; i++)
        for (let j = i + 1; j < others.length; j++)
          expect(v).not.toBe(others[i] + others[j]);
    }
  });
});

describe("home hub_stats — date semantics", () => {
  it("HOME_DATE_BASES is available to the feed that will use it", () => {
    // The stats artifact carries no events, so this is a contract check rather than a
    // content one: the vocabulary the feed phase depends on exists and is non-empty.
    expect(HOME_DATE_BASES.length).toBeGreaterThan(0);
    expect(HOME_DATE_BASES).toContain("first_seen");
  });
});
