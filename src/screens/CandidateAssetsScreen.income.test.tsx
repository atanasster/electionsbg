// The income header on /candidate/:id/assets. This surface carried the same defect as the
// card — a single figure computed as declarant + spouse — and had NO test file, so the merge
// could have come back here with a green suite. It also had the weaker fix of the two: the
// two operands were joined by an arithmetic `+`, which invites the reader to do exactly the
// addition the change removed, and the declarant's own figure carried no label at all.
//
// Hermetic: only i18n is stubbed, so formatEur/formatEurSigned run for real and the
// assertions below are the actual bg-BG renderings.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MpDeclaration } from "@/data/dataTypes";
import { formatEur, formatEurSigned } from "@/lib/currency";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "bg" },
  }),
}));

import { IncomeTable } from "./CandidateAssetsScreen";

const decl = (declarant: number, spouse: number): MpDeclaration =>
  ({
    declarantName: "Илияна Малинова Йотова",
    sourceUrl: "https://register.cacbg.bg/2026/x.xml",
    assets: [],
    ownershipStakes: [],
    events: [],
    income: [
      {
        category: "Годишна данъчна основа от трудови доходи",
        amountEurDeclarant: declarant,
        amountEurSpouse: spouse,
      },
    ],
  }) as unknown as MpDeclaration;

const totals = (declarant: number, spouse: number): string => {
  render(<IncomeTable decl={decl(declarant, spouse)} lang="bg" />);
  return screen.getByTestId("income-totals").textContent ?? "";
};

describe("IncomeTable — the two columns are two people", () => {
  // THE regression, with Йотова's real figures: EUR 104,975 hers, EUR 58,280 her spouse's.
  it("never renders the merged household figure", () => {
    const text = totals(104975, 58280);
    expect(text).toContain(formatEur(104975, "bg"));
    expect(text).not.toContain(formatEur(163255, "bg"));
  });

  it("labels the declarant's figure rather than leaving it bare", () => {
    expect(totals(104975, 58280)).toContain("mp_income_declarant");
  });

  // The `+` read as an instruction to add. Nothing between the two figures may.
  it("does not join the two figures with an arithmetic operator", () => {
    expect(totals(104975, 58280)).not.toContain("+");
  });

  it("omits the spouse entirely when there is no spouse income", () => {
    const text = totals(104975, 0);
    expect(text).toContain("mp_income_declarant");
    expect(text).not.toContain("mp_income_spouse");
  });

  // A tax base can be negative; `> 0` hid it here while the row below still rendered it.
  it("shows a negative spouse total with its sign", () => {
    const text = totals(104975, -5000);
    expect(text).toContain("mp_income_spouse");
    expect(text).toContain(formatEurSigned(-5000, "bg"));
  });
});
