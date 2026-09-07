// The place page's WIRING — which id it asks the surface layer for, and what it says when
// there is nothing to show.
//
// ⚠ THE ABROAD ARM IS THE ONE WORTH PINNING. Its route carries no id and its artifact needs
// one, so the screen supplies a constant; get that wrong and the page fetches a file nobody
// wrote and renders a skeleton for ever — the failure mode `useElectionSurface` calls
// `pending`, which is deliberately NOT a fallback and therefore never resolves on its own.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { MAP_ADAPTERS } from "@/screens/elections/electionMapSlots";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialPlaceScreen } from "./PresidentialPlaceScreen";
import { PRESIDENTIAL_ABROAD_ID } from "@/data/elections/presidentialRoutes";
import type { PresidentialPlaceLevel } from "./PresidentialPlaceScreen";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";
import { artifactPath } from "@/data/elections/surfacePath";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Every level this screen serves, with the route that reaches it.
 *
 *  ⚠ THE LEVEL IS THE AXIS. The whole design is „one component, five levels", so testing two
 *  of them tests the design at 40%. `section` is the one that differs most: it is the only
 *  level passing `withMap={false}`, and its artifact lives at the sharded
 *  `…/section/by-oblast/<2-char>/<code>.json`, a prefix split no other level drives. */
const LEVELS = [
  {
    level: "region",
    pattern: "/presidential/:cycle/region/:oblast",
    path: "region/BLG",
    id: "BLG",
  },
  {
    level: "municipality",
    pattern: "/presidential/:cycle/municipality/:obshtina",
    path: "municipality/BLG04",
    id: "BLG04",
  },
  {
    level: "settlement",
    pattern: "/presidential/:cycle/settlement/:ekatte",
    path: "settlement/56784",
    id: "56784",
  },
  {
    level: "section",
    pattern: "/presidential/:cycle/section/:code",
    path: "section/021700054",
    id: "021700054",
  },
] as const;

const asked: string[] = [];
const mount = (
  path: string,
  pattern: string,
  level: PresidentialPlaceLevel,
) => {
  asked.length = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    asked.push(String(url));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PresidentialPlaceScreen level={level} />, {
    wrapper: Wrapper,
  });
};

beforeEach(() => {
  i18n.changeLanguage("bg");
  vi.restoreAllMocks();
});

describe("the presidential place page", () => {
  it("asks for the abroad artifact under the id the producer wrote it at", async () => {
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/abroad`,
      "/presidential/:cycle/abroad",
      "abroad",
    );
    await screen.findByText(bgCorpus.presidential_place_not_published);
    const expected = artifactPath(
      "abroad",
      LATEST_PRESIDENTIAL_CYCLE,
      PRESIDENTIAL_ABROAD_ID,
    );
    expect(expected).not.toBeNull();
    expect(asked.some((u) => u.endsWith(expected!))).toBe(true);
  });

  for (const c of LEVELS)
    it(`asks for the ${c.level} artifact at the path the producer wrote it to`, async () => {
      mount(
        `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/${c.path}`,
        c.pattern,
        c.level,
      );
      await screen.findByText(bgCorpus.presidential_place_not_published);
      const expected = artifactPath(c.level, LATEST_PRESIDENTIAL_CYCLE, c.id);
      expect(expected, c.level).not.toBeNull();
      expect(
        asked.some((u) => u.endsWith(expected!)),
        `${c.level}: asked ${asked.join(", ")}`,
      ).toBe(true);
    });

  it("shards a section's path by the oblast prefix of its code", async () => {
    // ⚠ THE ONE PATH SHAPE NO OTHER LEVEL EXERCISES. A section artifact lives under a
    // two-character oblast prefix, so a screen-side change that stopped passing the code
    // through would still produce a plausible-looking URL under a different directory.
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/section/021700054`,
      "/presidential/:cycle/section/:code",
      "section",
    );
    await screen.findByText(bgCorpus.presidential_place_not_published);
    expect(asked.some((u) => u.includes("/section/by-oblast/02/"))).toBe(true);
  });

  it("reserves a map slot only where an adapter fills one", () => {
    // ⚠ DERIVED FROM `MAP_ADAPTERS`, never retyped. A hand-written list here would agree with
    // the screen's hand-written list and both could be wrong about the registry together.
    const MAPPED = new Set(
      Object.keys(MAP_ADAPTERS)
        .filter((k) => k.startsWith("presidential/"))
        .map((k) => k.split("/")[1]),
    );
    // Anti-vacuity: an empty set would make this assert „no level reserves a box" and pass on a
    // screen that reserves none.
    expect(MAPPED.size).toBeGreaterThan(0);
    // The other per-level difference. It used to be „none for a section, one for everything
    // else", because a single polling station has no geography to answer a question about and
    // every other level DECLARED a map. Declaring one is not drawing one: `MAP_ADAPTERS` serves
    // `presidential/region|municipality/winner` and deliberately refuses `settlement` (its
    // grain is `section` — a marker map, a different component) and `abroad` (no
    // country→continent crosswalk). Reserving 360px on those two is the same layout shift in
    // the same direction as reserving it for a section.
    //
    // ⚠ THIS IS WHAT PINS `MAPPED_LEVELS` TO THE REGISTRY. The screen mirrors the registry by
    // hand rather than importing it — importing would pull every adapter's `import()` edge into
    // that screen's static closure, which is what the lazy indirection exists to prevent — so
    // this case is the only thing stopping the two drifting.
    //
    // ⚠ ASSERTED BEFORE THE FETCH RESOLVES. The skeleton is what the boundary renders while
    // LOADING; once the 404 lands the fallback replaces it, so an awaited assertion here would
    // measure the wrong tree and pass at 0 slots for every level.
    for (const c of LEVELS) {
      const { container, unmount } = mount(
        `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/${c.path}`,
        c.pattern,
        c.level,
      );
      expect(
        container.querySelectorAll('[data-skeleton-slot="map"]').length,
        c.level,
      ).toBe(MAPPED.has(c.level) ? 1 : 0);
      // …and the skeleton really is what is on screen, so the count above is not zero
      // because nothing rendered.
      expect(
        container.querySelectorAll("[data-surface-skeleton]").length,
        c.level,
      ).toBe(1);
      unmount();
    }
  });

  it("names the place rather than printing its code", async () => {
    // ⚠ A blank heading over a result is a page about nowhere; the code is the FALLBACK, and
    // for an oblast the corpus has a real name.
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/region/BLG`,
      "/presidential/:cycle/region/:oblast",
      "region",
    );
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).not.toBe("BLG");
    expect(heading.textContent?.length).toBeGreaterThan(2);
  });

  it("states the absence instead of rendering a heading over nothing", async () => {
    // ⚠ THERE IS NO LEGACY BODY FOR THIS FAMILY. Every other caller of the boundary falls back
    // to its own composition; here `null` would leave a place name and empty space.
    mount(
      `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/region/BLG`,
      "/presidential/:cycle/region/:oblast",
      "region",
    );
    expect(
      await screen.findByText(bgCorpus.presidential_place_not_published),
    ).toBeInTheDocument();
  });
});

describe("what the ranked rows say about a candidate", () => {
  /** A surface with BOTH rounds, so the two canvases can be told apart. Rows are people:
   *  `partyId` is null and the ballot number rides in `localPartyNum`, which is the shape the
   *  producer emits and the reason the shell cannot resolve a colour or a link for them. */
  const SURFACE = {
    schemaVersion: 1,
    kind: "presidential",
    cycle: LATEST_PRESIDENTIAL_CYCLE,
    place: { level: "region", id: "BLG" },
    status: { result: "final", sourceLabel: "cik", updatedAt: "2026-01-01" },
    facts: [],
    standouts: [],
    // ⚠ REQUIRED BY `isWellFormedElectionSurfaceV1`, and its absence is INVISIBLE at the
    // fixture: the boundary rejects the payload as malformed and renders the „not published"
    // fallback, so every assertion below fails on a missing element rather than on a wrong one.
    destinations: { completeResult: { to: "/presidential", available: true } },
    ballots: [1, 2].map((round) => ({
      kind: "presidential_ticket",
      round,
      resultStatus: "final",
      preview: [
        {
          partyId: null,
          localPartyNum: 6,
          candidateName: "Румен Георгиев Радев",
          votes: 100,
          pct: 60,
        },
      ],
      totals: { votesCast: 100, validVotes: 100, turnoutBasis: "unavailable" },
    })),
  };

  const mountSurface = () => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/surface/"))
        return new Response(JSON.stringify(SURFACE), { status: 200 });
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
                color: "rgb(9, 9, 9)",
              },
            ],
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    }) as typeof fetch;
    // ⚠ NOT `mount()`. That helper installs its OWN always-404 fetch as its first act, so
    // calling it here would silently discard the stub above and every assertion below would
    // fail against the „not published" fallback rather than against a rendered surface — which
    // is exactly what it did until this was written out.
    const path = `/presidential/${LATEST_PRESIDENTIAL_CYCLE}/region/BLG`;
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/presidential/:cycle/region/:oblast"
              element={children}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    return render(<PresidentialPlaceScreen level="region" />, {
      wrapper: Wrapper,
    });
  };

  it("names the ROUND on each canvas, not just inside the table", async () => {
    // ⚠ TWO CANVASES, ONE TITLE. Both ballots are `presidential_ticket`, so both headings read
    // „Кандидатски двойки" and the round was recoverable only from a „Тур" column inside the
    // table — with two MAPS below them, of electorates 5.7 points apart nationally that name
    // different leaders in whole oblasts. A map under an unlabelled heading is a map of an
    // unstated question.
    mountSurface();
    // ⚠ WAIT ON THE CAPTION, NOT THE HEADING. The heading now carries the round in a child
    // <span>, so its text is split across elements and an exact-string matcher never finds it —
    // which is the change under test.
    // Two canvases (one per round) means two captions — All, not one.
    await screen.findAllByText(bgCorpus.election_ranked_caption);
    const rounds = [...document.querySelectorAll("h2")]
      .map((h) => h.textContent ?? "")
      .filter((t) => t.includes(bgCorpus.election_ballot_presidential_ticket));
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toContain(
      bgCorpus.election_round.replace("{{round}}", "1"),
    );
    expect(rounds[1]).toContain(
      bgCorpus.election_round.replace("{{round}}", "2"),
    );
  });

  it("gives a candidate row the ticket's colour, as a party row gets its party's", async () => {
    // ⚠ THE SHELL CANNOT RESOLVE THIS AND MUST NOT GUESS. A presidential row carries
    // `partyId: null` — the nominator may be a party, a coalition or an инициативен комитет —
    // so the canonical party corpus has nothing to say about it and the rows rendered with no
    // swatch at all, on a page whose MAP is coloured by exactly that ticket. The screen passes
    // the colour in from `tickets.json`.
    mountSurface();
    // Two canvases (one per round) means two captions — All, not one.
    await screen.findAllByText(bgCorpus.election_ranked_caption);
    const swatches = [
      ...document.querySelectorAll(
        "[data-canvas-slot=ranked] span[aria-hidden]",
      ),
    ].filter((n) => (n as HTMLElement).style.backgroundColor);
    expect(swatches.length).toBeGreaterThan(0);
    expect((swatches[0] as HTMLElement).style.backgroundColor).toBe(
      "rgb(9, 9, 9)",
    );
  });

  it("links a candidate to their /person page", async () => {
    // The row is a PERSON, so its destination is `/person/:slug` rather than `/party/:id` —
    // and the resolver is `personHrefForTicket`, the same one the country page's ranking uses,
    // so one candidate cannot be a link on one page and plain text on the other.
    mountSurface();
    // Two canvases (one per round) means two captions — All, not one.
    await screen.findAllByText(bgCorpus.election_ranked_caption);
    const links = [
      ...document.querySelectorAll("a[data-ranked-entry-link]"),
    ] as HTMLAnchorElement[];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links)
      expect(a.getAttribute("href")).toMatch(/^\/person\//);
  });
});
