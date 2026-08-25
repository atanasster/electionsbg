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
    eikExactAlsoByName: 46,
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

/** The stats the mocked hook returns. Mutable so a test can drive the two states
 *  the component branches on that `STATS` alone cannot reach: a blob minted
 *  before `eikExactAlsoByName` existed, and an overlap gap above one. Reset in
 *  `beforeEach` below, so a test that swaps it cannot leak into the next. */
let statsFixture: CultureHubStats = STATS;

vi.mock("@/data/culture/hubStats", () => ({
  useCultureHubStats: () => ({ data: statsFixture, isLoading: false }),
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

// ── the EIK↔name relationship the page states in words ───────────────────────
//
// Until 2026-08-25 the ИСУН-by-EIK row said „Подмножество на реда отдолу" / „A
// subset of the row below". Measured, it is 46 of 47 — one register body (a
// national art school whose name carries no culture stem) sits outside the name
// rule. „A subset" is the sentence that lets a reader reason about €106m and
// €147m together, so getting it wrong is not a copy nit; it is the wrong
// relationship between the page's two largest numbers.
//
// BOTH the figures and the RELATIONSHIP CLAUSE are derived from the blob, so
// these assert the composed sentence rather than re-freezing „46 of 47" here.
describe("CultureFundsScreen — the EIK↔name overlap claim", () => {
  const rowsText = (): string =>
    Array.from(document.querySelectorAll("li"))
      .map((li) => li.textContent ?? "")
      .join("\n");

  beforeEach(() => {
    lang = "en";
    statsFixture = STATS;
  });

  it.each(["en", "bg"] as const)(
    "never calls the EIK arm a plain subset in %s",
    (locale) => {
      lang = locale;
      mount();
      const text = rowsText();
      // The bare claim, with no qualifier. `almost`/„почти" is what makes the
      // sentence true, so its absence beside the word is the regression.
      const bare =
        locale === "en"
          ? /(?<!almost, but not quite, )a subset of the row below/i
          : /(?<!почти, но не изцяло )подмножество на реда отдолу/i;
      expect(
        text,
        "the ИСУН-by-EIK row calls itself a subset of the name-matched row " +
          "with no qualifier — measured, one of its projects is outside the " +
          "name rule, so the two arms overlap heavily and neither contains " +
          "the other",
      ).not.toMatch(bare);
    },
  );

  it("keeps the subset wording under test actually present — the gate is not vacuous", () => {
    // The companion the spine block above already carries: an inverse gate whose
    // antecedent never fires is green for ever. If the copy stops using the word
    // „subset" at all, the lookbehind above guards nothing and needs re-pointing
    // rather than silently passing.
    mount();
    expect(
      rowsText(),
      'the ИСУН-by-EIK row no longer uses the word "subset" at all, so the ' +
        "un-qualified-subset gate above guards nothing — re-point it at the " +
        "current wording",
    ).toMatch(/a subset of the row below/i);
  });

  it.each(["en", "bg"] as const)(
    "renders the measured overlap as a composed phrase in %s",
    (locale) => {
      lang = locale;
      mount();
      // ⚠️ NOT `toContain("47")`. `rowsText()` joins every row, and the fixture's
      // byNameEur renders as „€147.1M" / „€147,1 млн." — so a bare substring
      // check on the denominator passes in both locales even with the figure
      // deleted from the EIK row entirely. The phrase is what carries „46 OF 47".
      const c = STATS.funds;
      const phrase =
        locale === "en"
          ? new RegExp(
              `${c.eikExactAlsoByName} of these ${c.eikExactProjects} projects are also name-matched`,
            )
          : new RegExp(
              `${c.eikExactAlsoByName} от ${c.eikExactProjects} от тези проекта се хващат и по име`,
            );
      expect(rowsText()).toMatch(phrase);
    },
  );

  it.each(["en", "bg"] as const)(
    "names the single missed project in the singular, in %s",
    (locale) => {
      lang = locale;
      mount();
      // 47 − 46 = 1, which is the value the page carries today and the one the
      // whole finding is about. Neither language pluralises by template:
      // Bulgarian would give „1 проекта … нямат" (бройна форма plus a plural
      // verb) and English „1 … projects carry".
      const phrase =
        locale === "en"
          ? /does not contain it entirely: one EIK-listed project carries no culture word in its name/
          : /Не го съдържа изцяло: един проект от списъка по ЕИК няма културна дума в името си/;
      expect(rowsText()).toMatch(phrase);
      expect(rowsText()).not.toMatch(
        locale === "en" ? /1 of the EIK-listed projects carry/ : /1 проекта/,
      );
    },
  );

  it.each(["en", "bg"] as const)(
    "switches to the plural when more than one project is missed, in %s",
    (locale) => {
      lang = locale;
      statsFixture = {
        ...STATS,
        funds: { ...STATS.funds, eikExactAlsoByName: 44 },
      };
      mount();
      const phrase =
        locale === "en"
          ? /3 of the EIK-listed projects carry no culture word in their name/
          : /3 проекта от списъка по ЕИК нямат културна дума в името си/;
      expect(rowsText()).toMatch(phrase);
    },
  );

  it("drops the relationship entirely when the arms turn out to be nested", () => {
    // The state the frozen clause could not survive: one register body gaining a
    // culture word makes the overlap complete, and „47 of these 47 … almost, but
    // not quite, a subset" contradicts itself in one sentence.
    statsFixture = {
      ...STATS,
      funds: {
        ...STATS.funds,
        eikExactAlsoByName: STATS.funds.eikExactProjects,
      },
    };
    mount();
    const text = rowsText();
    expect(text).toMatch(/are also name-matched — a subset of the row below/);
    expect(text).not.toMatch(/almost, but not quite/);
    expect(text).toMatch(/It contains the row above entirely/);
  });

  it("renders without the overlap clause when the served blob predates the field", () => {
    // Not hypothetical: the blob ships via `bucket:sync`, a different command
    // from `npm run deploy`, so a bundle can load against a blob minted before
    // the field existed. It must not throw — there is no error boundary in
    // `src/`, so an uncaught render throw unmounts the React root and blanks the
    // whole SPA rather than one card.
    statsFixture = {
      ...STATS,
      funds: { ...STATS.funds, eikExactAlsoByName: undefined },
    };
    lang = "bg";
    expect(() => mount()).not.toThrow();
    const text = rowsText();
    expect(text).not.toMatch(/NaN|undefined/);
    // The row keeps its own true sentence and says NOTHING about the
    // relationship — asserted as the whole basis paragraph, not as a substring,
    // because the failure being pinned is a trailing clause. („—" would be
    // `formatInt`'s absent marker, but it cannot be checked for on its own: the
    // em-dash is ordinary punctuation everywhere else on this page.)
    const eikBasis = Array.from(
      document.querySelectorAll("li")[0]?.querySelectorAll("p") ?? [],
    ).at(-1)?.textContent;
    expect(eikBasis).toBe(
      "Възпроизводимо: точно съвпадение по ЕИК срещу списъка на сектора.",
    );
    expect(text).not.toMatch(/подмножество/);
  });
});
