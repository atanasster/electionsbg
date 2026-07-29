// Extensive coverage for the pure Bulgarian personal-tax math behind the
// /budget/tax-calculator page. This is money math whose output is shown to the
// public, so it gets a labelled case set covering each profile, the МОД cap,
// child relief, marginal-vs-effective rate, VAT, corporate+dividend tax and the
// pension projection — plus the boundary cases (cap floor, relief clamp, zero /
// negative income, out-of-table fiscal years). See docs/testing-standards.md.
import { describe, expect, it } from "vitest";
import {
  PIT_RATE,
  SSC_EMPLOYEE_RATE,
  SSC_EMPLOYER_RATE,
  SSC_SELF_INSURED_RATE,
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  COMPANY_MARGINAL_RATE,
  VAT_STANDARD_RATE,
  VAT_CONSUMPTION_SHARE,
  PENSION_EMPLOYEE_RATE,
  PENSION_EMPLOYER_RATE,
  PENSION_SELF_RATE,
  PENSION_ACCRUAL_RATE,
  MIN_PENSION,
  MAX_PENSION,
  MIN_SELF_INSURED_INCOME,
  CHILD_RELIEF_BASE,
  MOD_BY_YEAR,
  MOD_SCHEDULE,
  MIN_PENSION_SCHEDULE,
  MIN_SELF_INSURED_SCHEDULE,
  UNEMPLOYMENT_BENEFIT_DAILY_MIN,
  UNEMPLOYMENT_BENEFIT_DAILY_MAX,
  CHILD_REARING_BENEFIT,
  DEATH_GRANT,
  GUARANTEED_CLAIMS_CAP,
  GVRS_CONTRIBUTION_DUE_2026,
  latestScheduledValue,
  currentStatutoryMod,
  capMonths,
  stepAt,
  resolveMod,
  computeLabourTax,
  computeVat,
  computeCompanyTax,
  computePension,
} from "./bgTax";

// The statutory scalars are LITERAL pins, not assertions against the map they
// come from. Writing `expect(resolveMod(2030).mod).toBe(MOD_BY_YEAR[2026])`
// follows the value instead of checking it: when 2026 moved 2112 → 2300 every
// such test kept passing, so nothing anywhere detected the repricing. These
// literals are the detector.
describe("statutory scalars (literal pins)", () => {
  it("pins the 2026 МОД cap to the ЗБДОО-2026 value", () => {
    expect(MOD_BY_YEAR[2026]).toBe(2300);
  });

  it("pins what the production call sites actually read", () => {
    // BudgetPolicySimulator reads resolveMod(null).mod for `currentCap`.
    expect(resolveMod(null).mod).toBe(2300);
  });

  it("pins the ЗБДОО-2026 pension and self-insured figures", () => {
    expect(MIN_PENSION).toBe(347.51); // чл. 10, from 1 Jul 2026
    expect(MAX_PENSION).toBe(1738.4); // § 4 ал. 2, whole year
    expect(MIN_SELF_INSURED_INCOME).toBe(620.2); // чл. 9, from 1 Aug 2026
  });

  it("pins the WHOLE МОД table, not just the years that moved", () => {
    // A per-year `some()` drift guard is too loose to be a detector on its own:
    // €2,112 matches the €2,111.64 carry-over step within its ±1 tolerance, so
    // reverting 2026 to 2112 would slip past it. The whole-table equality is
    // what actually fails, and it covers the years no literal pin names.
    expect(MOD_BY_YEAR).toEqual({
      2018: 1329,
      2019: 1534,
      2020: 1534,
      2021: 1534,
      2022: 1738,
      2023: 1738,
      2024: 1917,
      2025: 2112,
      2026: 2300,
    });
  });

  it("never lets a scalar drift to a value that was never law", () => {
    // Every headline scalar must appear in its own year's schedule (to the
    // whole euro the map is rounded to).
    for (const [yearStr, scalar] of Object.entries(MOD_BY_YEAR)) {
      const steps = MOD_SCHEDULE[Number(yearStr)];
      expect(steps, `MOD_SCHEDULE missing ${yearStr}`).toBeDefined();
      const matches = steps.some((s) => Math.abs(s.value - scalar) <= 1);
      expect(matches, `${yearStr}: ${scalar} is in no step`).toBe(true);
    }
  });

  it("covers every scheduled year with a scalar (both directions)", () => {
    // The converse of the guard above: a schedule year with no scalar would be
    // invisible to resolveMod, which reads MOD_BY_YEAR for its year set.
    expect(Object.keys(MOD_SCHEDULE).sort()).toEqual(
      Object.keys(MOD_BY_YEAR).sort(),
    );
  });

  it("pins the ЗБДОО-2026 benefit constants", () => {
    expect(UNEMPLOYMENT_BENEFIT_DAILY_MIN).toBe(9.21); // чл. 11
    expect(UNEMPLOYMENT_BENEFIT_DAILY_MAX).toBe(54.78); // чл. 11
    expect(CHILD_REARING_BENEFIT).toBe(398.81); // чл. 12
    expect(DEATH_GRANT).toBe(276.1); // чл. 13
    expect(GUARANTEED_CLAIMS_CAP).toBe(1550.5); // чл. 15 ал. 2
    expect(GVRS_CONTRIBUTION_DUE_2026).toBe(false); // чл. 15 ал. 1
  });

  it("derives the scalars from the LATEST scheduled year, not a fixed index", () => {
    // Guards the staleness class directly: adding a 2027 schedule must move
    // these, and a hard-coded [2026] lookup would freeze them while the literal
    // pins above kept passing.
    expect(MIN_PENSION).toBe(latestScheduledValue(MIN_PENSION_SCHEDULE));
    expect(MIN_SELF_INSURED_INCOME).toBe(
      latestScheduledValue(MIN_SELF_INSURED_SCHEDULE),
    );
    const withFuture = {
      ...MIN_PENSION_SCHEDULE,
      2027: [{ from: "2027-01-01", value: 999 }],
    };
    expect(latestScheduledValue(withFuture)).toBe(999);
  });
});

describe("stepAt", () => {
  it("returns the last step when no date is given", () => {
    expect(stepAt(MOD_SCHEDULE[2026]).value).toBe(2300);
  });

  it("resolves the step in force on a date", () => {
    const s26 = MOD_SCHEDULE[2026];
    expect(stepAt(s26, "2026-01-01").value).toBe(2111.64);
    expect(stepAt(s26, "2026-07-31").value).toBe(2111.64);
    expect(stepAt(s26, "2026-08-01").value).toBe(2300); // boundary, inclusive
    expect(stepAt(s26, "2026-12-31").value).toBe(2300);
  });

  it("clamps a date before the first step to the first step", () => {
    expect(stepAt(MOD_SCHEDULE[2026], "2025-06-01").value).toBe(2111.64);
  });

  it("throws on an empty schedule rather than returning undefined", () => {
    expect(() => stepAt([])).toThrow(/empty schedule/);
  });
});

describe("MOD_SCHEDULE", () => {
  it("records the two known mid-year steps", () => {
    // 2025: обн. 25 Mar → step 1 Apr. 2026: обн. 28 Jul → step 1 Aug.
    expect(MOD_SCHEDULE[2025].map((s) => s.from)).toEqual([
      "2025-01-01",
      "2025-04-01",
    ]);
    expect(MOD_SCHEDULE[2026].map((s) => s.from)).toEqual([
      "2026-01-01",
      "2026-08-01",
    ]);
  });

  it("carries the previous year's cap into EVERY stepped year's first period", () => {
    // The generative rule: until the late budget passes, the extension law
    // carries year N−1's value. Looped rather than spelled out per year, so a
    // newly added mover cannot be given an inconsistent first step — which is
    // exactly how 2022 was first entered wrong (€1,738 from 1 Jan, when Q1 was
    // still the €1,534 carry-over and the step landed 1 Apr).
    for (const [yearStr, steps] of Object.entries(MOD_SCHEDULE)) {
      if (steps.length < 2) continue;
      const prev = MOD_BY_YEAR[Number(yearStr) - 1];
      if (prev == null) continue;
      expect(steps[0].value, `${yearStr} first step != ${prev}`).toBeCloseTo(
        prev,
        0,
      );
    }
  });

  it("records all three known mid-year movers", () => {
    const movers = Object.entries(MOD_SCHEDULE)
      .filter(([, steps]) => steps.length > 1)
      .map(([y]) => Number(y));
    expect(movers).toEqual([2022, 2025, 2026]);
    expect(MOD_SCHEDULE[2022].map((s) => s.from)).toEqual([
      "2022-01-01",
      "2022-04-01",
    ]);
  });

  it("keeps every schedule ascending by date", () => {
    for (const [year, steps] of Object.entries(MOD_SCHEDULE)) {
      const dates = steps.map((s) => s.from);
      expect(dates, `${year} is not ascending`).toEqual([...dates].sort());
    }
  });
});

describe("resolveMod", () => {
  it("defaults to the latest table year when the year is null/undefined", () => {
    const latest = 2026;
    expect(resolveMod(null)).toMatchObject({
      mod: MOD_BY_YEAR[latest],
      year: latest,
      exact: false,
    });
    expect(resolveMod(undefined)).toMatchObject({
      mod: MOD_BY_YEAR[latest],
      year: latest,
      exact: false,
    });
  });

  it("returns the exact value for a year present in the table", () => {
    expect(resolveMod(2025)).toMatchObject({
      mod: 2112,
      year: 2025,
      exact: true,
    });
    expect(resolveMod(2018)).toMatchObject({
      mod: 1329,
      year: 2018,
      exact: true,
    });
    expect(resolveMod(2022)).toMatchObject({
      mod: 1738,
      year: 2022,
      exact: true,
    });
  });

  it("snaps a year below the table to the earliest known year", () => {
    const res = resolveMod(2005);
    expect(res).toMatchObject({
      mod: MOD_BY_YEAR[2018],
      year: 2018,
      exact: false,
    });
  });

  it("snaps a year above the table to the latest known year", () => {
    const res = resolveMod(2030);
    expect(res).toMatchObject({
      mod: MOD_BY_YEAR[2026],
      year: 2026,
      exact: false,
    });
  });

  it("never reports a year whose cap it is not actually showing", () => {
    // The whole point of `exact`/`year`: a snapped resolution must name the
    // year the value is drawn from, not the year that was asked for.
    const res = resolveMod(2040);
    expect(res.exact).toBe(false);
    expect(MOD_BY_YEAR[res.year]).toBe(res.mod);
    expect(res.year).not.toBe(2040);
  });

  it("is time-independent without asOf", () => {
    // No wall-clock default: the same call must return the same value whenever
    // it runs, or the test suite and shared ?mod= permalinks both drift.
    expect(resolveMod(2026).mod).toBe(2300);
    expect(resolveMod(2026).asOf).toBeUndefined();
  });

  it("resolves the in-force step on both sides of the 2026 boundary", () => {
    expect(resolveMod(2026, "2026-07-31").mod).toBe(2111.64);
    expect(resolveMod(2026, "2026-08-01").mod).toBe(2300);
  });

  it("resolves the in-force step on both sides of the 2025 boundary", () => {
    expect(resolveMod(2025, "2025-03-31").mod).toBe(1917.34);
    expect(resolveMod(2025, "2025-04-01").mod).toBe(2111.64);
  });

  it("ignores an asOf outside the resolved year rather than clamping", () => {
    // Asking for 2026 as of a 2025 date would otherwise clamp to 2026's first
    // step and return a real-looking number for a period it never covered.
    expect(resolveMod(2026, "2025-05-01").mod).toBe(MOD_BY_YEAR[2026]);
    expect(resolveMod(2026, "2025-05-01").asOf).toBeUndefined();
  });

  it("applies asOf on a SNAPPED year only when the date is in that year", () => {
    // 2030 snaps to 2026; a 2026 date then resolves 2026's steps.
    expect(resolveMod(2030, "2026-01-15").mod).toBe(2111.64);
    // …but a 2030 date does not, because 2030 has no schedule of its own.
    expect(resolveMod(2030, "2030-01-15").mod).toBe(MOD_BY_YEAR[2026]);
  });

  it("does not hand out the live schedule array", () => {
    const res = resolveMod(2026);
    res.steps![0].value = 1;
    expect(MOD_SCHEDULE[2026][0].value).toBe(2111.64);
  });

  it("exposes the steps so a caller can label the period, not just the year", () => {
    const res = resolveMod(2026);
    expect(res.steps).toHaveLength(2);
    expect(res.steps?.[1]).toEqual({ from: "2026-08-01", value: 2300 });
    // Single-step years carry no `steps` — nothing to disambiguate.
    expect(resolveMod(2024).steps).toBeUndefined();
  });
});

describe("statutory schedules for the non-МОД constants", () => {
  it("steps the minimum pension on 1 July 2026", () => {
    const s = MIN_PENSION_SCHEDULE[2026];
    expect(stepAt(s, "2026-06-30").value).toBe(322.37);
    expect(stepAt(s, "2026-07-01").value).toBe(347.51);
  });

  it("steps the self-insured floor on 1 August 2026", () => {
    const s = MIN_SELF_INSURED_SCHEDULE[2026];
    expect(stepAt(s, "2026-07-31").value).toBe(550.66);
    expect(stepAt(s, "2026-08-01").value).toBe(620.2);
  });

  it("records that €550.66 dates from 1 April 2025, not from 2026", () => {
    expect(stepAt(MIN_SELF_INSURED_SCHEDULE[2025], "2025-04-01").value).toBe(
      550.66,
    );
    expect(MIN_SELF_INSURED_SCHEDULE[2026][0].value).toBe(550.66);
  });
});

describe("computeLabourTax — employee below the МОД cap", () => {
  // Average-wage worker: €1,100 gross, cap €2,112, no children. Matches the
  // figures rendered on the live page (€246 tax, 22.4%, €854 net).
  const r = computeLabourTax({
    monthlyGross: 1100,
    mod: 2112,
    profile: "employee",
    children: 0,
  });

  it("insures the full salary when it is under the cap", () => {
    expect(r.insurableBase).toBe(1100);
    expect(r.isAboveCap).toBe(false);
  });

  it("charges employee SSC on the insurable base", () => {
    expect(r.ssc).toBeCloseTo(1100 * SSC_EMPLOYEE_RATE, 6);
    expect(r.ssc).toBeCloseTo(151.58, 2);
  });

  it("charges employer SSC on the same base", () => {
    expect(r.employerSsc).toBeCloseTo(1100 * SSC_EMPLOYER_RATE, 6);
    expect(r.employerSsc).toBeCloseTo(209.22, 2);
  });

  it("levies 10% PIT on the post-contribution base", () => {
    expect(r.pit).toBeCloseTo((1100 - r.ssc) * PIT_RATE, 6);
    expect(r.childRelief).toBe(0);
  });

  it("sums direct tax, net, and labour cost consistently", () => {
    expect(r.directTax).toBeCloseTo(r.ssc + r.pit, 6);
    expect(r.directTax).toBeCloseTo(246.422, 3);
    expect(r.net).toBeCloseTo(1100 - r.directTax, 6);
    expect(r.net).toBeCloseTo(853.578, 3);
    expect(r.labourCost).toBeCloseTo(1100 + r.employerSsc, 6);
    expect(r.labourCost).toBeCloseTo(1309.22, 2);
  });

  it("reports effective, marginal and tax-wedge rates", () => {
    expect(r.effectiveRate).toBeCloseTo(0.22402, 5);
    // Below the cap the marginal rate equals the effective rate for a flat
    // salary: SSC then PIT on the remainder.
    expect(r.marginalRate).toBeCloseTo(
      SSC_EMPLOYEE_RATE + PIT_RATE * (1 - SSC_EMPLOYEE_RATE),
      6,
    );
    expect(r.marginalRate).toBeCloseTo(r.effectiveRate, 6);
    expect(r.taxWedge).toBeCloseTo(
      (r.directTax + r.employerSsc) / r.labourCost,
      6,
    );
    expect(r.taxWedge).toBeCloseTo(0.34803, 5);
  });

  it("splits the pension contribution between employee and employer", () => {
    expect(r.pensionContribEmployee).toBeCloseTo(
      1100 * PENSION_EMPLOYEE_RATE,
      6,
    );
    expect(r.pensionContribEmployer).toBeCloseTo(
      1100 * PENSION_EMPLOYER_RATE,
      6,
    );
  });
});

describe("computeLabourTax — employee above the МОД cap", () => {
  const mod = 2112;
  const r = computeLabourTax({
    monthlyGross: 5000,
    mod,
    profile: "employee",
    children: 0,
  });

  it("caps the insurable base at the МОД", () => {
    expect(r.insurableBase).toBe(mod);
    expect(r.isAboveCap).toBe(true);
    expect(r.ssc).toBeCloseTo(mod * SSC_EMPLOYEE_RATE, 6);
    expect(r.employerSsc).toBeCloseTo(mod * SSC_EMPLOYER_RATE, 6);
  });

  it("still applies PIT to the full income minus capped SSC", () => {
    expect(r.pit).toBeCloseTo((5000 - r.ssc) * PIT_RATE, 6);
  });

  it("drops the marginal rate to the flat PIT rate above the cap", () => {
    // Above the cap extra euros carry only income tax — no more SSC.
    expect(r.marginalRate).toBe(PIT_RATE);
    expect(r.marginalRate).toBeLessThan(r.effectiveRate);
  });

  it("computes pension contributions on the capped base, not the salary", () => {
    expect(r.pensionContribEmployee).toBeCloseTo(
      mod * PENSION_EMPLOYEE_RATE,
      6,
    );
    expect(r.pensionContribEmployer).toBeCloseTo(
      mod * PENSION_EMPLOYER_RATE,
      6,
    );
  });
});

describe("computeLabourTax — self-insured", () => {
  it("uses the self-insured rate and remits no employer share", () => {
    const r = computeLabourTax({
      monthlyGross: 1500,
      mod: 2112,
      profile: "self",
      children: 0,
    });
    expect(r.ssc).toBeCloseTo(1500 * SSC_SELF_INSURED_RATE, 6);
    expect(r.employerSsc).toBe(0);
    expect(r.pensionContribEmployer).toBe(0);
    expect(r.pensionContribEmployee).toBeCloseTo(1500 * PENSION_SELF_RATE, 6);
  });

  it("floors the insurable base at the minimum self-insured income", () => {
    const r = computeLabourTax({
      monthlyGross: 400,
      mod: 2112,
      profile: "self",
      children: 0,
    });
    expect(r.insurableBase).toBe(MIN_SELF_INSURED_INCOME);
    expect(r.ssc).toBeCloseTo(
      MIN_SELF_INSURED_INCOME * SSC_SELF_INSURED_RATE,
      6,
    );
  });

  it("still caps the insurable base at the МОД for high earners", () => {
    const mod = 2112;
    const r = computeLabourTax({
      monthlyGross: 9000,
      mod,
      profile: "self",
      children: 0,
    });
    expect(r.insurableBase).toBe(mod);
    expect(r.isAboveCap).toBe(true);
  });

  it("marginal rate below cap combines self-insured SSC and PIT", () => {
    const r = computeLabourTax({
      monthlyGross: 1500,
      mod: 2112,
      profile: "self",
      children: 0,
    });
    expect(r.marginalRate).toBeCloseTo(
      SSC_SELF_INSURED_RATE + PIT_RATE * (1 - SSC_SELF_INSURED_RATE),
      6,
    );
  });
});

describe("computeLabourTax — child relief", () => {
  it("reduces PIT by the monthly relief entitlement", () => {
    const two = computeLabourTax({
      monthlyGross: 1100,
      mod: 2112,
      profile: "employee",
      children: 2,
    });
    const none = computeLabourTax({
      monthlyGross: 1100,
      mod: 2112,
      profile: "employee",
      children: 0,
    });
    const expectedRelief = (CHILD_RELIEF_BASE[2] * PIT_RATE) / 12;
    expect(two.childRelief).toBeCloseTo(expectedRelief, 6);
    expect(two.childRelief).toBeCloseTo(51.129, 3);
    expect(two.pit).toBeCloseTo(none.pit - expectedRelief, 6);
    // Relief lowers direct tax but does not touch SSC.
    expect(two.ssc).toBeCloseTo(none.ssc, 6);
  });

  it("grows the relief monotonically with the number of children", () => {
    const relief = (children: number) =>
      computeLabourTax({
        monthlyGross: 1500,
        mod: 2112,
        profile: "employee",
        children,
      }).childRelief;
    expect(relief(0)).toBe(0);
    expect(relief(1)).toBeGreaterThan(relief(0));
    expect(relief(2)).toBeGreaterThan(relief(1));
    expect(relief(3)).toBeGreaterThan(relief(2));
  });

  it("clamps the relief to the PIT owed on a low income (never negative PIT)", () => {
    // €600 gross with 3+ children: the full relief entitlement exceeds the
    // PIT due, so PIT floors at zero rather than going negative.
    const r = computeLabourTax({
      monthlyGross: 600,
      mod: 2112,
      profile: "employee",
      children: 3,
    });
    const fullEntitlement = (CHILD_RELIEF_BASE[3] * PIT_RATE) / 12;
    const pitBeforeRelief = (600 - r.ssc) * PIT_RATE;
    expect(fullEntitlement).toBeGreaterThan(pitBeforeRelief);
    expect(r.childRelief).toBeCloseTo(pitBeforeRelief, 6);
    expect(r.pit).toBe(0);
  });

  it("ignores an out-of-range children key (treats it as no relief)", () => {
    const r = computeLabourTax({
      monthlyGross: 1100,
      mod: 2112,
      profile: "employee",
      children: 7,
    });
    expect(r.childRelief).toBe(0);
  });
});

describe("computeLabourTax — degenerate income", () => {
  it("returns all-zero tax and a zero effective rate at zero gross", () => {
    const r = computeLabourTax({
      monthlyGross: 0,
      mod: 2112,
      profile: "employee",
      children: 0,
    });
    expect(r.insurableBase).toBe(0);
    expect(r.ssc).toBe(0);
    expect(r.pit).toBe(0);
    expect(r.directTax).toBe(0);
    expect(r.net).toBe(0);
    expect(r.effectiveRate).toBe(0);
    expect(r.taxWedge).toBe(0);
  });
});

describe("computeVat", () => {
  it("extracts the embedded 20% VAT from consumption at the default share", () => {
    const vat = computeVat(853.578);
    expect(vat).toBeCloseTo(
      853.578 *
        VAT_CONSUMPTION_SHARE *
        (VAT_STANDARD_RATE / (1 + VAT_STANDARD_RATE)),
      6,
    );
    expect(vat).toBeCloseTo(106.7, 1);
  });

  it("scales linearly with a custom consumption share", () => {
    expect(computeVat(1000, 0.5)).toBeCloseTo(2 * computeVat(1000, 0.25), 6);
    expect(computeVat(1000, 0)).toBe(0);
  });

  it("returns zero for non-positive net income", () => {
    expect(computeVat(0)).toBe(0);
    expect(computeVat(-500)).toBe(0);
  });
});

describe("computeCompanyTax", () => {
  it("applies 10% corporate then 5% dividend withholding", () => {
    const r = computeCompanyTax(5000);
    expect(r.corpTax).toBeCloseTo(5000 * CORP_TAX_RATE, 6);
    expect(r.dividendTax).toBeCloseTo(
      (5000 - r.corpTax) * DIVIDEND_TAX_RATE,
      6,
    );
    expect(r.totalTax).toBeCloseTo(r.corpTax + r.dividendTax, 6);
    expect(r.totalTax).toBeCloseTo(725, 6);
    expect(r.net).toBeCloseTo(5000 - r.totalTax, 6);
    expect(r.effectiveRate).toBeCloseTo(0.145, 6);
  });

  it("exposes a constant marginal rate equal to the derived constant", () => {
    const r = computeCompanyTax(12345);
    expect(r.marginalRate).toBe(COMPANY_MARGINAL_RATE);
    expect(COMPANY_MARGINAL_RATE).toBeCloseTo(
      CORP_TAX_RATE + DIVIDEND_TAX_RATE * (1 - CORP_TAX_RATE),
      6,
    );
    // Effective rate is flat across profit levels for a company owner.
    expect(computeCompanyTax(1000).effectiveRate).toBeCloseTo(
      computeCompanyTax(90000).effectiveRate,
      6,
    );
  });

  it("clamps negative profit to zero tax", () => {
    const r = computeCompanyTax(-2000);
    expect(r.corpTax).toBe(0);
    expect(r.dividendTax).toBe(0);
    expect(r.totalTax).toBe(0);
    expect(r.effectiveRate).toBe(0);
  });
});

describe("computePension", () => {
  it("accrues 1.35% of insurable income per year of service", () => {
    const r = computePension(1100, 40);
    expect(r.uncapped).toBeCloseTo(1100 * PENSION_ACCRUAL_RATE * 40, 6);
    expect(r.uncapped).toBeCloseTo(594, 6);
    expect(r.monthly).toBeCloseTo(594, 6);
    expect(r.cappedAtMin).toBe(false);
    expect(r.cappedAtMax).toBe(false);
  });

  it("floors the payout at the minimum pension", () => {
    const r = computePension(500, 15);
    expect(r.uncapped).toBeLessThan(MIN_PENSION);
    expect(r.monthly).toBe(MIN_PENSION);
    expect(r.cappedAtMin).toBe(true);
    expect(r.cappedAtMax).toBe(false);
  });

  it("caps the payout at the maximum pension", () => {
    const r = computePension(4000, 50);
    expect(r.uncapped).toBeGreaterThan(MAX_PENSION);
    expect(r.monthly).toBe(MAX_PENSION);
    expect(r.cappedAtMax).toBe(true);
    expect(r.cappedAtMin).toBe(false);
  });
});

describe("statutory constants", () => {
  it("keeps the МОД table sorted and euro-native for recent years", () => {
    const years = Object.keys(MOD_BY_YEAR).map(Number);
    const sorted = [...years].sort((a, b) => a - b);
    expect(years).toEqual(sorted);
    // The 2026 cap NO LONGER equals the 2025 one. It did while Bulgaria ran on
    // the extension law that froze the 2025 amounts; чл. 9 ЗБДОО-2026 (обн. ДВ
    // бр. 68 от 28.07.2026) raised it to €2,300 from 1 Aug 2026. The frozen
    // value survives as the year's FIRST step, which is where the carry-over
    // invariant properly lives — see the MOD_SCHEDULE suite above.
    expect(MOD_BY_YEAR[2026]).toBeGreaterThan(MOD_BY_YEAR[2025]);
    expect(MOD_SCHEDULE[2026][0].value).toBeCloseTo(MOD_BY_YEAR[2025], 0);
  });

  it("has plausible rate magnitudes (guards against a typo'd constant)", () => {
    expect(PIT_RATE).toBe(0.1);
    expect(SSC_EMPLOYEE_RATE).toBeGreaterThan(0);
    expect(SSC_EMPLOYEE_RATE).toBeLessThan(SSC_SELF_INSURED_RATE);
    expect(SSC_EMPLOYER_RATE).toBeGreaterThan(0);
    expect(MIN_PENSION).toBeLessThan(MAX_PENSION);
  });
});

describe("currentStatutoryMod", () => {
  it("names the concept the call sites were each re-deriving", () => {
    expect(currentStatutoryMod()).toBe(resolveMod(null).mod);
    expect(currentStatutoryMod()).toBe(2300);
  });
});

describe("capMonths", () => {
  it("splits every fiscal year into twelve months", () => {
    for (const year of Object.keys(MOD_SCHEDULE).map(Number)) {
      const total = capMonths(year).reduce((a, c) => a + c.months, 0);
      expect(total, `${year} does not sum to 12`).toBe(12);
    }
  });

  it("returns a single 12-month segment for an unstepped year", () => {
    // This is what makes the scalar path byte-identical for callers that
    // switch to segments.
    expect(capMonths(2024)).toEqual([{ capEur: 1917, months: 12 }]);
    expect(capMonths(2021)).toEqual([{ capEur: 1534, months: 12 }]);
  });

  it("splits the three known movers at their real step dates", () => {
    expect(capMonths(2022)).toEqual([
      { capEur: 1533.98, months: 3 }, // Jan–Mar
      { capEur: 1738.4, months: 9 }, // Apr–Dec
    ]);
    expect(capMonths(2025)).toEqual([
      { capEur: 1917.34, months: 3 },
      { capEur: 2111.64, months: 9 },
    ]);
    expect(capMonths(2026)).toEqual([
      { capEur: 2111.64, months: 7 }, // Jan–Jul
      { capEur: 2300, months: 5 }, // Aug–Dec
    ]);
  });

  it("falls back to a whole-year scalar for a year with no schedule", () => {
    expect(capMonths(2040)).toEqual([{ capEur: 2300, months: 12 }]);
  });

  it("never emits a negative or >12 month count", () => {
    for (const year of Object.keys(MOD_SCHEDULE).map(Number)) {
      for (const seg of capMonths(year)) {
        expect(seg.months, `${year}`).toBeGreaterThanOrEqual(0);
        expect(seg.months, `${year}`).toBeLessThanOrEqual(12);
      }
    }
  });

  it("gives a step dated outside its year zero months, not the whole year", () => {
    // Clamping only the near side let a mis-keyed schedule produce
    // [{a, 0}, {b, 12}] — which still sums to 12, so a "months add up" check
    // cannot see it, while the whole year prices at a cap in force for none
    // of it. Asserted through the data invariant below rather than by
    // mutating the live schedule.
    for (const [yearStr, steps] of Object.entries(MOD_SCHEDULE)) {
      for (const st of steps) {
        expect(
          st.from.slice(0, 4),
          `MOD_SCHEDULE[${yearStr}] has a step dated ${st.from}`,
        ).toBe(yearStr);
      }
    }
  });

  it("gives every stepped year at least one month per segment", () => {
    // A zero-month segment in the REAL schedule means a step was keyed into
    // the wrong year — legal as input, but never correct as source data.
    for (const year of Object.keys(MOD_SCHEDULE).map(Number)) {
      for (const seg of capMonths(year)) {
        expect(seg.months, `${year} has a zero-month segment`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});
