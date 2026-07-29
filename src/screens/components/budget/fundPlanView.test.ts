// The ЗБДОО plan block's two basis-critical rules. Nothing in this change was
// covered by `npm run test:unit` before — the smoke script guards the DATA, but
// a rendering rule that silently inverts (showing the НОИ line as a fund, or
// printing the 2026 law under a 2019 heading) is a presentation bug the data
// gate cannot see.
import { describe, expect, it } from "vitest";
import { selectFundPlanYear, peerFundLines } from "./fundPlanView";
import type { NoiFundPlanFile, NoiFundPlanYear } from "@/data/budget/types";

const eur = (amountEur: number) => ({
  amount: amountEur,
  amountEur,
  currency: "EUR" as const,
});

const Y2026: NoiFundPlanYear = {
  fiscalYear: 2026,
  basis: "law",
  law: "ЗБДОО 2026",
  idMat: "244982",
  dvIssue: "ДВ бр. 68 от 28.07.2026",
  sumOfFunds: eur(15_265_782_400),
  lines: [
    {
      id: "pensions",
      bg: "Пенсии",
      en: "Pensions",
      isPeerFund: true,
      amount: eur(5_572_766_500),
    },
    {
      id: "unemployment",
      bg: "Безработица",
      en: "Unemployment",
      isPeerFund: true,
      amount: eur(355_504_700),
    },
    {
      id: "noi",
      bg: "НОИ",
      en: "НОИ",
      isPeerFund: false,
      amount: eur(6_610_463_300),
    },
  ],
};

const FILE: NoiFundPlanFile = {
  generatedAt: "2026-07-29T00:00:00.000Z",
  source: { publisher: "", law: "", url: "", description: "" },
  latestYear: 2026,
  years: [Y2026],
};

describe("selectFundPlanYear", () => {
  it("returns the plan for an exact year match", () => {
    expect(selectFundPlanYear(FILE, 2026)?.fiscalYear).toBe(2026);
  });

  it("does NOT fall back to the latest year", () => {
    // The regression this guards: a latest-year fallback printed the 2026
    // ЗБДОО under a "2019" heading on every earlier budget year.
    expect(selectFundPlanYear(FILE, 2019)).toBeNull();
    expect(selectFundPlanYear(FILE, 2025)).toBeNull();
    expect(selectFundPlanYear(FILE, 2027)).toBeNull();
  });

  it("tolerates a missing or not-yet-loaded file", () => {
    expect(selectFundPlanYear(null, 2026)).toBeNull();
    expect(selectFundPlanYear(undefined, 2026)).toBeNull();
  });
});

describe("peerFundLines", () => {
  it("excludes the НОИ line", () => {
    const ids = peerFundLines(Y2026).map((l) => l.id);
    expect(ids).toEqual(["pensions", "unemployment"]);
    expect(ids).not.toContain("noi");
  });

  it("excludes the line that would otherwise be the LARGEST entry", () => {
    // The reason the flag exists: НОИ is bigger than every real fund, so an
    // unfiltered list reads as "НОИ spends more than the pension fund".
    const biggest = [...Y2026.lines].sort(
      (a, b) => b.amount.amountEur - a.amount.amountEur,
    )[0];
    expect(biggest.id).toBe("noi");
    expect(peerFundLines(Y2026)).not.toContainEqual(biggest);
  });

  it("leaves the peer lines short of the headline — they are not the whole", () => {
    // A direct consequence of the gross-sum basis: the visible list does not
    // add up to the stated total, and that is correct. The caption carries the
    // explanation; this pins the arithmetic it is explaining.
    const peerSum = peerFundLines(Y2026).reduce(
      (s, l) => s + l.amount.amountEur,
      0,
    );
    expect(peerSum).toBeLessThan(Y2026.sumOfFunds.amountEur);
  });
});
