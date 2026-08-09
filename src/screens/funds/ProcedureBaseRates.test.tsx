// The base-rate card, and the reference price.
//
// This card publishes a number next to the words „консултантските фирми", which makes the framing
// the whole deliverable. Every case below is a sentence it must not be able to say:
//
//   1. AN APPROVAL RATE. The corpus holds only SIGNED contracts — ИСУН publishes no rejected
//      applications — so „изплатени" is disbursement. Relabelling it as approval would invent a
//      denominator that does not exist anywhere.
//   2. A FAIR PRICE. There is no fee corpus in Bulgaria. We publish the median and the division;
//      any claim about what a fee *should* be would be invented (plan §8.4-4).
//   3. A LONE MEDIAN. „Колко дават" has a long tail, so the median travels with its quartiles.
//   4. A CARD OF ZEROES on a failure — on this page that reads as „nobody applied and nothing was
//      paid", which is a statement, not a loading state.

import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bg from "@/locales/bg/translation.json";
import type { ReactNode } from "react";
import {
  disbursedShare,
  feeOnMedian,
  type FundsProcedureRates,
} from "@/data/funds/useFundsProcedureRates";

const hook = vi.hoisted(() => ({
  mode: "ok" as "ok" | "error",
  data: null as FundsProcedureRates | null,
}));

vi.mock("@/data/funds/useFundsProcedureRates", async (orig) => ({
  ...(await orig<typeof import("@/data/funds/useFundsProcedureRates")>()),
  useFundsProcedureRates: () => ({
    data: hook.mode === "ok" ? hook.data : undefined,
    isError: hook.mode === "error",
  }),
}));

const { ProcedureBaseRates } = await import("./ProcedureBaseRates");

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

const rates = (
  over: Partial<FundsProcedureRates> = {},
): FundsProcedureRates => ({
  procedureCode: "BG16RFPR001-1.004",
  procedureName: null,
  sampleTitle: "Подкрепа за семейно предприятие",
  programName: "Програма „Конкурентоспособност“",
  projectCount: 1869,
  // DELIBERATELY NOT equal to projectCount. The first fixture set them the same, which is the one
  // shape that hides a broken beneficiary count — and the count WAS broken: `count(DISTINCT eik)`
  // dropped the 8.83% of rows with no EIK (физически лица), rendering a flat 0 on 16 procedures
  // while the org mix beneath it read „Физическо лице 1 513 (100%)".
  beneficiaryCount: 1502,
  paidProjectCount: 1023,
  totalEur: 100_000_000,
  grantEur: 90_000_000,
  paidEur: 50_000_000,
  grantP25: 28_286,
  grantMedian: 56_564,
  grantP75: 75_933,
  orgForms: [{ label: "Частно правна", n: 1869, eur: 100_000_000 }],
  orgKinds: [
    { label: "ЕООД", n: 1067 },
    { label: "ООД", n: 729 },
  ],
  oblasti: { BGS: 107, SOFIA_CITY: 240 },
  ...over,
});

const mount = () =>
  render(<ProcedureBaseRates code="BG16RFPR001-1.004" />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>{children}</MemoryRouter>
    ),
  });

beforeEach(() => {
  hook.mode = "ok";
  hook.data = rates();
});

describe("the beneficiary count is its own number", () => {
  it("renders the beneficiary count, not the project count", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/1[\s\u00a0\u202f]?502/u);
    expect(body).toMatch(/по 1[\s\u00a0\u202f]?869 проекта/u);
  });

  it("a zero would be visible, so it must never be a silent artefact", () => {
    // The failure this replaced: 16 procedures showed „Бенефициенти 0" beside „1 513 проекта".
    // Rendering it is correct if it is TRUE; the gate is that the number comes from the payload
    // rather than being a coincidence of the fixture.
    hook.data = rates({ beneficiaryCount: 0 });
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/БЕНЕФИЦИЕНТИ|Бенефициенти/u);
    expect(body).toMatch(/\b0\b/u);
  });
});

describe("the two payment percentages cannot be confused", () => {
  it("names its denominator as the CONTRACT COUNT", () => {
    // The page header already shows „Усвояване" — paid€/contracted€ — and this card shows
    // paid-contracts/contracts. Measured, 664 procedures (30%) differ by 20 points or more and
    // the worst by 164, so two unexplained percentages side by side is the defect.
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/дял от БРОЯ договори/u);
    expect(body).toMatch(/дял от СУМАТА/u);
  });
});

describe("the reference price is arithmetic, not advice", () => {
  it("divides the MEDIAN by each quoted percentage", () => {
    mount();
    const body = document.body.textContent ?? "";
    // 5% of €56,564 = €2,828. Three percentages, so no single one reads as an endorsement.
    expect(body).toMatch(/3%\s*от медианния грант/u);
    expect(body).toMatch(/5%\s*от медианния грант/u);
    expect(body).toMatch(/10%\s*от медианния грант/u);
    expect(body).toMatch(/2[\s\u00a0\u202f]?828/u);
  });

  it("names the UP-FRONT fee the percentage does not cover", () => {
    // The measured quote is „4000 € предварително И 5% от сумата". A card that computes only the
    // percentage tells a reader checking that exact quote that the 5% is in range and nothing
    // about the part payable whether or not they win.
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/предварително/u);
    expect(body).toMatch(/независимо дали проектът бъде одобрен/u);
  });

  it("the title does not single out one percentage", () => {
    // It named „5%" while showing three — undoing the reason there are three.
    mount();
    const heading = document.body.textContent ?? "";
    expect(heading).toMatch(
      /ПРОЦЕНТ ОТ МЕДИАННИЯ ГРАНТ|Процент от медианния грант/iu,
    );
  });

  it("states that it is NOT a recommendation and that we hold no fee data", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/не препоръка/u);
    expect(body).toMatch(/Нямаме данни за реални консултантски хонорари/u);
    // Neither „usual" nor „fair" is ours to say — the earlier copy disclaimed only the second.
    expect(body).toMatch(/нито коя цена е обичайна, нито коя е справедлива/u);
    // The claim we must never make.
    expect(body).not.toMatch(
      /справедлива цена е|честна цена|трябва да платите/u,
    );
  });

  it("omits the whole card when there is no median to divide", () => {
    // Otherwise it is a table of dashes beside a paragraph about consultancy fees, which reads as
    // insinuation rather than arithmetic.
    hook.data = rates({ grantMedian: null, grantP25: null, grantP75: null });
    mount();
    expect(screen.queryByText(/от медианния грант/u)).toBeNull();
    // …while the base-rate half still renders.
    expect(
      screen.getByText(/КАКВО ОБИКНОВЕНО|Какво обикновено/iu),
    ).toBeTruthy();
  });

  it("omits it when the median is zero rather than dividing by nothing", () => {
    hook.data = rates({ grantMedian: 0 });
    mount();
    expect(screen.queryByText(/от медианния грант/u)).toBeNull();
  });

  it("feeOnMedian is exact and returns null when it cannot divide", () => {
    expect(feeOnMedian(rates(), 5)).toBeCloseTo(2828.2, 1);
    expect(feeOnMedian(rates({ grantMedian: null }), 5)).toBeNull();
    expect(feeOnMedian(rates({ grantMedian: 0 }), 5)).toBeNull();
  });
});

describe("no number here is an approval rate", () => {
  it("labels the paid share as DISBURSEMENT and spells out the fraction", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/1023 от 1869 договора са получили плащане/u);
    // The word „одобрен" appears ONLY where it is being ruled out: the org-mix denominator note
    // („не е процент одобрение") and the up-front-fee warning („независимо дали проектът бъде
    // одобрен"). It must never appear as a LABEL for a number.
    const hits = [...body.matchAll(/[^.|]*одобрен\p{L}*[^.|]*/gu)].map((m) =>
      m[0].trim(),
    );
    for (const h of hits)
      expect(
        /не е процент одобрение|независимо дали проектът бъде одобрен/iu.test(
          h,
        ),
        `„${h}" uses „одобрен" outside a disclaimer`,
      ).toBe(true);
    expect(body).not.toMatch(
      /одобрени заявления|успеваемост|шанс за одобрение/u,
    );
  });

  it("disbursedShare is a share of SIGNED contracts", () => {
    expect(disbursedShare(rates())).toBeCloseTo((100 * 1023) / 1869, 5);
    expect(disbursedShare(rates({ projectCount: 0 }))).toBeNull();
  });
});

describe("the distribution, not just its middle", () => {
  it("shows the quartiles beside the median", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/28[\s\u00a0\u202f]?286/u);
    expect(body).toMatch(/75[\s\u00a0\u202f]?933/u);
  });

  it("drops the spread rather than inventing one when a quartile is missing", () => {
    hook.data = rates({ grantP25: null });
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/56[\s\u00a0\u202f]?564/u);
    expect(body).not.toMatch(/–\s*€75/u);
  });

  it("shows who actually won, as a share of the procedure", () => {
    mount();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/ЕООД/u);
    // 1067 of 1869 = 57%.
    expect(body).toMatch(/57%/u);
  });
});

describe("a failure is not a finding", () => {
  it("renders NOTHING on error, never a card of zeroes", () => {
    hook.mode = "error";
    const { container } = mount();
    expect(container.textContent).toBe("");
  });

  it("renders nothing for a procedure the rollup has never seen", () => {
    // The route returns null for an unknown code, and the same silence is right: a card of zeroes
    // would say „nobody applied".
    hook.data = null;
    const { container } = mount();
    expect(container.textContent).toBe("");
  });
});

// ── The ENGLISH copy carries the same guarantees ───────────────────────────────────────────
//
// Every gate above runs against the Bulgarian bundle, so the English one could reintroduce
// „approval rate" or „a fair fee is …" with the suite green. These assert the invariants against
// the SHIPPED en strings directly — no render, because the point is the copy itself.

describe("the English copy makes the same claims and no others", async () => {
  const en = (await import("@/locales/en/translation.json")).default as Record<
    string,
    string
  >;

  it("labels the paid figure as disbursement, never approval", () => {
    // The whole card is only publishable because this number is not a success rate.
    expect(en.rates_disbursed).toMatch(/paid|payment|disburs/i);
    expect(en.rates_disbursed).not.toMatch(/approv|success|accept/i);
    expect(en.rates_disbursed_hint).toMatch(/contract/i);
  });

  it("names the denominator of the org mix and rules out the approval reading", () => {
    expect(en.rates_who_hint).toMatch(/NOT an approval rate/i);
    expect(en.rates_who_hint).toMatch(/rejected applications/i);
  });

  it("distinguishes the two payment percentages", () => {
    expect(en.rates_disbursed_hint).toMatch(/CONTRACT COUNT/);
    expect(en.rates_disbursed_hint).toMatch(/MONEY/);
  });

  it("never claims a price is fair, usual or recommended", () => {
    const feeCopy = [
      en.rates_fee_title,
      en.rates_fee_hint,
      en.rates_fee_upfront,
      en.rates_fee_disclaimer,
    ].join(" ");
    expect(feeCopy).toMatch(/not a recommendation/i);
    expect(feeCopy).toMatch(/no data on actual consultancy fees/i);
    expect(feeCopy).toMatch(
      /neither what price is usual nor what price is fair/i,
    );
    // The claims we must never make, in the forms a well-meaning edit would reach for.
    expect(feeCopy).not.toMatch(
      /a fair (fee|price) is|should (pay|cost)|reasonable fee is|we recommend/i,
    );
  });

  it("names the up-front fee the percentage does not cover", () => {
    expect(en.rates_fee_upfront).toMatch(/up-front/i);
    expect(en.rates_fee_upfront).toMatch(
      /whether or not the project is approved/i,
    );
  });

  it("does not single out one percentage in the title", () => {
    expect(en.rates_fee_title).not.toMatch(/\b\d+\s?%/);
  });
});
