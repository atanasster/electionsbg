// Guard for the carry-forward that keeps fetch_eurostat.ts from destroying the
// indicators other scripts merge into data/regional.json.
//
// This exists because it already happened (2026-08-11): running
// fetch_eurostat.ts alone dropped fdiPerCapita, museumVisitsPer1000,
// hospitalBedsPer1000, deathRatePer1000 (fetch_nsi.ts) and ltUnemployment
// (fetch_az_oblast.ts) from BOTH the `indicators` and the `series` block. The
// file stayed valid, the run stayed green and nothing warned — half the oblast
// indicators /governance/region/:oblast renders were simply gone until the two
// mergers were re-run.
//
//   npx vitest run scripts/regional/regional_foreign_indicators.test.ts

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  carryReport,
  isEntryPoint,
  FOREIGN_INDICATORS,
  OWN_INDICATORS,
  readForeignIndicators,
  withCarriedIndicators,
} from "./fetch_eurostat";

const ARTIFACT = resolve(__dirname, "../../data/regional.json");

/** Indicator metadata carries six fields; spell one out and reuse it. */
const POPULATION_META = {
  titleEn: "Population (annual average)",
  titleBg: "Население (средногодишно)",
  unitLabelEn: "thousand persons",
  unitLabelBg: "хил. души",
  sourceUrl: "https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3popgdp",
  datasetCode: "nama_10r_3popgdp",
};

const meta = (datasetCode: string) => ({ ...POPULATION_META, datasetCode });

type Payload = {
  source: { name: string; url: string };
  fetchedAt: string;
  country: string;
  indicators: Record<string, typeof POPULATION_META>;
  series: Record<string, Record<string, { year: number; value: number }[]>>;
};

/** A prior regional.json holding one own indicator and one foreign one. */
const priorFile = (dir: string, extra: Record<string, unknown> = {}) => {
  const file = join(dir, "regional.json");
  writeFileSync(
    file,
    JSON.stringify({
      source: { name: "Eurostat", url: "https://ec.europa.eu/eurostat/" },
      fetchedAt: "2026-01-01T00:00:00.000Z",
      country: "BG",
      indicators: {
        population: POPULATION_META,
        ltUnemployment: {
          titleEn: "Long-term unemployed share",
          titleBg: "Дял на продължително безработните",
          unitLabelEn: "% of registered unemployed",
          unitLabelBg: "% от регистрираните безработни",
          sourceUrl: "https://www.az.government.bg/stats/4/",
          datasetCode: "az-longterm",
        },
        ...((extra.indicators as Record<string, unknown>) ?? {}),
      },
      series: {
        population: { VID: [{ year: 2023, value: 75.2 }] },
        ltUnemployment: { VID: [{ year: 2025, value: 41.3 }] },
        ...((extra.series as Record<string, unknown>) ?? {}),
      },
    }),
  );
  return file;
};

/** What a fresh Eurostat pass produces — own indicator keys only. */
const freshPayload = (): Payload => ({
  source: { name: "Eurostat", url: "https://ec.europa.eu/eurostat/" },
  fetchedAt: "2026-08-11T00:00:00.000Z",
  country: "BG",
  indicators: { population: POPULATION_META },
  series: { population: { VID: [{ year: 2024, value: 74.1 }] } },
});

const withTmpDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "regional-foreign-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the Eurostat pass preserves foreign indicators", () => {
  it("still has a foreign indicator after the write", () => {
    // The regression itself, end to end through the real write path: a prior
    // file carrying ltUnemployment, a fresh payload that knows nothing about
    // it, and the file that lands on disk.
    withTmpDir((dir) => {
      const file = priorFile(dir);
      const before = JSON.parse(readFileSync(file, "utf8"));

      const payload = withCarriedIndicators(
        freshPayload(),
        readForeignIndicators(file),
      );
      writeFileSync(file, JSON.stringify(payload));

      const after = JSON.parse(readFileSync(file, "utf8"));
      expect(Object.keys(after.indicators)).toContain("ltUnemployment");
      expect(Object.keys(after.series)).toContain("ltUnemployment");
      expect(after.indicators.ltUnemployment).toEqual(
        before.indicators.ltUnemployment,
      );
      expect(after.series.ltUnemployment).toEqual(before.series.ltUnemployment);
      // …and the fresh pass's own indicator is the NEW vintage, not the prior.
      expect(after.series.population).toEqual({
        VID: [{ year: 2024, value: 74.1 }],
      });
    });
  });

  it("carries every foreign key in FOREIGN_INDICATORS", () => {
    withTmpDir((dir) => {
      const file = priorFile(dir, {
        indicators: Object.fromEntries(
          Object.keys(FOREIGN_INDICATORS).map((k) => [k, meta(k)]),
        ),
        series: Object.fromEntries(
          Object.keys(FOREIGN_INDICATORS).map((k) => [
            k,
            { VID: [{ year: 2024, value: 1 }] },
          ]),
        ),
      });
      const carried = readForeignIndicators(file);
      expect(carried.keys.sort()).toEqual(
        Object.keys(FOREIGN_INDICATORS).sort(),
      );
      expect(carried.undeclared).toEqual([]);
      const merged = withCarriedIndicators(freshPayload(), carried);
      for (const key of Object.keys(FOREIGN_INDICATORS)) {
        expect(merged.indicators[key], `${key} indicators`).toBeTruthy();
        expect(merged.series[key], `${key} series`).toBeTruthy();
      }
    });
  });

  it("does NOT carry an own indicator the fresh pass skipped", () => {
    // enterpriseDensity degrades gracefully when Eurostat narrows bd_size_r3
    // and is deliberately omitted from the payload. Resurrecting it from the
    // prior file would turn a designed, visible degradation into a silently
    // stale series.
    withTmpDir((dir) => {
      const file = priorFile(dir, {
        indicators: { enterpriseDensity: meta("bd_size_r3") },
        series: { enterpriseDensity: { VID: [{ year: 2020, value: 48.1 }] } },
      });
      const carried = readForeignIndicators(file);
      expect(carried.keys).not.toContain("enterpriseDensity");
      const merged = withCarriedIndicators(freshPayload(), carried);
      expect(Object.keys(merged.indicators)).not.toContain("enterpriseDensity");
      expect(Object.keys(merged.series)).not.toContain("enterpriseDensity");
    });
  });

  it("lets the fresh pass win on a key collision", () => {
    // A carried entry is last run's vintage by definition, so it may only ever
    // fill a gap — never overwrite what this run just fetched. Exercises
    // withCarriedIndicators in isolation: readForeignIndicators can only ever
    // hand it FOREIGN keys, so the collision is staged on ltUnemployment as
    // though this script had started emitting it.
    const carried = {
      indicators: { ltUnemployment: meta("stale") },
      series: { ltUnemployment: { VID: [{ year: 2019, value: 1 }] } },
      keys: ["ltUnemployment"],
      undeclared: [],
    };
    const fresh = freshPayload();
    fresh.indicators.ltUnemployment = meta("az-longterm");
    fresh.series.ltUnemployment = { VID: [{ year: 2025, value: 41.3 }] };
    const merged = withCarriedIndicators(fresh, carried);
    expect(merged.indicators.ltUnemployment).toEqual(meta("az-longterm"));
    expect(merged.series.ltUnemployment).toEqual({
      VID: [{ year: 2025, value: 41.3 }],
    });
  });

  it("does not report a key whose value it could not carry", () => {
    // The whole point of the reporting is to tell a clean carry from an
    // already-lost key. A key present by NAME but holding an unusable value
    // (null, a string, an array) is lost on this write, so it must reach the
    // "re-run the owner" warning instead of being announced as carried —
    // which is the pair of wrongs the first version committed at once.
    withTmpDir((dir) => {
      const file = join(dir, "regional.json");
      writeFileSync(
        file,
        JSON.stringify({
          indicators: { ltUnemployment: null, fdiPerCapita: "oops" },
          series: { ltUnemployment: null, fdiPerCapita: [] },
        }),
      );
      const carried = readForeignIndicators(file);
      expect(carried.keys).toEqual([]);
      expect(carried.undeclared).toEqual([]);
      const merged = withCarriedIndicators(freshPayload(), carried);
      expect(Object.keys(merged.series)).not.toContain("ltUnemployment");
      // …and both reach the warning that names their owner.
      const report = carryReport(carried);
      expect(report.line).toBeNull();
      expect(report.missing).toContain("ltUnemployment");
      expect(report.missing).toContain("fdiPerCapita");
    });
  });

  it("accepts an already-parsed payload, not only a path", () => {
    // main() reuses the `prior` it read for the regression check; the two must
    // not be able to disagree about what the prior file is.
    withTmpDir((dir) => {
      const file = priorFile(dir);
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      expect(readForeignIndicators(parsed)).toEqual(
        readForeignIndicators(file),
      );
      expect(readForeignIndicators(null).keys).toEqual([]);
    });
  });

  it("carries an undeclared foreign key, and reports it", () => {
    // Losing a new writer's indicator is worse than an out-of-date list, so it
    // rides across — but it must not do so silently.
    withTmpDir((dir) => {
      const file = priorFile(dir, {
        indicators: { someNewIndicator: meta("nsi-x") },
        series: { someNewIndicator: { VID: [{ year: 2024, value: 3 }] } },
      });
      const carried = readForeignIndicators(file);
      expect(carried.keys).toContain("someNewIndicator");
      expect(carried.undeclared).toEqual(["someNewIndicator"]);
      const merged = withCarriedIndicators(freshPayload(), carried);
      expect(merged.series.someNewIndicator).toEqual({
        VID: [{ year: 2024, value: 3 }],
      });
    });
  });

  it("carries a key present in only one of the two blocks", () => {
    // A half-written prior file must not have its orphan half dropped too.
    withTmpDir((dir) => {
      const file = priorFile(dir, {
        series: { orphanSeries: { VID: [{ year: 2024, value: 9 }] } },
      });
      const carried = readForeignIndicators(file);
      expect(carried.keys).toContain("orphanSeries");
      expect(carried.indicators.orphanSeries).toBeUndefined();
      const merged = withCarriedIndicators(freshPayload(), carried);
      expect(merged.series.orphanSeries).toEqual({
        VID: [{ year: 2024, value: 9 }],
      });
    });
  });

  it("carries nothing rather than throwing on a missing or unreadable file", () => {
    // A first-ever run on a clean machine legitimately has nothing to carry,
    // and a truncated file must not abort the whole regional refresh.
    withTmpDir((dir) => {
      const empty = { indicators: {}, series: {}, keys: [], undeclared: [] };
      expect(readForeignIndicators(join(dir, "nope.json"))).toEqual(empty);
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{ not json");
      expect(readForeignIndicators(bad)).toEqual(empty);
      const shapeless = join(dir, "shapeless.json");
      writeFileSync(shapeless, JSON.stringify({ indicators: 7, series: null }));
      expect(readForeignIndicators(shapeless)).toEqual(empty);
    });
  });
});

describe("FOREIGN_INDICATORS covers the committed artifact", () => {
  const artifact = () =>
    JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
      indicators: Record<string, unknown>;
      series: Record<string, unknown>;
    };

  it("declares every foreign indicator key in data/regional.json", () => {
    const raw = artifact();
    const unaccounted = [
      ...new Set([...Object.keys(raw.indicators), ...Object.keys(raw.series)]),
    ].filter((k) => !OWN_INDICATORS.includes(k) && !(k in FOREIGN_INDICATORS));
    expect(
      unaccounted,
      `these indicator keys are written by neither this writer nor a listed ` +
        `foreign indicator. If THIS script produces the key, add it to ` +
        `DERIVED_INDICATORS (so it is never carried when its degrade path ` +
        `skips it); if another script does, add it to FOREIGN_INDICATORS`,
    ).toEqual([]);
  });

  it("still finds every foreign indicator in the committed artifact", () => {
    // The regression this whole file exists for: all five must be present.
    const raw = artifact();
    for (const [key, owner] of Object.entries(FOREIGN_INDICATORS)) {
      expect(raw.indicators[key], `${key} missing — run ${owner}`).toBeTruthy();
      expect(raw.series[key], `${key} missing — run ${owner}`).toBeTruthy();
    }
  });
});

describe("carryReport — what the operator is told", () => {
  const empty = { indicators: {}, series: {}, keys: [], undeclared: [] };

  it("names a declared key that was not carried as missing, not carried", () => {
    const r = carryReport(empty);
    expect(r.carried).toEqual([]);
    expect(r.line).toBeNull();
    expect(r.missing).toEqual(Object.keys(FOREIGN_INDICATORS).sort());
    expect(r.warnings.join("\n")).toContain("re-run the script that owns it");
  });

  it("names each missing key's owning script", () => {
    const r = carryReport(empty);
    const text = r.warnings.join("\n");
    for (const owner of new Set(Object.values(FOREIGN_INDICATORS))) {
      expect(text).toContain(owner);
    }
  });

  it("warns about an undeclared carried key so the list can catch up", () => {
    const r = carryReport({
      indicators: { someNew: {} as never },
      series: {},
      keys: ["someNew"],
      undeclared: ["someNew"],
    });
    expect(r.undeclared).toEqual(["someNew"]);
    expect(r.line).toContain("someNew");
    expect(r.warnings.join("\n")).toContain("add them to FOREIGN_INDICATORS");
  });

  it("says nothing at all when every declared key was carried", () => {
    const keys = Object.keys(FOREIGN_INDICATORS);
    const r = carryReport({ ...empty, keys });
    expect(r.missing).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.line).toContain(keys[0]);
  });
});

describe("the entry-point guard", () => {
  // Load-bearing for this whole file. Without it, importing fetch_eurostat
  // fires five live Eurostat requests and rewrites data/regional.json — the
  // artifact the describe block above reads — during `npm run test:unit`. The
  // `node` Vitest project has no setupFiles and a real global fetch, so
  // nothing else would turn that into a failure.
  //
  // Asserted structurally rather than by importing and watching for a fetch:
  // this file's own static import has already evaluated the module by the time
  // any test body runs, so a regression does its damage before a stub could
  // catch it. Measured — with the guard deleted, a stub-and-import test still
  // reported 16 passed while the run made real network calls.
  const SOURCE = resolve(__dirname, "fetch_eurostat.ts");

  it("is true only when the module IS the invoked script", () => {
    const url = pathToFileURL(SOURCE).href;
    expect(isEntryPoint(url, SOURCE)).toBe(true);
    expect(isEntryPoint(url, "/usr/local/bin/vitest")).toBe(false);
    expect(isEntryPoint(url, undefined)).toBe(false);
    expect(isEntryPoint(url, "")).toBe(false);
  });

  it("wraps the only call to main()", () => {
    const src = readFileSync(SOURCE, "utf8");
    const calls = src.match(/^[^\S\n]*main\(\)/gm) ?? [];
    expect(calls, "main() should be invoked exactly once").toHaveLength(1);
    expect(
      /if \(isEntryPoint\(import\.meta\.url\)\) \{\s*\n\s*main\(\)/.test(src),
      "main() must be called only inside `if (isEntryPoint(import.meta.url))` " +
        "— an unguarded call makes every importer, including this test file, " +
        "run the live Eurostat fetch and rewrite data/regional.json",
    ).toBe(true);
  });
});
