// Smoke test for the ЗБНЗОК budget artifact (data/budget/nzok/budget.json,
// written by __write_budget.ts). Asserts the invariants that the hand-keyed
// generator can silently violate:
//   tsx scripts/budget/nzok/__smoke_budget.ts
//
// The FY2026 figures are hand-keyed from a 45k-char ДВ HTML render, and the
// first transcription got them wrong in a way that reconciled perfectly: one
// line was missed (1.1.3.6) and one was taken from a sub-line instead of its
// parent (1.1.3.7.1 vs 1.1.3.7), together €146.1M, all of which landed in the
// computed reserve residual. Checks (d), (e) and (g) below are the ones that
// would have caught it — a Σ-equals-total check alone would not.
//
// Expectations are DERIVED from the generator's own YEARS table rather than
// restated here, so this file cannot drift away from the source it guards. The
// one exception is FY2026_TOTAL_EUR: that is deliberately a second, independent
// copy of the promulgated headline, because a check that reads the number it is
// checking proves nothing about it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { NzokBudgetFile } from "../types";
import { YEARS, buildYear } from "./__write_budget";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE = path.resolve(__dirname, "../../../data/budget/nzok/budget.json");

/** Independently keyed from ЗБНЗОК 2026, обн. ДВ бр. 68 от 28.07.2026, чл. 1
 *  ал. 2 — NOT read from YEARS. */
const FY2026_TOTAL_EUR = 5_256_677_200;
const BGN_PER_EUR = 1.95583;

let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const main = (): void => {
  const file = JSON.parse(fs.readFileSync(FILE, "utf8")) as NzokBudgetFile;
  console.log(`ЗБНЗОК budget artifact — ${file.years.length} year(s)\n`);

  // The generator pins `latestYear`; the year-specific checks follow it rather
  // than a literal, so adding FY2027 moves them forward automatically.
  const latest = file.years.find((y) => y.fiscalYear === file.latestYear);
  if (!latest) {
    console.error(`✗ latestYear ${file.latestYear} has no entry`);
    process.exit(1);
  }
  const latestDef = YEARS.find((y) => y.fiscalYear === file.latestYear);
  if (!latestDef) {
    console.error(`✗ latestYear ${file.latestYear} is not in YEARS`);
    process.exit(1);
  }

  // (a) the promulgated headline, against an independently keyed constant
  if (latest.fiscalYear === 2026)
    check(
      "FY2026 total = €5,256,677,200 (independently keyed)",
      latest.totalExpenditure.amountEur === FY2026_TOTAL_EUR,
      `got €${latest.totalExpenditure.amountEur.toLocaleString("en")}`,
    );

  // (b) every year's composition reconciles to its headline. The tolerance is
  //     the rounding that actually produces the drift: each line is rounded
  //     independently, so a converted (BGN) year can be off by up to ±1 minor
  //     unit per line, while a EUR-native year must be EXACT. The old flat
  //     `<= 1` sat precisely on FY2025's measured −1 and would not have caught
  //     an eleventh line's worth of new drift.
  for (const y of file.years) {
    const sum = y.lines.reduce((s, l) => s + l.amount.amountEur, 0);
    const drift = sum - y.totalExpenditure.amountEur;
    const tol = y.currencyOfRecord === "EUR" ? 0 : y.lines.length;
    check(
      `FY${y.fiscalYear} Σ lines = total (±${tol}, ${y.currencyOfRecord})`,
      Math.abs(drift) <= tol,
      `drift €${drift}`,
    );
  }

  // (c) the latest year is the promulgated law, not a draft
  check(
    `FY${latest.fiscalYear} basis = law`,
    latest.basis === "law",
    `got "${latest.basis}"`,
  );

  // (d) the residual equals the law's own stated components. An under-keyed
  //     table reconciles under (b) and fails only here.
  const reserve = latest.lines.find((l) => l.id === "reserve");
  if (latestDef.expectedResidualK === "unsourced") {
    check(
      `FY${latest.fiscalYear} residual is pinned`,
      false,
      'expectedResidualK is "unsourced" — this year is unprotected against a missing line',
    );
  } else {
    const expected = Math.round(latestDef.expectedResidualK * 1000);
    check(
      `FY${latest.fiscalYear} residual = €${expected.toLocaleString("en")}`,
      reserve != null && Math.abs(reserve.amount.amountEur - expected) <= 1,
      `got €${(reserve?.amount.amountEur ?? 0).toLocaleString("en")}`,
    );
  }

  // (e) no line silently disappears between years — the check that would have
  //     caught `devices_hospital` vanishing from the composition bar.
  const prior = [...file.years]
    .filter((y) => y.fiscalYear < latest.fiscalYear)
    .sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  if (prior) {
    const ids = new Set(latest.lines.map((l) => l.id));
    const missing = prior.lines.map((l) => l.id).filter((id) => !ids.has(id));
    check(
      `FY${latest.fiscalYear} line ids ⊇ FY${prior.fiscalYear}`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : "",
    );
  }

  // (f) the BGN→EUR conversion is right, not merely self-consistent. Checking
  //     Σ lines against the converted total (check b) would pass even if the
  //     rate were wrong, because both sides use it. Anchor on the SOURCE figure.
  for (const y of file.years) {
    if (y.currencyOfRecord !== "BGN") continue;
    const def = YEARS.find((d) => d.fiscalYear === y.fiscalYear);
    if (!def) continue;
    const expectedEur = Math.round(Math.round(def.totalK * 1000) / BGN_PER_EUR);
    check(
      `FY${y.fiscalYear} BGN→EUR at 1.95583`,
      Math.abs(y.totalExpenditure.amountEur - expectedEur) <= 1,
      `${def.totalK.toLocaleString("en")}k BGN → €${y.totalExpenditure.amountEur.toLocaleString("en")}`,
    );
  }

  // (g) the anti-recurrence guard actually FIRES. Every check above exercises
  //     the happy path; this one drives the error path by replaying the exact
  //     defect that shipped — dropping line 1.1.3.6 from the latest year.
  if (latestDef.expectedResidualK !== "unsourced") {
    const dropped = latestDef.lines.find((l) => l.lawCode === "1.1.3.6");
    if (!dropped) {
      check("guard fires on a dropped line", false, "no 1.1.3.6 line to drop");
    } else {
      let threw = "";
      try {
        buildYear({
          ...latestDef,
          lines: latestDef.lines.filter((l) => l !== dropped),
        });
      } catch (e) {
        threw = (e as Error).message;
      }
      check(
        "guard throws when a line is dropped (replays the €146.1M defect)",
        threw.includes("residual") && threw.includes("wrong чл. 1 ал. 2 level"),
        threw ? `threw: ${threw.slice(0, 72)}…` : "DID NOT THROW",
      );
    }
  }

  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`,
  );
  if (failures > 0) process.exit(1);
};

main();
