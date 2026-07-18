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
  resolveMod,
  computeLabourTax,
  computeVat,
  computeCompanyTax,
  computePension,
} from "./bgTax";

describe("resolveMod", () => {
  it("defaults to the latest table year when the year is null/undefined", () => {
    const latest = 2026;
    expect(resolveMod(null)).toEqual({
      mod: MOD_BY_YEAR[latest],
      year: latest,
      exact: false,
    });
    expect(resolveMod(undefined)).toEqual({
      mod: MOD_BY_YEAR[latest],
      year: latest,
      exact: false,
    });
  });

  it("returns the exact value for a year present in the table", () => {
    expect(resolveMod(2025)).toEqual({ mod: 2112, year: 2025, exact: true });
    expect(resolveMod(2018)).toEqual({ mod: 1329, year: 2018, exact: true });
    expect(resolveMod(2022)).toEqual({ mod: 1738, year: 2022, exact: true });
  });

  it("snaps a year below the table to the earliest known year", () => {
    const res = resolveMod(2005);
    expect(res).toEqual({ mod: MOD_BY_YEAR[2018], year: 2018, exact: false });
  });

  it("snaps a year above the table to the latest known year", () => {
    const res = resolveMod(2030);
    expect(res).toEqual({ mod: MOD_BY_YEAR[2026], year: 2026, exact: false });
  });

  it("never reports a year whose cap it is not actually showing", () => {
    // The whole point of `exact`/`year`: a snapped resolution must name the
    // year the value is drawn from, not the year that was asked for.
    const res = resolveMod(2040);
    expect(res.exact).toBe(false);
    expect(MOD_BY_YEAR[res.year]).toBe(res.mod);
    expect(res.year).not.toBe(2040);
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
    expect(r.pensionContribEmployee).toBeCloseTo(1100 * PENSION_EMPLOYEE_RATE, 6);
    expect(r.pensionContribEmployer).toBeCloseTo(1100 * PENSION_EMPLOYER_RATE, 6);
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
    expect(r.pensionContribEmployee).toBeCloseTo(mod * PENSION_EMPLOYEE_RATE, 6);
    expect(r.pensionContribEmployer).toBeCloseTo(mod * PENSION_EMPLOYER_RATE, 6);
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
    expect(r.ssc).toBeCloseTo(MIN_SELF_INSURED_INCOME * SSC_SELF_INSURED_RATE, 6);
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
      853.578 * VAT_CONSUMPTION_SHARE * (VAT_STANDARD_RATE / (1 + VAT_STANDARD_RATE)),
      6,
    );
    expect(vat).toBeCloseTo(106.7, 1);
  });

  it("scales linearly with a custom consumption share", () => {
    expect(computeVat(1000, 0.5)).toBeCloseTo(
      2 * computeVat(1000, 0.25),
      6,
    );
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
    expect(r.dividendTax).toBeCloseTo((5000 - r.corpTax) * DIVIDEND_TAX_RATE, 6);
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
    // The transitional 2026 cap equals the 2025 cap (frozen extension law).
    expect(MOD_BY_YEAR[2026]).toBe(MOD_BY_YEAR[2025]);
  });

  it("has plausible rate magnitudes (guards against a typo'd constant)", () => {
    expect(PIT_RATE).toBe(0.1);
    expect(SSC_EMPLOYEE_RATE).toBeGreaterThan(0);
    expect(SSC_EMPLOYEE_RATE).toBeLessThan(SSC_SELF_INSURED_RATE);
    expect(SSC_EMPLOYER_RATE).toBeGreaterThan(0);
    expect(MIN_PENSION).toBeLessThan(MAX_PENSION);
  });
});
