// The sliver caption is the tile's thesis in one sentence: the group's whole
// procurement line is a rounding error against the function it sits in. It used to
// state both halves of that as LITERALS — „под 0,2%" and „€15 млрд." — beside a
// `whole` the tile computes from COFOG and renders three lines above. They agreed
// on the 2024 vintage and nothing would have caught the next one: the bar would say
// one total while the sentence named another.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SocialHeroTile } from "./SocialHeroTile";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

let gf10: { year: number; valueEur: number }[] = [];
vi.mock("@/data/macro/useCofog", () => ({
  useCofog: () => ({ data: { series: { GF10: gf10 } } }),
}));

let budgetYears: {
  fiscalYear: number;
  expenditure: { amountEur: number };
}[] = [];
vi.mock("@/data/budget/useBudget", () => ({
  useBudgetMinistryRollup: () => ({ data: { years: budgetYears } }),
}));

const renderHero = (props: { procEur: number; perYear: boolean }) =>
  render(
    <MemoryRouter>
      <SocialHeroTile {...props} />
    </MemoryRouter>,
  );

// Intl separates a compact figure with a NON-BREAKING space, so a literal
// "18,4 млрд." typed with an ordinary space never matches the DOM.
const flat = (el: HTMLElement) =>
  (el.textContent ?? "").replace(/[\s\u00a0\u202f]+/g, " ");

beforeEach(() => {
  lang = "bg";
  gf10 = [{ year: 2024, valueEur: 15_091_900_000 }];
  budgetYears = [{ fiscalYear: 2024, expenditure: { amountEur: 1_463_430_360 } }]; // prettier-ignore
});

describe("SocialHeroTile — the sliver caption derives both of its figures", () => {
  it("names the SAME whole the bar is drawn from", () => {
    const { container } = renderHero({ procEur: 20_108_827, perYear: true });
    // €15.09bn renders compactly; the assertion is that the caption's total and
    // the bar's total are one number, so both occurrences carry the same text.
    const t = flat(container);
    expect(t).toContain("15,1 млрд.");
    // …and the literal that used to be written down is gone.
    expect(t).not.toContain("€15 млрд.");
  });

  it("moves the named total when COFOG moves", () => {
    gf10 = [{ year: 2025, valueEur: 18_400_000_000 }];
    budgetYears = [{ fiscalYear: 2025, expenditure: { amountEur: 1_796_645_056 } }]; // prettier-ignore
    const { container } = renderHero({ procEur: 20_108_827, perYear: true });
    const t = flat(container);
    expect(t).toContain("18,4 млрд.");
    expect(t).not.toContain("15,1 млрд.");
  });

  it("moves the share with it, rather than asserting a threshold", () => {
    const { container } = renderHero({ procEur: 20_108_827, perYear: true });
    // 20,108,827 / 15,091,900,000 = 0.133%
    expect(flat(container)).toContain("0,1%");
    expect(flat(container)).not.toContain("под 0,2%");
  });

  it("adds a digit rather than rounding a tiny share to zero", () => {
    // A narrow scope: €1M against €15.09bn is 0.0066%. At one decimal that prints
    // „0,0%", which reads as none — the opposite of what the sliver is for.
    const { container } = renderHero({ procEur: 1_000_000, perYear: true });
    expect(flat(container)).toContain("0,01%");
  });
});

describe("SocialHeroTile — EN says the same as BG", () => {
  it("names the same total and share in both languages", () => {
    lang = "bg";
    const bgText = flat(renderHero({ procEur: 20_108_827, perYear: true }).container); // prettier-ignore
    lang = "en";
    const enText = flat(renderHero({ procEur: 20_108_827, perYear: true }).container); // prettier-ignore
    // Different separators per locale, so compare the digits rather than the string.
    const digits = (s: string) => (s.match(/\d[\d.,]*/g) ?? []).join("|");
    expect(digits(bgText).replace(/,/g, ".")).toBe(
      digits(enText).replace(/,/g, "."),
    );
  });
});

describe("SocialHeroTile — no sliver, no claim", () => {
  it("renders no procurement sentence when the scope has none", () => {
    const { container } = renderHero({ procEur: 0, perYear: true });
    expect(flat(container)).not.toContain("Обществените поръчки");
  });
});
