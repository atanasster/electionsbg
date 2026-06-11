// Smoke test for the multi-year fiscal projection engine
// (src/lib/bgFiscalProjection.ts): locks in the invariants of the debt-
// dynamics recursion before future edits — zero-delta identity, year-1
// interest parity, the debt recursion itself, scaled-vs-fixed delta
// semantics, and the EC Spring 2026 baseline anchors — then prints the
// baseline path table for eyeballing.
//
// Usage:
//   npx tsx scripts/budget/__smoke_fiscal_projection.ts

import {
  NOMINAL_GDP_2026_EUR,
  PROJECTION_YEARS,
  projectFiscalPath,
} from "../../src/lib/bgFiscalProjection";

let failures = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failures++;
};
const close = (a: number, b: number, tolEur = 1): boolean =>
  Math.abs(a - b) <= tolEur;

// 1) Zero policy delta → scenario path is the baseline path, no extra interest.
{
  const p = projectFiscalPath(0);
  const identical = p.years.every(
    (y) =>
      close(y.balanceEur, y.baselineBalanceEur) &&
      close(y.debtEur, y.baselineDebtEur) &&
      close(y.interestEur, y.baselineInterestEur),
  );
  check("zero delta: scenario ≡ baseline", identical);
  check("zero delta: extra interest = 0", close(p.extraInterestEur, 0));
}

// 2) Year-1 interest parity — both paths inherit the same 2025 stock, so
//    the interest gap can only open from year 2.
{
  const p = projectFiscalPath(-1e9);
  check(
    "year-1 interest gap = 0",
    close(p.years[0].interestEur, p.years[0].baselineInterestEur),
  );
  check(
    "year-2 interest gap > 0 for a deficit-widening delta",
    p.years[1].interestEur - p.years[1].baselineInterestEur > 0,
  );
}

// 3) Debt recursion: debt_t = debt_{t-1} − balance_t (SFA = 0), both paths.
{
  const p = projectFiscalPath(7.5e8);
  let prevBase = p.anchor.debtEur;
  let prevScen = p.anchor.debtEur;
  const holds = p.years.every((y) => {
    const ok =
      close(y.baselineDebtEur, prevBase - y.baselineBalanceEur) &&
      close(y.debtEur, prevScen - y.balanceEur);
    prevBase = y.baselineDebtEur;
    prevScen = y.debtEur;
    return ok;
  });
  check("debt recursion holds on both paths", holds);
}

// 4) Delta semantics: the scalar delta scales with nominal GDP (year 1 is
//    exactly the input), the fixed path passes through unscaled.
{
  const scaled = projectFiscalPath(1e9);
  check(
    "scaled delta: year 1 equals the input",
    close(scaled.years[0].policyDeltaEur, 1e9),
  );
  check(
    "scaled delta: grows with nominal GDP",
    scaled.years[PROJECTION_YEARS.length - 1].policyDeltaEur > 1e9,
  );
  const fixed = projectFiscalPath(
    0,
    PROJECTION_YEARS.map(() => 5e8),
  );
  check(
    "fixed path: passes through unscaled in every year",
    fixed.years.every((y) => close(y.policyDeltaEur, 5e8)),
  );
}

// 5) Anchors: EC Spring 2026 baseline ratios and the exported 2026 GDP.
{
  const p = projectFiscalPath(0);
  check(
    "2026 baseline balance = EC −4.1%",
    Math.abs(p.years[0].baselineBalancePctGdp - -4.1) < 0.005,
  );
  check(
    "2027 baseline balance = EC −4.3%",
    Math.abs(p.years[1].baselineBalancePctGdp - -4.3) < 0.005,
  );
  check(
    "exported 2026 GDP matches the path's first year",
    close(p.years[0].gdpEur, NOMINAL_GDP_2026_EUR),
  );
  check(
    "PROJECTION_YEARS matches the path",
    p.years.every((y, i) => y.year === PROJECTION_YEARS[i]),
  );
}

// Baseline path table for eyeballing against EC Spring 2026 / АСБП.
{
  const p = projectFiscalPath(0);
  console.log("\nyear  gdp(bn)  balance%  debt%  interest(bn)");
  for (const y of p.years) {
    console.log(
      `${y.year}  ${(y.gdpEur / 1e9).toFixed(1)}    ${y.baselineBalancePctGdp.toFixed(2)}    ${y.baselineDebtPctGdp.toFixed(1)}   ${(y.baselineInterestEur / 1e9).toFixed(2)}`,
    );
  }
}

if (failures > 0) {
  throw new Error(`${failures} fiscal-projection invariant(s) failed`);
}
console.log("\nAll fiscal-projection invariants hold.");
