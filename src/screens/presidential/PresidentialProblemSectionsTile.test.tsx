// What „Проблемни секции" must never draw without, and the states its copy has to tell apart.
//
// ⚠ EVERY ASSERTION HERE WAS INHERITED FROM `PresidentialNeighborhoodsTile`, which this tile and
// its sibling replaced. The tile's shape changed to match the parliamentary dashboard's; what it
// must never publish did not.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatInt, formatPct } from "@/lib/currency";
import { PresidentialProblemSectionsTile } from "./PresidentialProblemSectionsTile";
import {
  scopeNeighborhoods,
  type NeighborhoodScope,
} from "@/data/presidential/neighborhoodScope";
import type {
  NeighborhoodRates,
  PresidentialNeighborhoods,
} from "@/data/presidential/useNeighborhoods";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const rates = (over: Partial<NeighborhoodRates> = {}): NeighborhoodRates => ({
  turnoutPct: 48.09,
  invalidPct: 5.31,
  additionalPct: 2.73,
  paperBallots: 45979,
  actualVoters: 40012,
  ...over,
});

const neighborhoods = (
  over: Partial<PresidentialNeighborhoods> = {},
): PresidentialNeighborhoods => ({
  cycle: "2016_11_06_pvr",
  round: 1,
  basis: "БЪЛГАРСКАТА ОГРАДА",
  basisEn: "THE ENGLISH CAVEAT",
  coverage: {
    catalogue: 8,
    located: 1,
    missing: [],
    sections: 133,
    sectionsInCycle: 12015,
    validVotes: 40734,
    pctOfValid: 1.16,
  },
  national: rates({
    turnoutPct: 56.26,
    invalidPct: 3.05,
    paperBallots: 3786996,
  }),
  totals: rates(),
  tickets: [
    {
      number: 17,
      president: "Цецка Цачева Данговска",
      votes: 10139,
      pct: 24.89,
      pctNational: 21.96,
    },
  ],
  places: [
    {
      id: "stolipinovo",
      name_bg: "Столипиново / Шекер махала",
      name_en: "Stolipinovo / Sheker mahala",
      city_bg: "Пловдив",
      city_en: "Plovdiv",
      sourceUrl: "https://www.segabg.com/hot/x",
      sections: 70,
      valid: 18997,
      ...rates(),
      oblasts: ["PDV-00"],
      obshtini: ["PDV22"],
      ekattes: ["56784"],
      tickets: [
        {
          number: 13,
          president: "Румен Георгиев Радев",
          votes: 5025,
          pct: 26.45,
          pctNational: 25.44,
        },
      ],
      leader: {
        number: 13,
        president: "Румен Георгиев Радев",
        votes: 5025,
        pct: 26.45,
      },
    },
  ],
  ...over,
});

// ⚠ BOTH WRAPPERS. `Hint` is a Radix tooltip and Radix THROWS without its provider; and the
// candidate names go through `PresidentialPersonName`, which renders a react-router `Link` for a
// name the corpus resolves — without a router that throws „Cannot destructure property
// 'basename'", i.e. missing scaffolding reported as a broken tile.
const mount = (
  n: PresidentialNeighborhoods,
  scope: NeighborhoodScope = { level: "country" },
) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PresidentialProblemSectionsTile
          neighborhoods={n}
          scoped={scopeNeighborhoods(n, scope)}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
});

describe("PresidentialProblemSectionsTile", () => {
  it("renders the caveat from the artifact, ABOVE the district table", () => {
    // ⚠⚠ THE TILE NAMES ROMA DISTRICTS. A reader who stops at the first row must already have
    // read that these are sums over polling stations rather than a claim about a community.
    mount(neighborhoods());
    const caveat = screen.getByText("БЪЛГАРСКАТА ОГРАДА");
    const place = screen.getByText("Столипиново / Шекер махала");
    expect(
      caveat.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the ENGLISH caveat and the English names on the English page", async () => {
    await i18n.changeLanguage("en");
    mount(neighborhoods());
    expect(screen.getByText("THE ENGLISH CAVEAT")).toBeTruthy();
    expect(screen.queryByText("БЪЛГАРСКАТА ОГРАДА")).toBeNull();
    expect(screen.getByText("Stolipinovo / Sheker mahala")).toBeTruthy();
  });

  it("links every district to the report that named it", () => {
    // ⚠⚠ „РИСКОВ" IS SOMEBODY ELSE'S PUBLISHED FINDING. Without the link this site presents it
    // as its own.
    mount(neighborhoods());
    const link = screen.getByText(bgCorpus.source);
    expect(link.getAttribute("href")).toBe("https://www.segabg.com/hot/x");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("prints the leader's VOTE COUNT beside the share, not the share alone", () => {
    // ⚠ THE COLUMN THE PARLIAMENTARY TILE HAS AND THIS ONE DID NOT. `pct` is rounded to two
    // places, so a count re-derived from it in the browser would be off by a few votes on a
    // table that publishes exact counts in every other column — which is why the producer emits
    // `leader.votes` rather than letting a surface multiply.
    mount(neighborhoods());
    const row = screen.getByText("Столипиново / Шекер махала").closest("tr");
    expect(row?.textContent).toContain("5025");
    expect(row?.textContent).toContain(formatPct(0.2645, "bg", 1));
    // …and the protocols' own „гласували", which is not the valid-vote count.
    // ⚠ THE FORMATTER, NOT A LITERAL: `bg-BG` groups with a NARROW NO-BREAK SPACE, so a typed
    // „40 012" asserts the wrong character and fails against a correct render.
    expect(row?.textContent).toContain(formatInt(40012, "bg"));
  });

  it("says WHY the invalid rate is missing rather than printing a dash", () => {
    // ⚠⚠ 2021's DISTRICTS FILED 228 PAPER BALLOTS. „—" alone reads as a gap in our data; the
    // sentence says the ballots were not on paper, which is the actual answer.
    mount(
      neighborhoods({ totals: rates({ invalidPct: null, paperBallots: 228 }) }),
    );
    expect(screen.getByText(/228/, { selector: "li" }).textContent).toContain(
      "машини",
    );
  });

  it("prints the invalid rate beside the national one when it IS measurable", () => {
    // The mutation check for the test above: „says why" is also satisfied by a tile that never
    // prints the rate at all.
    mount(neighborhoods());
    const line = screen.getByText(
      (text, el) =>
        el?.tagName === "LI" && text.includes(formatPct(0.0531, "bg", 1)),
    );
    expect(line.textContent).toContain(formatPct(0.0305, "bg", 1));
  });

  it("answers the invalid-ballot column in its own terms, not with a fragment", () => {
    // ⚠⚠ ON 2021 ALL EIGHT ROWS ARE IN THIS STATE AT ONCE, so a „—" column reads as eight holes
    // in our data under a „Недействителни" header.
    mount(
      neighborhoods({
        totals: rates({ invalidPct: null, paperBallots: 0 }),
        places: [
          { ...neighborhoods().places[0], invalidPct: null, paperBallots: 0 },
        ],
      }),
    );
    const cell = screen.getByText(bgCorpus.presidential_hoods_invalid_no_paper);
    expect(cell.getAttribute("title")).toContain("машини");
  });

  it("names its basis as the DOMESTIC sections, not the country at large", () => {
    // ⚠ THE PUBLISHED NATIONAL TURNOUT INCLUDES ABROAD and is rendered a few sections down the
    // same page — 40,3% against 37,2% on 2021 round 1.
    mount(neighborhoods());
    const turnout = screen
      .getAllByRole("listitem")
      .find((li) => /Активност/.test(li.textContent ?? ""));
    expect(turnout?.textContent).toContain("в секциите в страната");
  });

  it("states coverage, and NAMES what could not be located", () => {
    // ⚠⚠ „Three could not be located" invites a reader to assume the three are like the five.
    mount(
      neighborhoods({
        coverage: {
          catalogue: 8,
          located: 5,
          missing: [
            { id: "fakulteta", name_bg: "Факултета", name_en: "Fakulteta" },
          ],
          sections: 107,
          sectionsInCycle: 11623,
          validVotes: 31798,
          pctOfValid: 0.96,
        },
      }),
    );
    expect(screen.getByText(/107/)).toBeTruthy();
    expect(screen.getByText(/Факултета/)).toBeTruthy();
  });

  it("takes the district count from the payload, not from the copy", () => {
    // `PROBLEM_NEIGHBORHOODS` is a shared catalogue this tile does not own; a hard-coded „осем"
    // would go quietly false on the most sensitive string on the page.
    mount(
      neighborhoods({
        coverage: { ...neighborhoods().coverage, catalogue: 9 },
      }),
    );
    expect(screen.getByText(/9/, { selector: "p" }).textContent).toContain("9");
  });

  it("links the leading pair, like every other candidate name on the page", () => {
    // ⚠ ONE COMPONENT OWNS THE DECISION. `PresidentialPersonName` refuses a name the corpus
    // cannot resolve to exactly one person, so a candidate who is a link in the ranking above
    // and bare text here would read as two different people.
    mount(neighborhoods());
    const cell = screen
      .getAllByRole("cell")
      .find((c) => c.textContent?.includes("Румен Георгиев Радев"));
    // ⚠ AN ACTUAL LINK, not merely the name in a cell. Радев resolves to `/person/mp-5142` in
    // the committed corpus, so a tile that stopped linking would still pass a text assertion.
    expect(cell?.querySelector("a")?.getAttribute("href")).toBe(
      "/person/mp-5142",
    );
  });

  it("at PLACE scope, drops the national rate lines and counts only what is here", () => {
    // ⚠⚠ THE RATE LINES ARE STATEMENTS ABOUT THE WHOLE MATCHED SET AGAINST THE WHOLE COUNTRY.
    // Rendered under an oblast's name they would attribute the country's comparison to one
    // place — and re-deriving them here would need the producer's two publication floors
    // restated in the browser.
    mount(neighborhoods(), { level: "region", id: "PDV-00" });
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(
      screen.queryByText(
        new RegExp(bgCorpus.presidential_hoods_coverage.slice(0, 12)),
      ),
    ).toBeNull();
    // The place-scoped sentence says how many of the CATALOGUE are here, not „8 of 8 located".
    expect(screen.getByText(/1 от 8/)).toBeTruthy();
    expect(screen.getByText("Столипиново / Шекер махала")).toBeTruthy();
  });

  it("renders NOTHING for a place holding no district", () => {
    // ⚠⚠ THE COMMON CASE — eight districts sit in five oblasts. „Няма рискови квартали" reads
    // as a finding about a place nobody screened.
    const { container } = mount(neighborhoods(), {
      level: "region",
      id: "BLG",
    });
    expect(container.textContent).toBe("");
  });

  it("renders NOTHING when no district could be located", () => {
    const { container } = mount(
      neighborhoods({
        coverage: {
          catalogue: 8,
          located: 0,
          missing: [],
          sections: 0,
          sectionsInCycle: 11623,
          validVotes: 0,
          pctOfValid: 0,
        },
        places: [],
      }),
    );
    expect(container.textContent).toBe("");
  });
});
