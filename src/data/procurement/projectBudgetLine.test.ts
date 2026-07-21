import { describe, it, expect } from "vitest";
import {
  resolveBudgetLine,
  safeFiscalYear,
  type InvestmentProgram,
} from "./projectBudgetLine";

const program: InvestmentProgram = {
  fiscalYear: 2025,
  source: { url: "https://dv.parliament.bg/DVPics/2025/26_25/1619.pdf" },
  topProjects: [
    {
      projectId: "OP-24.001-2724",
      name: "Нова учебна база на математическа гимназия",
      cost: { amountEur: 50355092 },
    },
    { projectId: "OP-24.001-0139", name: "Студентски кампус Бургас" },
  ],
};

describe("resolveBudgetLine", () => {
  it("resolves a projectId to its capital line with amount + source", () => {
    const r = resolveBudgetLine(
      { fiscalYear: 2025, projectId: "OP-24.001-2724" },
      program,
    );
    expect(r).toMatchObject({
      projectId: "OP-24.001-2724",
      amountEur: 50355092,
      fiscalYear: 2025,
      basis: "ЗДБ 2025, Приложение III",
      sourceUrl: "https://dv.parliament.bg/DVPics/2025/26_25/1619.pdf",
    });
  });

  it("keeps a matched line with no amount (amountEur undefined, not zero)", () => {
    const r = resolveBudgetLine(
      { fiscalYear: 2025, projectId: "OP-24.001-0139" },
      program,
    );
    expect(r?.name).toBe("Студентски кампус Бургас");
    expect(r?.amountEur).toBeUndefined();
  });

  it("returns null when there is nothing to link", () => {
    expect(resolveBudgetLine(undefined, program)).toBeNull(); // no ref
    expect(resolveBudgetLine({ fiscalYear: 2025 }, program)).toBeNull(); // no projectId
    expect(
      resolveBudgetLine(
        { fiscalYear: 2025, projectId: "OP-24.001-2724" },
        null,
      ),
    ).toBeNull(); // no payload
    expect(
      resolveBudgetLine({ fiscalYear: 2025, projectId: "MISSING" }, program),
    ).toBeNull(); // no match
  });
});

describe("safeFiscalYear", () => {
  it("accepts a plausible integer year", () => {
    expect(safeFiscalYear(2025)).toBe(2025);
    expect(safeFiscalYear(2000)).toBe(2000);
    expect(safeFiscalYear(2100)).toBe(2100);
  });

  it("rejects traversal strings, non-integers, and out-of-range years", () => {
    // The security barrier: nothing but a bounded integer reaches the fetch URL.
    expect(safeFiscalYear("../../etc/passwd")).toBeUndefined();
    expect(safeFiscalYear("2025")).toBeUndefined();
    expect(safeFiscalYear(2025.5)).toBeUndefined();
    expect(safeFiscalYear(1999)).toBeUndefined();
    expect(safeFiscalYear(2101)).toBeUndefined();
    expect(safeFiscalYear(NaN)).toBeUndefined();
    expect(safeFiscalYear(undefined)).toBeUndefined();
    expect(safeFiscalYear(null)).toBeUndefined();
  });
});
