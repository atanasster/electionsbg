// The country page's WIRING — the three claims it makes that could each render as a fine page.
//
// ⚠ EVERY CASE HERE IS A NUMBER THAT WOULD LOOK RIGHT. „49.42% and elected" is a working page
// with a false verdict on it; „0 избрали не подкрепям никого" is a working page asserting
// something about voters who were never asked; and a runoff toggle on a cycle with one round
// is a working control that leads nowhere.

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialCycleScreen } from "./PresidentialCycleScreen";
import type { PresidentialSummary } from "@/data/presidential/summary";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RunoffTransfer } from "@/data/presidential/useRunoffTransfer";

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
      {/* ⚠ THE PROVIDER IS PART OF THE MOUNT, because the page's tiles use `Hint`, which is a
          Radix tooltip — and Radix THROWS („`Tooltip` must be used within `TooltipProvider`")
          rather than degrading. In the app it comes from `main.tsx`; a test that omits it
          reports a missing provider as a broken page, which is how the geography section first
          failed here. */}
      <TooltipProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/presidential/:cycle" element={children} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
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
  // ⚠ ONE WRAPPER, NOT A SECOND COPY OF IT. This used to rebuild `wrapperAt`'s tree by hand,
  // so the two mount paths could silently test different trees — and adding the
  // `TooltipProvider` to only one of them is exactly how that would show up.
  return render(<PresidentialCycleScreen />, { wrapper: wrapperAt(entry) });
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
    // ⚠ THE TWIN BESIDE THE MAP IS THE NATIONAL RANKING NOW, and the oblast table follows the
    // canvas. §4's DOM rule binds on the pair that SHARE the row — the ranked result first, the
    // map placed into column 1 at `lg` — which is `/parliamentary`'s arrangement.
    const canvas = document.querySelector("[data-outcome-canvas]")!;
    const ranked = canvas.querySelector("[data-canvas-slot=ranked]")!;
    const map = canvas.querySelector("[data-canvas-slot=map]")!;
    expect(
      ranked.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // …and the oblast table is BELOW the canvas rather than inside it — still on the page,
    // because it is the only route down to an oblast, and still gated with the map.
    const list = screen.getByText(bgCorpus.presidential_regions_heading);
    expect(canvas.contains(list)).toBe(false);
    expect(
      canvas.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens with the national ranking beside the map, as `/parliamentary` does", async () => {
    // ⚠ THE FIRST THING BESIDE THE MAP USED TO BE THE OBLAST TABLE — a different question,
    // answered one level down, in the slot every other kind fills with „who won". This asserts
    // the slot's CONTENT, not just that a slot exists: a canvas whose ranked column had gone
    // back to region rows would still report `["ranked", "map"]`.
    mount(SUMMARY);
    const canvas = await screen.findByText(
      bgCorpus.election_ballot_presidential_ticket,
    );
    const ranked = document.querySelector("[data-canvas-slot=ranked]")!;
    expect(canvas).toBeInTheDocument();
    expect(
      within(ranked as HTMLElement).getByText(/Румен Георгиев Радев/),
    ).toBeInTheDocument();
    // The shell's own caption and entry header, so the two pages name the same thing alike.
    expect(
      within(ranked as HTMLElement).getByText(bgCorpus.election_ranked_caption),
    ).toBeInTheDocument();
    // ⚠ AND NOT THE OBLAST TABLE'S COLUMNS. „Област" in this slot is the regression.
    expect(
      within(ranked as HTMLElement).queryByText(
        bgCorpus.presidential_col_region,
      ),
    ).toBeNull();
  });

  it("keeps the ranking when the roll-up has NOT answered — only the map goes", async () => {
    // ⚠ THE TWO HALVES OF THE CANVAS HAVE DIFFERENT SOURCES, and this is the state the corpus is
    // usually in: `round.ranking` is in the summary the page already holds, while the map's
    // fills come from a region roll-up that is gitignored and has no bucket copy. Gating the
    // PAIR on the roll-up — the obvious reading of „both or neither" — would delete the first
    // screen of the page in the ordinary case, on a page whose result is fully known.
    mount(SUMMARY);
    const ranked = await screen.findByText(bgCorpus.election_ranked_caption);
    expect(ranked).toBeInTheDocument();
    expect(document.querySelector("[data-canvas-slot=ranked]")).toBeTruthy();
    expect(document.querySelector("[data-canvas-slot=map]")).toBeNull();
    expect(document.querySelector("[data-map-question]")).toBeNull();
  });

  it("opens with the same four-card band `/parliamentary` does", async () => {
    // ⚠ THE COMPONENT, NOT A LOOKALIKE. `ElectionFactsGrid` is the strip the shell renders on
    // every other kind, so a band that stopped matching would be this page importing something
    // else — which is exactly what `data-fact` pins: the hook is the shell's, not this file's.
    //
    // ⚠ AND IT DESCRIBES THE ROUND ON SCREEN. Round 1 and the runoff are different electorates
    // — nationally 5.7 points apart in 2021 — so a band lifted to the page would put round 1's
    // majority threshold above the runoff's result.
    mount(SUMMARY);
    await screen.findByText(bgCorpus.presidential_rule_heading);
    const codes = () =>
      [...document.querySelectorAll("[data-fact]")].map((n) =>
        n.getAttribute("data-fact"),
      );
    expect(codes()).toEqual([
      "majority_threshold",
      "winner",
      "turnout",
      "valid_votes",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /2/ }));
    // ⚠ ART. 93 (4) HAS NO MAJORITY TEST, so the card that led round 1 must be GONE rather
    // than restated with the runoff's numbers.
    expect(codes()).not.toContain("majority_threshold");
    expect(codes()[0]).toBe("winner");
  });

  it("keeps the map INSIDE a positioned box, beside its text twin", async () => {
    // ⚠ THIS IS THE DEFECT THE CANVAS WAS BUILT ON. `SVGMapContainer` renders its `<svg>` as
    // `absolute`, so with no positioned ancestor the map is laid out against the page shell and
    // paints over the header, the promo banner and the title — a page that looks broken
    // everywhere except where the map belongs, with nothing failing. `MeasuredMapBox` owns the
    // containing block now; this asserts the map has one at all.
    //
    // ⚠ AND THE SLOTS ARE THE SHELL'S OWN, so the desktop arrangement is `/parliamentary`'s:
    // the twin FIRST in the DOM, the map PLACED into column 1 rather than reordered.
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
      if (u.includes("regions_map.json"))
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { nuts3: "BLG" },
                geometry: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [23, 41],
                      [24, 41],
                      [24, 42],
                      [23, 41],
                    ],
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    }) as typeof fetch;
    render(<PresidentialCycleScreen />, { wrapper: wrapperAt(ROUTE) });
    await screen.findByText(bgCorpus.presidential_regions_heading);
    const slots = [...document.querySelectorAll("[data-canvas-slot]")].map(
      (n) => n.getAttribute("data-canvas-slot"),
    );
    expect(slots).toEqual(["ranked", "map"]);
    // ⚠ THE BOX, NOT THE `<svg>`. jsdom reports every element at zero size and has no
    // `ResizeObserver`, so `MeasuredMapBox` never hands a size down and the map itself does not
    // mount here — which is why the twin test above guards its own `svg` lookup. What DOES
    // render is the box, and the box is where the containing block lives: that is the claim
    // that broke, and it is checkable.
    const box = document.querySelector("[data-canvas-slot=map] > div");
    expect(box).toBeTruthy();
    expect(box!.className).toContain("relative");
  });

  it("links a candidate the corpus can name, and refuses a shared name", async () => {
    // ⚠ THE REFUSAL IS THE CLAIM WORTH PINNING. A link says this candidate and that profile
    // are the same person; 17 of the 140 names on these ballots are shared — one by fifteen
    // public figures — and linking one of them would attribute the candidacy, and everything
    // else on that profile, to somebody who merely shares a name.
    mount({
      ...SUMMARY,
      rounds: [
        {
          ...ROUND,
          ranking: [
            ROUND.ranking[0],
            {
              ...ROUND.ranking[1],
              president: "Иван Стефанов Иванов",
              vicePresident: "Иван Стефанов Иванов",
            },
          ],
        },
      ],
      swing: null,
      decidedInRound: 1,
    });
    // Радев resolves to exactly one public figure, so his name is a link — in the winner
    // line AND in the ranked row, which is why this is `findAllBy`.
    const links = await screen.findAllByRole("link", {
      name: "Румен Георгиев Радев",
    });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links)
      expect(l.getAttribute("href")).toMatch(/^\/person\//);
    // …and the shared name is NOT a link — it is text, with the reason beside it.
    expect(
      screen.queryByRole("link", { name: "Иван Стефанов Иванов" }),
    ).toBeNull();
    expect(screen.getAllByText("Иван Стефанов Иванов").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(bgCorpus.presidential_namesake_mark).length,
    ).toBeGreaterThan(0);
  });

  it("never prints the cycle folder id as a date", async () => {
    mount(SUMMARY);
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(document.body.textContent).not.toContain(LATEST_PRESIDENTIAL_CYCLE);
  });
});

// ⚠ THE TRANSFER SECTION HAS THREE STATES AND TWO OF THEM DRAW NOTHING — which is why every
// other test in this file passes without ever having rendered it: their mocks 404 the transfer,
// so `absent` (correct, and the ordinary state of this corpus) is all they ever exercise.
describe("the runoff-transfer section", () => {
  const TRANSFER: RunoffTransfer = {
    cycle: LATEST_PRESIDENTIAL_CYCLE,
    basis: "ОГРАДАТА ОТ ФАЙЛА",
    basisEn: "THE CAVEAT FROM THE FILE",
    finalists: [
      { number: 6, president: "Румен Георгиев Радев", votes: 1451755 },
      { number: 15, president: "Анастас Георгиев Герджиков", votes: 692640 },
    ],
    national: {
      matrix: {
        fromNodes: [
          {
            id: "t6",
            label: "Румен Георгиев Радев",
            labelEn: "Rumen Radev",
            color: "#123456",
            votes: 1000,
          },
        ],
        toNodes: [
          {
            id: "t6",
            label: "Румен Георгиев Радев",
            labelEn: "Rumen Radev",
            color: "#123456",
            votes: 1200,
          },
        ],
        flows: [{ from: "t6", to: "t6", votes: 1000 }],
      },
      sections: 12479,
      droppedVotes: 0,
      marginGap: 0.0281,
    },
    oblasts: [
      {
        oblast: "BLG",
        sections: 10,
        rasResidual: 0.0001,
        w1: 1000,
        w2: 1600,
        elim: 1200,
        v1: 3000,
        v2: 2400,
        n1: null,
        n2: null,
        a1: 3200,
        a2: 2600,
        reg1: 8000,
        reg2: 8100,
      },
    ],
    coverage: {
      basis: "ОБХВАТ",
      basisEn: "COVERAGE",
      domesticSections: 12479,
      abroadVotes: 127572,
      unplacedSections: 0,
      unplacedVotes: 0,
      settlementsJoined: 4184,
      sectionsWithEkatte: 10878,
      sectionsWithoutEkatte: 1601,
      votesWithoutEkatte: 406128,
    },
    residue: {
      round1Only: [],
      round2Only: [],
      round1OnlyVotes: 0,
      round2OnlyVotes: 0,
    },
  };

  /** The page's own mock, plus an answer for `runoff_transfer.json`. */
  const mountWithTransfer = (transfer: unknown, status = 200) => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("national_summary.json"))
        return new Response(JSON.stringify(SUMMARY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (u.includes("runoff_transfer.json"))
        return status === 200
          ? new Response(JSON.stringify(transfer), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : new Response("", { status });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[ROUTE]}>
          <TooltipProvider>
            <Routes>
              <Route path="/presidential/:cycle" element={children} />
            </Routes>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return render(<PresidentialCycleScreen />, { wrapper: Wrapper });
  };

  beforeEach(() => {
    // jsdom has no `matchMedia`; the tile calls it on first render. `false` puts it on the
    // mobile branch, which is the readable one here — jsdom gives the container no width.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
  });

  it("renders the estimate and the observed pickup as SEPARATE claims", async () => {
    // ⚠ TWO HEADINGS, NOT ONE. Above the second everything is an estimate; below it everything
    // is arithmetic on published protocols. Running them together is how a reader carries the
    // estimate's licence over to numbers that do not need it — and, worse, the other way round.
    mountWithTransfer(TRANSFER);
    expect(
      await screen.findByText(bgCorpus.presidential_transfer_heading),
    ).toBeInTheDocument();
    expect(screen.getByText("ОГРАДАТА ОТ ФАЙЛА")).toBeInTheDocument();
    expect(screen.getByText(bgCorpus.presidential_pickup_note)).toBeInTheDocument(); // prettier-ignore
    // The winner is threaded into the observed half, so its table links down to the oblast.
    expect(
      screen.getByRole("link", { name: "Благоевград" }).getAttribute("href"),
    ).toBe(`/presidential/${LATEST_PRESIDENTIAL_CYCLE}/region/BLG`);
  });

  it("draws NOTHING when the file is absent — the ordinary state of this corpus", async () => {
    mountWithTransfer(null, 404);
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(
      screen.queryByText(bgCorpus.presidential_transfer_heading),
    ).toBeNull();
  });

  it("draws NOTHING when the payload has lost its caveat", async () => {
    // ⚠ THE WITHHOLDING, END TO END. A matrix without the sentence that qualifies it publishes
    // individual behaviour inferred from aggregates — at a 200, looking like a working chart.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountWithTransfer({ ...TRANSFER, basis: "", basisEn: "" });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    expect(
      screen.queryByText(bgCorpus.presidential_transfer_heading),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the geography section", () => {
  // ⚠⚠ IT IS GATED ON CONTENT, NOT ON QUERY STATUS, and „ready" is not „has something to draw"
  // for either tile: `isRollup` accepts an all-zero roll-up and both tiles self-hide on an empty
  // result. Gated on status, the page renders a bare „География" heading over an empty grid —
  // reporting a routine absence as a defect, which is the one thing the gate exists to prevent.
  const serve = (files: Record<string, unknown>) => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      for (const [needle, body] of Object.entries(files))
        if (u.includes(needle))
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    return render(<PresidentialCycleScreen />, { wrapper: wrapperAt(ROUTE) });
  };

  const CLEAVAGES = {
    cycle: LATEST_PRESIDENTIAL_CYCLE,
    round: 1,
    basis: "ЕКОЛОГИЧНАТА ОГРАДА",
    basisEn: "THE ECOLOGICAL CAVEAT",
    municipalities: 265,
    votes: 1,
    abroadVotes: 1,
    unmappedVotes: 0,
    tickets: [
      { number: 6, president: "Румен Георгиев Радев", pctNational: 49.4 },
      {
        number: 15,
        president: "Анастас Георгиев Герджиков",
        pctNational: 22.8,
      },
    ],
    rows: [{ metric: "ethnicBulgarian", rs: [0.86, -0.87], spread: 1.73 }],
  };

  it("renders NO heading when the roll-up is READY but every oblast cast ZERO", async () => {
    // ⚠ THE STATE A STATUS GATE GETS WRONG. `isRollup` accepts this payload, so it is `ready`
    // — and the tile still draws nothing, because there is nothing to rank. Gated on status the
    // page would show „География" over an empty grid.
    const seen: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("national_summary.json"))
        return new Response(JSON.stringify(SUMMARY), { status: 200 });
      if (u.includes("region_votes.json"))
        return new Response(
          JSON.stringify({
            coverage: { basis: "x", sections: 1, excludedSections: 0 },
            entries: [
              {
                key: "BLG",
                results: { votes: [{ partyNum: 6, totalVotes: 0 }] },
              },
            ],
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    }) as typeof fetch;
    render(<PresidentialCycleScreen />, { wrapper: wrapperAt(ROUTE) });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    // ⚠ THE ROLL-UP MUST HAVE SETTLED BEFORE THE NEGATIVE ASSERTION, or the test passes against
    // the very gate it is written to reject — nothing renders while a query is still loading
    // either. Waiting for the request and then letting React Query commit is what makes the
    // assertion mean „ready and empty" rather than „not yet".
    await waitFor(() =>
      expect(seen.some((u) => u.includes("region_votes.json"))).toBe(true),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-outcome-canvas]")).toBeTruthy(),
    );
    expect(screen.queryByText(bgCorpus.dashboard_section_geography)).toBeNull();
  });

  it("renders the heading and the oblast rows once an oblast HAS votes", async () => {
    // ⚠ THE MUTATION CHECK for the test above: „no heading" is also satisfied by a gate that
    // had silently become unreachable, which would take the whole section with it.
    serve({
      "national_summary.json": SUMMARY,
      "region_votes.json": {
        coverage: { basis: "x", sections: 1, excludedSections: 0 },
        entries: [
          { key: "BLG", results: { votes: [{ partyNum: 6, totalVotes: 9 }] } },
        ],
      },
    });
    expect(
      await screen.findByText(bgCorpus.dashboard_section_geography),
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll('a[href*="/region/BLG"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders the heading once the cleavages arrive, even with no roll-up", async () => {
    // ⚠ EITHER TILE IS ENOUGH. The two artifacts have different publish paths, so gating the
    // section on both would hide one that is there.
    serve({
      "national_summary.json": SUMMARY,
      "demographic_cleavages.json": CLEAVAGES,
    });
    expect(
      await screen.findByText(bgCorpus.dashboard_section_geography),
    ).toBeInTheDocument();
    expect(screen.getByText("ЕКОЛОГИЧНАТА ОГРАДА")).toBeTruthy();
  });
});

describe("the anomalies section", () => {
  // ⚠⚠ SAME RULE AS GEOGRAPHY ABOVE, and here the trap is sharper: a `ready`
  // `suspicious_settlements.json` whose every rule was UNMEASURABLE renders three zeros over
  // „измеримо за 0 населени места", which a reader takes as „nothing was wrong here" when the
  // truth is that nothing could be checked.
  const serve = (files: Record<string, unknown>) => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      seen.push(u);
      for (const [needle, body] of Object.entries(files))
        if (u.includes(needle))
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    render(<PresidentialCycleScreen />, { wrapper: wrapperAt(ROUTE) });
    return seen;
  };

  const category = (over: Record<string, unknown> = {}) => ({
    count: 3,
    threshold: 80,
    nationalPct: 49.4,
    measurableSettlements: 2341,
    flaggedShare: 0.001,
    discriminating: true,
    top: [
      {
        ekatte: "00012",
        oblast: "BLG",
        settlement: "с. Аномалия",
        region_name: "Благоевград",
        value: 96.4,
      },
    ],
    votesAffected: 812,
    ...over,
  });

  const SUSPICIOUS = {
    cycle: LATEST_PRESIDENTIAL_CYCLE,
    round: 1,
    basis: "СИГНАЛНАТА ОГРАДА",
    basisEn: "THE FLAG CAVEAT",
    coverage: {
      settlements: 4921,
      sections: 11132,
      sectionsWithoutEkatte: 1355,
      votesWithoutEkatte: 502133,
    },
    concentrated: category(),
    invalidBallots: category({ count: 0, top: [] }),
    additionalVoters: category({ count: 0, top: [] }),
  };

  const FLASH = {
    cycle: LATEST_PRESIDENTIAL_CYCLE,
    round: 1,
    coverage: {
      protocolSections: 12488,
      comparedSections: 9355,
      uncomparedMachineVotes: 3089,
    },
    tickets: [{ number: 6, machineVotes: 1_000_000, flashVotes: 1_000_010 }],
  };

  it("renders NO heading when neither artifact is published", async () => {
    // The ordinary state of this corpus: `data/*_pvr` is gitignored and both files reach the
    // bucket only through `bucket:gz`.
    const seen = serve({ "national_summary.json": SUMMARY });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    // ⚠ WAIT FOR THE REQUESTS, or the negative assertion passes against the very gate it is
    // written to reject — nothing renders while a query is still loading either.
    await waitFor(() =>
      expect(seen.some((u) => u.includes("suspicious_settlements.json"))).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-outcome-canvas]")).toBeTruthy(),
    );
    expect(screen.queryByText(bgCorpus.dashboard_section_anomalies)).toBeNull();
  });

  it("renders NO heading when the payload is READY but nothing was measurable", async () => {
    // ⚠⚠ THE STATE A STATUS GATE GETS WRONG, and the reason `hasSuspiciousContent` exists.
    const seen = serve({
      "national_summary.json": SUMMARY,
      "suspicious_settlements.json": {
        ...SUSPICIOUS,
        concentrated: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
        invalidBallots: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
        additionalVoters: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
      },
    });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    await waitFor(() =>
      expect(seen.some((u) => u.includes("suspicious_settlements.json"))).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-outcome-canvas]")).toBeTruthy(),
    );
    expect(screen.queryByText(bgCorpus.dashboard_section_anomalies)).toBeNull();
  });

  it("renders the heading, the caveat and the flagged place once it is published", async () => {
    // ⚠ THE MUTATION CHECK for the two above: „no heading" is also satisfied by a gate that had
    // silently become unreachable, which would take the whole section with it.
    serve({
      "national_summary.json": SUMMARY,
      "suspicious_settlements.json": SUSPICIOUS,
    });
    expect(
      await screen.findByText(bgCorpus.dashboard_section_anomalies),
    ).toBeInTheDocument();
    expect(screen.getByText("СИГНАЛНАТА ОГРАДА")).toBeTruthy();
    expect(screen.getByText("с. Аномалия, Благоевград")).toBeTruthy();
  });

  it("keeps the heading for flash while the suspicious tile stays away", async () => {
    // ⚠⚠ THE MIXED STATE, and the only one where the section's two gates differ. `hasFlash`
    // opens the heading; the suspicious payload is `ready` and has nothing measurable, so its
    // tile must not add three zeros under it — „nothing was wrong here" where the truth is
    // „nothing could be checked". A machine-heavy round is exactly how this arises.
    serve({
      "national_summary.json": SUMMARY,
      "flash.json": FLASH,
      "suspicious_settlements.json": {
        ...SUSPICIOUS,
        concentrated: category({ count: 0, measurableSettlements: 0, top: [] }),
        invalidBallots: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
        additionalVoters: category({
          count: 0,
          measurableSettlements: 0,
          top: [],
        }),
      },
    });
    expect(
      await screen.findByText(bgCorpus.dashboard_section_anomalies),
    ).toBeInTheDocument();
    expect(screen.queryByText("СИГНАЛНАТА ОГРАДА")).toBeNull();
  });

  it("renders NO heading for a flash file whose every ticket is zero", async () => {
    // ⚠ THE TILE'S REAL PREDICATE IS NOT `tickets.length`. It renders on any ticket and then
    // filters to the rows worth reading, so an all-zero set opens the heading and draws a table
    // with no body — the empty-grid failure one level down.
    const seen = serve({
      "national_summary.json": SUMMARY,
      "flash.json": {
        ...FLASH,
        tickets: [{ number: 6, machineVotes: 0, flashVotes: 0 }],
      },
    });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    await waitFor(() =>
      expect(seen.some((u) => u.includes("flash.json"))).toBe(true),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-outcome-canvas]")).toBeTruthy(),
    );
    expect(screen.queryByText(bgCorpus.dashboard_section_anomalies)).toBeNull();
  });

  it("renders the heading for the flash records alone — either tile is enough", async () => {
    // The two artifacts have different publish paths and 2021 is the only cycle with flash
    // records at all, so gating the section on both would hide one that is there.
    serve({ "national_summary.json": SUMMARY, "flash.json": FLASH });
    expect(
      await screen.findByText(bgCorpus.dashboard_section_anomalies),
    ).toBeInTheDocument();
  });
});

describe("the risk-votes section", () => {
  // ⚠⚠ THE EMPTY STATE IS THE DANGEROUS ONE HERE. „Рискови гласове" over a blank is an
  // insinuation about eight named Roma districts with no figures under it, so the section is
  // gated on the tile's OWN content predicate rather than on the query settling.
  const serve = (files: Record<string, unknown>) => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      seen.push(u);
      for (const [needle, body] of Object.entries(files))
        if (u.includes(needle))
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    render(<PresidentialCycleScreen />, { wrapper: wrapperAt(ROUTE) });
    return seen;
  };

  const rates = {
    turnoutPct: 48.09,
    invalidPct: 5.31,
    additionalPct: 2.73,
    paperBallots: 45979,
    actualVoters: 40012,
  };

  const HOODS = {
    cycle: LATEST_PRESIDENTIAL_CYCLE,
    round: 1,
    basis: "КВАРТАЛНАТА ОГРАДА",
    basisEn: "THE DISTRICT CAVEAT",
    coverage: {
      catalogue: 8,
      located: 1,
      missing: [],
      sections: 133,
      sectionsInCycle: 12015,
      validVotes: 40734,
      pctOfValid: 1.16,
    },
    national: { ...rates, turnoutPct: 56.26, invalidPct: 3.05 },
    totals: rates,
    tickets: [
      {
        number: 6,
        president: "Румен Георгиев Радев",
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
        ...rates,
        leader: { number: 6, president: "Румен Георгиев Радев", pct: 26.45 },
      },
    ],
  };

  it("renders NO heading when the artifact is not published", async () => {
    const seen = serve({ "national_summary.json": SUMMARY });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    await waitFor(() =>
      expect(seen.some((u) => u.includes("neighborhoods.json"))).toBe(true),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-outcome-canvas]")).toBeTruthy(),
    );
    expect(
      screen.queryByText(bgCorpus.dashboard_section_neighborhoods),
    ).toBeNull();
  });

  it("renders NO heading when the payload located no district", async () => {
    // ⚠⚠ THE STATE A STATUS GATE GETS WRONG, and the reason `hasNeighborhoodContent` exists.
    const seen = serve({
      "national_summary.json": SUMMARY,
      "neighborhoods.json": {
        ...HOODS,
        coverage: { ...HOODS.coverage, located: 0, sections: 0, validVotes: 0 },
        places: [],
      },
    });
    await screen.findByText(bgCorpus.presidential_ranking_heading);
    await waitFor(() =>
      expect(seen.some((u) => u.includes("neighborhoods.json"))).toBe(true),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-outcome-canvas]")).toBeTruthy(),
    );
    expect(
      screen.queryByText(bgCorpus.dashboard_section_neighborhoods),
    ).toBeNull();
  });

  it("renders the heading, the caveat and the district once it is published", async () => {
    // ⚠ THE MUTATION CHECK for the two above, and it also pins that the section uses the SAME
    // heading key the parliamentary dashboard does — one question, one name.
    serve({
      "national_summary.json": SUMMARY,
      "neighborhoods.json": HOODS,
    });
    expect(
      await screen.findByText(bgCorpus.dashboard_section_neighborhoods),
    ).toBeInTheDocument();
    expect(screen.getByText("КВАРТАЛНАТА ОГРАДА")).toBeTruthy();
    expect(screen.getByText("Столипиново / Шекер махала")).toBeTruthy();
  });
});
