// Gates for the /budget hub figure ledger.
//
// This module is about to become the REFERENCE SIDE of
// `budget_hub_stats.data.test.ts` (plan T4), which is an unusual position: a
// wrong reference does not fail, it relabels the matview as wrong — or, worse,
// checks nothing at all and passes. So the cases below are mostly about the
// ledger's own contract rather than about any single figure's value:
//
//   – every figure states a basis;
//   – the KEY SET does not depend on which shards are on this machine
//     (data/budget/reconciliation/ and data/budget/ministries/ are GITIGNORED,
//     so CI has neither — that is the vacuous-gate case);
//   – a null value always says WHY in its basis, never reads as a zero;
//   – node figures and row figures stay distinct, which is the §2.1 error the
//     plan credits this script with catching and which the first draft of the
//     script then reproduced in its own caution string.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  measureHubLedger,
  loadBudgetCorpus,
  emptyBudgetCorpus,
  ledgerYears,
  defaultFiscalYear,
} from "./hub_ledger";

const DATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data",
);

/** A machine with none of the inputs — i.e. a fresh clone, or CI. Taken from
 *  the module rather than hand-built here: a local copy would drift from
 *  `BudgetCorpus` and quietly stop simulating the case it is named for. */
const emptyCorpus = emptyBudgetCorpus;

const hasReconciliation = (fy: number): boolean =>
  fs.existsSync(path.join(DATA, `budget/reconciliation/${fy}/by-admin.json`));

describe("measureHubLedger — the contract", () => {
  it("gives every figure a basis that says something", () => {
    for (const f of measureHubLedger(2024)) {
      expect(f.basis, f.key).toBeTruthy();
      expect(f.basis.length, f.key).toBeGreaterThan(10);
    }
  });

  it("emits the SAME key set with a corpus it cannot read", () => {
    // The regression that matters most. If the gitignored shards change the key
    // set, then on CI a gate iterating ledger keys silently stops checking the
    // admin figures — and passes.
    const full = measureHubLedger(2024)
      .map((f) => f.key)
      .sort();
    const bare = measureHubLedger(2024, emptyCorpus())
      .map((f) => f.key)
      .sort();
    expect(bare).toEqual(full);
  });

  it("reports every unreadable figure as null, never as zero", () => {
    const bare = measureHubLedger(2024, emptyCorpus());
    expect(bare.length).toBeGreaterThan(10);
    for (const f of bare) {
      // fiscalYear is the argument, not a measurement, so it survives.
      if (f.key === "fiscalYear") continue;
      expect(f.value, f.key).toBeNull();
      expect(f.basis, f.key).toMatch(/not derivable, not zero/);
    }
  });

  it("never publishes a confident 0 for the ministry file count", () => {
    // A 0 here would ride in `rejected` as a defensible alternative answer with
    // the basis "the UNION across all years" — a false statement, which is
    // worse than a missing figure.
    const bare = measureHubLedger(2024, emptyCorpus());
    for (const f of bare) {
      for (const alt of f.rejected ?? []) {
        expect(alt.value, `${f.key}: ${alt.why}`).not.toBe(0);
      }
    }
  });

  it("states why in the basis whenever a value is null", () => {
    // Runs against the REAL corpus, on a year that is deliberately sparse:
    // FY2026 has no Доклад, no Приложение III and no COFOG point.
    for (const f of measureHubLedger(2026)) {
      if (f.value === null) {
        expect(f.basis, f.key).toMatch(/not derivable, not zero/);
      }
    }
  });

  it("never offers a rejected alternative equal to the value itself", () => {
    // `rejected` is documented as "other defensible answers"; an entry equal to
    // the value is not another answer, and its `why` then teaches a distinction
    // the corpus does not have.
    for (const fy of [2024, 2026]) {
      for (const f of measureHubLedger(fy)) {
        if (f.value === null) continue;
        for (const alt of f.rejected ?? []) {
          if (alt.value === null) continue;
          expect(alt.value, `${f.key}: "${alt.why}"`).not.toBe(f.value);
        }
      }
    }
  });

  it("keeps a boolean a boolean", () => {
    // Stringifying `complete` to "false" makes a strict comparison against a
    // boolean matview column silently unequal and a loose one a coincidence.
    const complete = measureHubLedger(2024).find((f) => f.key === "complete");
    expect(complete?.value === true || complete?.value === false).toBe(true);
  });
});

describe("measureHubLedger — node figures vs row figures", () => {
  // The §2.1 error the ledger exists to catch. Skipped rather than failed on a
  // machine without the gitignored shards, with the reason on the skip.
  it.skipIf(!hasReconciliation(2024))(
    "counts spending UNITS separately from rows, and says so",
    () => {
      const rows = measureHubLedger(2024);
      const nodes = rows.find((f) => f.key === "deviationsCoveredNodes");
      const rowFig = rows.find((f) => f.key === "deviationsExecutedRows");
      const units = rows.find((f) => f.key === "spendingUnitCount");

      expect(nodes?.value).toBe(8);
      expect(rowFig?.value).toBe(14);
      expect(units?.value).toBe(48);

      // The retracted pair must not reappear as a claim about ministries.
      expect(nodes?.caution).toMatch(/8 of 48 spending units/);
      expect(nodes?.caution).toMatch(/six of the\s+nine|six of the nine/);
      expect(nodes?.caution).not.toMatch(/four of seven/);
    },
  );

  it.skipIf(!hasReconciliation(2024))(
    "does not call the spending-unit count a ministry count",
    () => {
      const keys = measureHubLedger(2024).map((f) => f.key);
      expect(keys).toContain("spendingUnitCount");
      // 28 of FY2024's 48 units are not ministries, so the old name asserted a
      // population the figure does not measure.
      expect(keys).not.toContain("ministryCount");
    },
  );

  it.skipIf(!hasReconciliation(2024))(
    "does not claim the program grain carries a kind dimension",
    () => {
      // by-program.json is single-kind in all nine years, so rows === nodes;
      // a `rejected` entry teaching (nodeId × kind) there would contradict
      // migration 153's own PK.
      const program = measureHubLedger(2024).find(
        (f) => f.key === "programCount",
      );
      expect(program?.rejected ?? []).toHaveLength(0);
      expect(program?.caution).toMatch(/ONE kind/);
    },
  );
});

describe("ledgerYears", () => {
  it("covers every year with a reconciliation shard", () => {
    const corpus = loadBudgetCorpus();
    const dir = path.join(DATA, "budget/reconciliation");
    if (!fs.existsSync(dir)) return; // gitignored — nothing to compare against
    const onDisk = fs
      .readdirSync(dir)
      .filter((d) => /^\d{4}$/.test(d))
      .map(Number)
      .sort((a, b) => a - b);
    const covered = ledgerYears(corpus);
    for (const y of onDisk) expect(covered, `FY${y}`).toContain(y);
  });

  it("opens on the newest KFP year, not the newest year it can measure", () => {
    const corpus = loadBudgetCorpus();
    const opened = defaultFiscalYear(corpus);
    const kfpYears = (corpus.index?.fiscalYears ?? []).map((y) => y.fiscalYear);
    if (!kfpYears.length) return;
    expect(opened).toBe(Math.max(...kfpYears));
  });
});
