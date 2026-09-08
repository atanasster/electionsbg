// „Проблемни гласове по кандидат" — what its two percentage columns are allowed to mean.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatPct } from "@/lib/currency";
import { PresidentialProblemVotesTile } from "./PresidentialProblemVotesTile";
import {
  scopeNeighborhoods,
  type NeighborhoodScope,
} from "@/data/presidential/neighborhoodScope";
import type {
  NeighborhoodPlace,
  NeighborhoodTicket,
  PresidentialNeighborhoods,
} from "@/data/presidential/useNeighborhoods";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const rates = {
  turnoutPct: 23.85,
  invalidPct: null,
  additionalPct: 4.43,
  paperBallots: 228,
  actualVoters: 22728,
};

const ticket = (
  number: number,
  president: string,
  votes: number,
  pct: number,
  pctNational: number,
): NeighborhoodTicket => ({ number, president, votes, pct, pctNational });

const stolipinovo = (
  over: Partial<NeighborhoodPlace> = {},
): NeighborhoodPlace => ({
  id: "stolipinovo",
  name_bg: "Столипиново",
  name_en: "Stolipinovo",
  city_bg: "Пловдив",
  city_en: "Plovdiv",
  sourceUrl: "https://www.segabg.com/hot/x",
  sections: 70,
  valid: 10000,
  ...rates,
  oblasts: ["PDV-00"],
  obshtini: ["PDV22"],
  ekattes: ["56784"],
  tickets: [
    ticket(6, "Румен Георгиев Радев", 5000, 50, 49.42),
    ticket(15, "Анастас Георгиев Герджиков", 2000, 20, 22.83),
  ],
  leader: {
    number: 6,
    president: "Румен Георгиев Радев",
    votes: 5000,
    pct: 50,
  },
  ...over,
});

const neighborhoods = (
  over: Partial<PresidentialNeighborhoods> = {},
): PresidentialNeighborhoods => ({
  cycle: "2021_11_14_pvr",
  round: 1,
  basis: "КАВЕАТ",
  basisEn: "CAVEAT",
  coverage: {
    catalogue: 8,
    located: 1,
    missing: [],
    sections: 70,
    sectionsInCycle: 12488,
    validVotes: 10000,
    pctOfValid: 0.93,
  },
  national: { ...rates, turnoutPct: 37.2, invalidPct: 2.93 },
  totals: rates,
  tickets: [
    ticket(6, "Румен Георгиев Радев", 5000, 50, 49.42),
    ticket(15, "Анастас Георгиев Герджиков", 2000, 20, 22.83),
  ],
  places: [stolipinovo()],
  ...over,
});

const mount = (
  n: PresidentialNeighborhoods,
  scope: NeighborhoodScope = { level: "country" },
) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PresidentialProblemVotesTile scoped={scopeNeighborhoods(n, scope)} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
});

describe("PresidentialProblemVotesTile", () => {
  it("puts each pair's share inside the districts beside its NATIONAL share", () => {
    // ⚠⚠ THE LAST COLUMN IS „В СТРАНАТА", NOT „Δ П.П." — the parliamentary tile's one
    // deliberate divergence. A cross-cycle delta is not computable here: 2011 locates five of
    // the eight districts and 2001 all eight, because sections are renumbered, so „up 6 points
    // on last time" would compare two different sets of polling stations.
    mount(neighborhoods());
    const row = screen.getByText("Румен Георгиев Радев").closest("tr");
    expect(row?.textContent).toContain(formatPct(0.5, "bg", 1));
    expect(row?.textContent).toContain(formatPct(0.4942, "bg", 1));
    expect(row?.textContent).toContain("5000");
    // No Δ column, in either language's wording.
    expect(screen.queryByText(bgCorpus.dashboard_change_pp)).toBeNull();
  });

  it("links every pair, through the one component that owns the decision", () => {
    mount(neighborhoods());
    const cell = screen
      .getAllByRole("rowheader")
      .find((c) => c.textContent?.includes("Румен Георгиев Радев"));
    expect(cell?.querySelector("a")?.getAttribute("href")).toBe(
      "/person/mp-5142",
    );
  });

  it("announces the pairs it does not show", () => {
    // ⚠ THE SLICE IS A SECOND CUT, on a different axis from the producer's 3% one — 2016 round
    // 1 clears that cut with SEVEN tickets. A row that vanished silently would also make the
    // artifact's own figures unreviewable from the page rendering them.
    mount(
      neighborhoods({
        tickets: Array.from({ length: 8 }, (_, i) =>
          ticket(i + 1, `Кандидат ${i + 1}`, 800 - i, 8 - i / 10, 7),
        ),
      }),
    );
    expect(
      screen.getByText(
        bgCorpus.presidential_hoods_more_tickets_other.replace(
          "{{count}}",
          "2",
        ),
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Кандидат 8")).toBeNull();
  });

  it("uses the SINGULAR when exactly one pair is withheld", () => {
    // ⚠ THE STATE 2016 ROUND 1 IS ACTUALLY IN — seven pairs clear the producer's 3% cut and six
    // are shown — so the singular is the form a reader most often meets, and it was the one the
    // un-pluralised key got wrong.
    mount(
      neighborhoods({
        tickets: Array.from({ length: 7 }, (_, i) =>
          ticket(i + 1, `Кандидат ${i + 1}`, 800 - i, 8 - i / 10, 7),
        ),
      }),
    );
    expect(
      screen.getByText(bgCorpus.presidential_hoods_more_tickets_one),
    ).toBeTruthy();
  });

  it("at PLACE scope, publishes the PLACE's share and the country's own", () => {
    // ⚠⚠ THE DEFECT A FILTERED TABLE WITH UNFILTERED SHARES HAS. Here the two districts split
    // 5,000/1,000 for Радев; scoped to Sofia his share is 20%, not the 50% the artifact
    // publishes for the country's districts — while `pctNational` stays the published 49,4%.
    const sofia = stolipinovo({
      id: "filipovci",
      name_bg: "Филиповци",
      valid: 5000,
      oblasts: ["S25"],
      obshtini: [],
      ekattes: [],
      tickets: [
        ticket(6, "Румен Георгиев Радев", 1000, 20, 49.42),
        ticket(15, "Анастас Георгиев Герджиков", 3000, 60, 22.83),
      ],
      leader: {
        number: 15,
        president: "Анастас Георгиев Герджиков",
        votes: 3000,
        pct: 60,
      },
    });
    mount(neighborhoods({ places: [stolipinovo(), sofia] }), {
      level: "region",
      id: "S25",
    });
    const row = screen.getByText("Румен Георгиев Радев").closest("tr");
    expect(row?.textContent).toContain(formatPct(0.2, "bg", 1));
    expect(row?.textContent).toContain(formatPct(0.4942, "bg", 1));
    expect(row?.textContent).not.toContain(formatPct(0.5, "bg", 1));
  });

  it("renders NOTHING for a place holding no district", () => {
    const { container } = mount(neighborhoods(), {
      level: "region",
      id: "BLG",
    });
    expect(container.textContent).toBe("");
  });
});
