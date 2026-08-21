// /culture/funds — the „Проследи парите" section, and why it is worth a test.
//
// The spine (`grant_contract_link`, migration 166) has no serving reader yet, so
// nothing on this page RENDERS a linked contract. What the page does is describe
// the chain — and until 2026-08-21 it described it as clean: „the code … links
// grant, procedure, contract and contractor into one chain", with the RRF-slice
// caveat and nothing else.
//
// That was the claim the corpus does not support. Measured: 15 links over 10
// codes name a buyer that is NOT the grant's beneficiary, €4.03m of procurement,
// including three tenders by ДКТ „Иван Радоев" Плевен hanging off Държавен
// сатиричен театър's grant. ИСУН publishes no partner list, so a mistyped code
// and a project partner are indistinguishable — which is why the loader
// downgrades rather than drops, and why the SECOND paragraph exists.
//
// Its own source comment says it „is what stops the page claiming otherwise
// while no tile yet renders the split". Nothing asserted it was on the page.
// This does — in the shape `ProcedureBaseRates.test.tsx` uses for „одобрен":
// the CLAIM may not appear without the QUALIFIER beside it.
//
// Language is driven explicitly rather than left to the harness default. The
// screen branches on `i18n.language` and ships both strings by hand, so a test
// written against one locale says nothing about the other — and the sibling
// CultureHubScreen.test.tsx records that the default here is `en`, i.e. the
// Bulgarian half is the one that would silently go unchecked.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { CultureHubStats } from "@/data/culture/hubStats";

let lang = "en";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: lang }, t: (k: string) => k }),
}));
vi.mock("@/screens/components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

// Figures are irrelevant here — the section under test renders no number. What
// matters is that `stats` is non-null: the whole body sits behind `{s && …}`, so
// an unstubbed render has nothing to assert against and would pass vacuously.
const STATS: CultureHubStats = {
  generatedAt: "2026-08-21",
  procurement: {
    contracts: 971,
    eur: 166_700_000,
    buyers: 59,
    suppliers: 400,
    singleBid: 42,
    bidKnown: 100,
    nationalSingleBid: 409,
    nationalBidKnown: 1000,
    firstDate: "2007-01-01",
  },
  risk: { grades: {} },
  funds: {
    eikExactEur: 106_000_000,
    eikExactProjects: 47,
    byNameEur: 147_100_000,
    byNameProjects: 1559,
    chitalishtaEur: 22_100_000,
  },
  agri: { chitalishtaEur: 18_300_000, chitalishtaRows: 264 },
  interreg: {
    thematicEur: 48_800_000,
    partnerRows: 202,
    partners: 168,
    rowsWithEik: 37,
  },
  people: { culturalInstituteRoles: 59 },
};

vi.mock("@/data/culture/hubStats", () => ({
  useCultureHubStats: () => ({ data: STATS, isLoading: false }),
}));

const { CultureFundsScreen } = await import("./CultureFundsScreen");

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/culture/funds"]}>
      <CultureFundsScreen />
    </MemoryRouter>,
  );

/** The rendered text of the „follow the money" section only. Scoped on purpose:
 *  a qualifier living somewhere else on the page does not qualify this claim. */
const spineText = (): string => {
  const section = document.getElementById("spine");
  expect(
    section,
    "the #spine section is gone from /culture/funds",
  ).not.toBeNull();
  return (section as HTMLElement).textContent ?? "";
};

// The unqualified claim, and the qualifier that has to accompany it, per locale.
const COPY = {
  en: {
    claim: /links grant, procedure, contract and contractor into one chain/i,
    qualifier: /not by itself proof of whose money was spent/i,
    partners: /publishes the lead beneficiary only/i,
    onlyWhen: /only where the buyer IS the grant's beneficiary/i,
  },
  bg: {
    claim: /се свързват в една верига/i,
    qualifier: /не доказва кой е похарчил парите/i,
    partners: /публикува само водещия бенефициент/i,
    onlyWhen: /само когато възложителят съвпада с бенефициента/i,
  },
} as const;

describe("CultureFundsScreen — the spine attribution caveat", () => {
  beforeEach(() => {
    lang = "en";
  });

  it.each(["en", "bg"] as const)(
    "renders the attribution caveat in %s",
    (locale) => {
      lang = locale;
      mount();
      const text = spineText();
      const c = COPY[locale];
      expect(text).toMatch(c.qualifier);
      // The two halves that make the caveat mean something rather than hedge:
      // WHY the two cases cannot be told apart, and WHAT the page counts as an
      // attribution instead.
      expect(text).toMatch(c.partners);
      expect(text).toMatch(c.onlyWhen);
    },
  );

  it.each(["en", "bg"] as const)(
    "never states the one-chain claim in %s without the qualifier beside it",
    (locale) => {
      lang = locale;
      mount();
      const text = spineText();
      const c = COPY[locale];
      // The inverse gate. Deleting the caveat while keeping the claim is the
      // regression — the page then asserts the chain is proof, which is what
      // published €4.03m against the wrong institutions' grants.
      if (c.claim.test(text))
        expect(
          text,
          "the #spine section states that the code links grant → contractor " +
            "into one chain, with no qualifier saying a code in the text is not " +
            "proof of whose money was spent",
        ).toMatch(c.qualifier);
    },
  );

  it("keeps the claim under test actually present — the gate is not vacuous", () => {
    // §13: an inverse gate whose antecedent never fires is green for ever. If
    // the copy is rewritten so the chain claim disappears, this fails and the
    // regex above needs re-pointing rather than silently guarding nothing.
    lang = "en";
    mount();
    expect(
      spineText(),
      "the one-chain claim is no longer on the page, so the inverse gate above " +
        "guards nothing — re-point COPY.claim at the current wording",
    ).toMatch(COPY.en.claim);
  });
});
