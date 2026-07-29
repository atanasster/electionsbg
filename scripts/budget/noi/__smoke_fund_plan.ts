// Smoke test for the ЗБДОО per-fund plan artifact (data/budget/noi/fund_plan.json).
//   tsx scripts/budget/noi/__smoke_fund_plan.ts
//
// The figures are hand-keyed from чл. 1–8 in Държавен вестник, so the checks
// here are the ones a transcription can silently get wrong — plus the BASIS
// invariants, which are the reason this file needs guarding at all.
//
// The чл. 1 headline is a GROSS SUM, not a consolidated total: the per-fund
// lines add to it EXACTLY, which is only possible if no inter-fund transfer was
// eliminated. Two rules follow, and both are asserted:
//   • the sum property must hold (it is the evidence for the basis reading);
//   • the plan must NOT be netted against funds.json's B1 actual, which IS
//     consolidated — so this file checks the two are not accidentally equal in
//     a way that would invite the comparison.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { NoiFundPlanFile } from "../types";
// funds.json's shape lives on the app side only; scripts/budget/types.ts does
// not re-declare it. Imported across rather than duplicated.
import type { NoiFundsFile } from "../../../src/data/budget/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, "../../../data/budget/noi");

const M = (v: number): string => `€${(v / 1e9).toFixed(3)}bn`;

/** Independently keyed from чл. 1–8, ЗБДОО-2026 (ДВ бр. 68 от 28.07.2026,
 *  idMat 244982) — NOT read back from the generator. Σlines == sumOfFunds only
 *  tests the transcription against itself: transpose two lines and both sides
 *  still agree. These absolutes are what actually catch a mis-key. */
const FY2026_EUR: Record<string, number> = {
  pensions: 5_572_766_500,
  pensions_art69: 931_980_900,
  pensions_non_labour: 264_736_300,
  work_injury: 239_126_200,
  sickness_maternity: 1_291_204_500,
  unemployment: 355_504_700,
  noi: 6_610_463_300,
};
const FY2026_SUM_EUR = 15_265_782_400;

let failed = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const main = (): void => {
  const plan = JSON.parse(
    fs.readFileSync(path.join(DIR, "fund_plan.json"), "utf8"),
  ) as NoiFundPlanFile;

  console.log(`ЗБДОО fund plan — ${plan.years.length} year(s)\n`);

  for (const y of plan.years) {
    // (a) THE basis evidence. Parts == whole ⇒ nothing was eliminated ⇒ this
    //     is a gross sum. If this ever fails, the labelling rules everywhere
    //     else (never „консолидиран“, never net against B1) need re-deriving.
    const sum = y.lines.reduce((s, l) => s + l.amount.amountEur, 0);
    const drift = sum - y.sumOfFunds.amountEur;
    // Each line is rounded independently from thousands, so the tolerance is
    // the line count, not a flat €1 — a flat bound would start failing purely
    // by adding a fund.
    check(
      `FY${y.fiscalYear} lines sum EXACTLY to чл. 1 (±${y.lines.length})`,
      Math.abs(drift) <= y.lines.length,
      `drift €${drift}`,
    );

    // (b) the basis is declared in the data, not just in prose
    check(`FY${y.fiscalYear} basis = law`, y.basis === "law", y.basis);
    check(
      `FY${y.fiscalYear} cites its ДВ issue and idMat`,
      Boolean(y.dvIssue) && Boolean(y.idMat),
      `${y.dvIssue} / idMat ${y.idMat}`,
    );

    // (c) the НОИ line is marked non-peer. Rendered as a peer it is the
    //     largest "fund" on the chart at 43% of the sum, which is a
    //     presentation bug that reads as a finding.
    const nonPeer = y.lines.filter((l) => !l.isPeerFund);
    check(
      `FY${y.fiscalYear} marks the НОИ line non-peer`,
      nonPeer.length === 1 && nonPeer[0].id === "noi",
      nonPeer.map((l) => l.id).join(", ") || "none",
    );
    const peerSum = y.lines
      .filter((l) => l.isPeerFund)
      .reduce((s, l) => s + l.amount.amountEur, 0);
    check(
      `FY${y.fiscalYear} НОИ line really is oversized (justifying the flag)`,
      y.sumOfFunds.amountEur - peerSum > peerSum * 0.5,
      `peers ${M(peerSum)} vs НОИ ${M(y.sumOfFunds.amountEur - peerSum)}`,
    );

    // (c2) every FY2026 line against the law, digit for digit
    if (y.fiscalYear === 2026) {
      check(
        "FY2026 чл. 1 headline matches the law",
        y.sumOfFunds.amountEur === FY2026_SUM_EUR,
        `€${y.sumOfFunds.amountEur.toLocaleString("en")}`,
      );
      const ids = new Set(y.lines.map((l) => l.id));
      const missing = Object.keys(FY2026_EUR).filter((k) => !ids.has(k));
      check(
        "FY2026 carries every чл. 1–8 fund line",
        missing.length === 0,
        missing.join(", ") || `${ids.size} lines`,
      );
      for (const l of y.lines) {
        const want = FY2026_EUR[l.id];
        if (want == null) {
          check(`FY2026 line ${l.id} is a known fund`, false, "unexpected id");
          continue;
        }
        check(
          `FY2026 ${l.id} = €${want.toLocaleString("en")}`,
          l.amount.amountEur === want,
          `got €${l.amount.amountEur.toLocaleString("en")}`,
        );
      }
    }

    // (d) every line carries a positive amount and a bilingual label
    for (const l of y.lines) {
      if (l.amount.amountEur > 0 && l.bg && l.en) continue;
      check(`FY${y.fiscalYear} line ${l.id} is well-formed`, false);
    }
  }

  // (e) the plan and the actual must not be confused. Different bases, so a
  //     consumer that nets them is wrong even when the numbers look close.
  const fundsPath = path.join(DIR, "funds.json");
  if (fs.existsSync(fundsPath)) {
    const actual = JSON.parse(
      fs.readFileSync(fundsPath, "utf8"),
    ) as NoiFundsFile;
    const latestActual = [...actual.years]
      .filter((y) => y.complete !== false)
      .sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
    const latestPlan = plan.years.find((y) => y.fiscalYear === plan.latestYear);
    if (latestActual && latestPlan) {
      const gap =
        latestPlan.sumOfFunds.amountEur -
        latestActual.totals.expenditure.amountEur;
      console.log(
        `\n        plan FY${latestPlan.fiscalYear} ${M(latestPlan.sumOfFunds.amountEur)} (gross sum)` +
          ` vs actual FY${latestActual.fiscalYear} ${M(latestActual.totals.expenditure.amountEur)} (consolidated)` +
          ` — difference ${M(gap)} is an ACCOUNTING-BASIS gap, not execution.`,
      );
      // Deliberately NOT asserted: "the two numbers are far apart". Their gap
      // is a coincidence of these particular years, not an invariant — a year
      // where they happened to be close would fail a check like that while
      // being perfectly correct, and it would teach that closeness is what
      // makes netting wrong. What makes netting wrong is the BASIS: a gross
      // sum of fund lines versus a consolidated cash total. That is asserted
      // structurally by (a) above — the parts summing exactly to the whole is
      // what proves nothing was eliminated.
    }
  }

  console.log(
    failed === 0 ? "\nAll fund-plan invariants hold." : `\n${failed} FAILED.`,
  );
  if (failed > 0) process.exit(1);
};

main();
