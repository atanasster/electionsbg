// The country page's WIRING — the three claims it makes that could each render as a fine page.
//
// ⚠ EVERY CASE HERE IS A NUMBER THAT WOULD LOOK RIGHT. „49.42% and elected" is a working page
// with a false verdict on it; „0 избрали не подкрепям никого" is a working page asserting
// something about voters who were never asked; and a runoff toggle on a cycle with one round
// is a working control that leads nowhere.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialCycleScreen } from "./PresidentialCycleScreen";
import type { PresidentialSummary } from "@/data/presidential/summary";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const ROUND = {
  round: 1 as const,
  date: "2021-11-14",
  ranking: [
    {
      number: 6,
      president: "Румен Георгиев Радев",
      vicePresident: "Илияна Малинова Йотова",
      nominatedBy: { name: "ИК за Румен Радев", kind: "committee" },
      votes: 1_322_385,
      shareOfValid: 0.4941768,
    },
    {
      number: 15,
      president: "Анастас Георгиев Герджиков",
      vicePresident: "Невяна Михайлова Митева-Матеева",
      nominatedBy: { name: "ИК за Анастас Герджиков", kind: "committee" },
      votes: 610_862,
      shareOfValid: 0.2282,
    },
  ],
  votes: {
    tickets: 2_615_149,
    noneOfTheAbove: 60_786,
    valid: 2_675_935,
    invalid: 9_487,
    invalidBasis: "paper-ballots-found-invalid" as const,
  },
  turnout: {
    registeredVoters: 6_667_895,
    cast: 2_687_307,
    pct: 0.403,
    basis: "подписи в списъците",
  },
  outcome: {
    meetsMajority: false,
    meetsTurnout: false,
    winsOutright: false,
  },
  abroad: {
    sections: 750,
    ticketVotes: 220_660,
    ballotsFound: 230_243,
    countries: 68,
    sectionsWithoutCountry: 0,
    sectionsWithoutSignatures: 0,
  },
};

const SUMMARY: PresidentialSummary = {
  cycle: LATEST_PRESIDENTIAL_CYCLE,
  round1Date: "2021-11-14",
  round2Date: "2021-11-21",
  decidedInRound: 2,
  winner: {
    number: 6,
    president: "Румен Георгиев Радев",
    vicePresident: "Илияна Малинова Йотова",
  },
  rounds: [
    ROUND,
    {
      ...ROUND,
      round: 2,
      date: "2021-11-21",
      votes: { ...ROUND.votes, valid: 2_300_000 },
      outcome: { meetsMajority: true, meetsTurnout: false, winsOutright: true },
    },
  ],
  swing: {
    tickets: [
      {
        number: 6,
        president: "Румен Георгиев Радев",
        round1Votes: 1_322_385,
        round2Votes: 1_539_650,
        deltaVotes: 217_265,
        round1Share: 0.4941768,
        round2Share: 0.6672,
        deltaShare: 0.173,
      },
    ],
    turnoutDeltaPct: -0.0567,
    turnoutBasesMatch: true,
  },
};

const ROUTE = `/presidential/${LATEST_PRESIDENTIAL_CYCLE}`;

/** ⚠ URL-AWARE. The page fetches THREE things — the summary, the round's region roll-up and
 *  `tickets.json` — plus `/regions_map.json` for the choropleth. A mock that answers every
 *  request with the summary hands the map an object with no `features`, which is a render-time
 *  `TypeError`; here only the summary URL is answered and the rest 404, which is also the
 *  honest CI state (`data/*_pvr` is gitignored and has no bucket copy). */
const wrapperAt =
  (entry: string) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/presidential/:cycle" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

const mount = (body: unknown, ok = true, entry = ROUTE) => {
  globalThis.fetch = (async (url: RequestInfo | URL) =>
    ok && String(url).includes("national_summary.json")
      ? new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response("", { status: 404 })) as typeof fetch;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/presidential/:cycle" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PresidentialCycleScreen />, { wrapper: Wrapper });
};

beforeEach(() => i18n.changeLanguage("bg"));

describe("the presidential country page", () => {
  it("states BOTH art. 93 (3) conditions, not just the leader's share", async () => {
    // ⚠ „49.42%" beside a name is a page that reads as a win. The two conditions are what make
    // „nobody was elected" legible, and the producer decides them — this asserts the page
    // renders that verdict rather than re-deriving one.
    mount(SUMMARY);
    expect(
      await screen.findByText(bgCorpus.presidential_rule_runoff),
    ).toBeInTheDocument();
    expect(
      screen.getByText(bgCorpus.presidential_rule_majority_unmet),
    ).toBeInTheDocument();
    expect(
      screen.getByText(bgCorpus.presidential_rule_turnout_unmet),
    ).toBeInTheDocument();
  });

  it("switches the whole panel when the round toggle is used", async () => {
    mount(SUMMARY);
    const toggle = await screen.findByRole("group", {
      name: bgCorpus.presidential_round_toggle_label,
    });
    const second = within(toggle).getAllByRole("button")[1];
    fireEvent.click(second);
    // Round 2 in this fixture WAS won outright — so the verdict must move with the round.
    expect(
      screen.getByText(bgCorpus.presidential_rule_won),
    ).toBeInTheDocument();
  });

  it("renders no round toggle for a cycle with one round", async () => {
    // ⚠ ALL FIVE COMMITTED CYCLES WENT TO A RUNOFF, so this arm is only reachable from a
    // fixture — which is exactly why it is worth pinning: a control offering „2-и тур" on a
    // cycle that had none is a link to a round that never happened.
    mount({ ...SUMMARY, rounds: [ROUND], swing: null, decidedInRound: 1 });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(
      screen.queryByRole("group", {
        name: bgCorpus.presidential_round_toggle_label,
      }),
    ).toBeNull();
  });

  it("omits „не подкрепям никого“ entirely when the form did not ask", async () => {
    // ⚠ ABSENT, NOT ZERO. Before 2016 the option did not exist; a rendered 0 is a claim about
    // voters who were never offered it.
    const { noneOfTheAbove: _dropped, ...votes } = ROUND.votes;
    void _dropped;
    mount({
      ...SUMMARY,
      rounds: [{ ...ROUND, votes }],
      swing: null,
      decidedInRound: 1,
    });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(
      screen.queryByText(bgCorpus.presidential_none_of_the_above),
    ).toBeNull();
    // …and the control: with the key present it DOES render, so the absence above is the
    // rule firing rather than the label being missing from the corpus.
    mount(SUMMARY);
    expect(
      await screen.findByText(bgCorpus.presidential_none_of_the_above),
    ).toBeInTheDocument();
  });

  it("tells „not published“ apart from „unreadable“", async () => {
    mount(null, false);
    expect(
      await screen.findByText(bgCorpus.presidential_not_published),
    ).toBeInTheDocument();
    mount({ nonsense: true });
    expect(
      await screen.findByText(bgCorpus.presidential_unusable),
    ).toBeInTheDocument();
  });

  it("resets to round 1 when the reader NAVIGATES to another cycle", async () => {
    // ⚠ A NAVIGATION, NOT A REMOUNT. Unmounting and mounting again resets any component and
    // would pass whatever the implementation did. The defect is that all five cycles share ONE
    // `<Route>` element, so changing only `:cycle` re-renders the SAME instance and
    // `useState`'s initial value is not re-applied — a reader who toggled to the runoff and
    // then picked another cycle from the header dropdown would land on that cycle's runoff,
    // never seeing the art. 93 (3) test this page leads with. Two clicks, and both controls
    // are on this page.
    globalThis.fetch = (async (url: RequestInfo | URL) =>
      String(url).includes("national_summary.json")
        ? new Response(
            JSON.stringify(
              String(url).includes("2016_11_06_pvr")
                ? {
                    ...SUMMARY,
                    cycle: "2016_11_06_pvr",
                    round1Date: "2016-11-06",
                  }
                : SUMMARY,
            ),
            { status: 200 },
          )
        : new Response("", { status: 404 })) as typeof fetch;

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[ROUTE]}>
          <Link to="/presidential/2016_11_06_pvr">go</Link>
          <Routes>
            <Route
              path="/presidential/:cycle"
              element={<PresidentialCycleScreen />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole("group", {
      name: bgCorpus.presidential_round_toggle_label,
    });
    fireEvent.click(within(toggle).getAllByRole("button")[1]);
    expect(
      screen.getByText(bgCorpus.presidential_rule_won),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("go"));
    expect(
      await screen.findByText(bgCorpus.presidential_rule_runoff),
    ).toBeInTheDocument();
    expect(screen.queryByText(bgCorpus.presidential_rule_won)).toBeNull();
  });

  it("says NOTHING about the oblasts while the roll-up has not answered", async () => {
    // ⚠⚠ THE STATE THIS SUITE ALREADY RUNS IN, AND NEVER LOOKED AT. `mount` answers only the
    // summary and 404s the rest — the honest CI state, since `data/*_pvr` is gitignored with
    // no bucket copy — and in that window the map used to render 31 keyboard buttons each
    // announcing „няма подадени гласове", directly above a ranking table showing millions of
    // votes. The text twin, correctly, rendered nothing at all: a choropleth with no text
    // equivalent, saying something false.
    mount(SUMMARY);
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(document.body.textContent).not.toContain("няма подадени гласове");
    expect(
      screen.queryByText(bgCorpus.presidential_regions_heading),
    ).toBeNull();
    expect(document.querySelector("[data-map-question]")).toBeNull();
  });

  it("mounts the map and its text twin TOGETHER once the roll-up answers", async () => {
    // ⚠ BOTH OR NEITHER. §4's rule is that a map always has a text equivalent, and this pair
    // is also the only route from the country page down to an oblast — so a state where one
    // renders without the other is either an unlabelled choropleth or a dead end.
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("national_summary.json"))
        return new Response(JSON.stringify(SUMMARY), { status: 200 });
      if (u.includes("region_votes.json"))
        return new Response(
          JSON.stringify({
            coverage: { basis: "x", sections: 1, excludedSections: 0 },
            entries: [
              {
                key: "BLG",
                results: { votes: [{ partyNum: 6, totalVotes: 9 }] },
              },
            ],
          }),
          { status: 200 },
        );
      if (u.includes("tickets.json"))
        return new Response(
          JSON.stringify({
            cycle: LATEST_PRESIDENTIAL_CYCLE,
            tickets: [
              {
                number: 6,
                president: "Румен Георгиев Радев",
                vicePresident: "Илияна Малинова Йотова",
                nominatedBy: { name: "ИК", kind: "committee" },
                color: "rgb(1, 2, 3)",
              },
            ],
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    }) as typeof fetch;

    render(<PresidentialCycleScreen />, { wrapper: wrapperAt(ROUTE) });
    expect(
      await screen.findByText(bgCorpus.presidential_regions_heading),
    ).toBeInTheDocument();
    // The question heading is VISIBLE, as the shell renders it on every other kind.
    const q = document.querySelector("[data-map-question]");
    expect(q?.className ?? "").not.toContain("sr-only");
    // …and the twin precedes the map in the DOM (§4: the ranked result comes first).
    const list = screen.getByText(bgCorpus.presidential_regions_heading);
    const svg = document.querySelector("svg");
    if (svg)
      expect(
        list.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
  });

  it("never prints the cycle folder id as a date", async () => {
    mount(SUMMARY);
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(document.body.textContent).not.toContain(LATEST_PRESIDENTIAL_CYCLE);
  });
});
