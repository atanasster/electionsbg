// The country choropleth's three claims, each of which would render as a working map.
//
// ⚠ A MAP THAT CANNOT BE REACHED FROM A KEYBOARD LOOKS IDENTICAL TO ONE THAT CAN.
// `FeatureMap` derives access as `!!ariaLabel && !!onClick`, so a region missing either is
// silently mouse-only — the defect §6 names, and the one this file exists to pin.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialRegionsMap } from "./PresidentialRegionsMap";
import type { PresidentialTicket } from "@/data/presidential/useTickets";
import { TooltipProvider } from "@/components/ui/tooltip";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const GEO = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { nuts3: "BLG" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [23, 41.5],
            [23.5, 41.5],
            [23.5, 42],
            [23, 42],
            [23, 41.5],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: { nuts3: "BGS" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [27, 42],
            [27.5, 42],
            [27.5, 42.5],
            [27, 42.5],
            [27, 42],
          ],
        ],
      },
    },
  ],
};

/** The same geometry with Sofia's 23rd МИР in place of Бургас. */
const SOFIA_GEO = {
  ...GEO,
  features: [
    GEO.features[0],
    { ...GEO.features[1], properties: { nuts3: "S23" } },
  ],
};

const TICKETS = new Map<number, PresidentialTicket>([
  [
    6,
    {
      number: 6,
      president: "Румен Радев",
      vicePresident: "Илияна Йотова",
      nominatedBy: { name: "ИК", kind: "committee" },
      color: "rgb(1, 2, 3)",
    },
  ],
]);

const LEADERS = new Map([
  ["BLG", { number: 6, votes: 100, shareOfTicketVotes: 0.55 }],
  // ⚠ SOFIA 23 МИР. `regions.json` carries a `long_name` for exactly three rows and a bare
  // `name` of „23"/„24"/„25" — read without it, these are the FIRST rows of the table
  // (localeCompare sorts digits ahead of letters), each a link whose entire text is a number.
  ["S23", { number: 6, votes: 10, shareOfTicketVotes: 0.4 }],
]);

const mount = (node: React.ReactNode, geo: unknown = GEO) => {
  globalThis.fetch = (async (url: RequestInfo | URL) =>
    String(url).includes("regions_map.json")
      ? new Response(JSON.stringify(geo), { status: 200 })
      : new Response("", { status: 404 })) as typeof fetch;
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TooltipProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  void i18n.changeLanguage("bg");
  // jsdom has no `matchMedia`; the world inset sizes itself with it.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
});

describe("PresidentialRegionsMap", () => {
  it("makes every region a keyboard-operable button naming its leading PAIR", async () => {
    mount(
      <PresidentialRegionsMap
        cycle="2021_11_14_pvr"
        round={1}
        leaders={LEADERS}
        tickets={TICKETS}
      />,
    );
    const led = await screen.findByRole("button", { name: /Румен Радев/ });
    // ⚠ BOTH HALVES. A label without an activation, or an activation without a label, leaves
    // `FeatureMap`'s `keyboard` false and the region reachable by mouse only.
    expect(led.getAttribute("tabindex")).toBe("0");
    expect(led.getAttribute("aria-label")).toContain("Благоевград");
  });

  it("names Sofia's МИР in full in the accessible label too", async () => {
    // The map and its text twin must spell a place the same way, or the §4 pairing is worth
    // nothing: a reader matching the tooltip against the table would compare „София 23 МИР"
    // with „23".
    mount(
      <PresidentialRegionsMap
        cycle="2021_11_14_pvr"
        round={1}
        leaders={LEADERS}
        tickets={TICKETS}
      />,
      SOFIA_GEO,
    );
    const btn = await screen.findByRole("button", { name: /София/ });
    expect(btn.getAttribute("aria-label")).not.toMatch(/^23:/);
  });

  it("colours a region with NO leader in the neutral fill, never another pair's", async () => {
    // ⚠ BGS has no entry in `leaders` — nobody voted, or the roll-up does not cover it. Giving
    // it the leading pair's colour would put a named person's fill on a place they did not win.
    mount(
      <PresidentialRegionsMap
        cycle="2021_11_14_pvr"
        round={1}
        leaders={LEADERS}
        tickets={TICKETS}
      />,
    );
    const led = await screen.findByRole("button", { name: /Румен Радев/ });
    expect(led.getAttribute("fill")).toBe("rgb(1, 2, 3)");
    // The other region has no leader. Compared by the ARIA label rather than by node
    // identity: `findByRole` returns an `HTMLElement` and the paths are `SVGPathElement`s,
    // which do not overlap as TYPES even though one of them is literally the same node.
    const others = [...document.querySelectorAll("path")].filter(
      (p) => p.getAttribute("aria-label") !== led.getAttribute("aria-label"),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const p of others)
      expect(p.getAttribute("fill")).not.toBe("rgb(1, 2, 3)");
  });

  it("renders nothing rather than throwing when the geography is not a feature collection", async () => {
    // ⚠ `useRegionsMap` has NO shape guard, so an HTML error page or some other JSON arrives
    // here as an object with no `features` — and with no error boundary in `src/` a render-time
    // `TypeError` unmounts the React ROOT: a white screen for the whole SPA, not a missing map.
    const { container } = mount(
      <PresidentialRegionsMap
        cycle="2021_11_14_pvr"
        round={1}
        leaders={LEADERS}
        tickets={TICKETS}
      />,
      { not: "a feature collection" },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll("path").length).toBe(0);
  });
});

describe("the hover card", () => {
  const entry = (key: string, votes: [number, number][]) => ({
    key,
    results: {
      votes: votes.map(([partyNum, totalVotes]) => ({ partyNum, totalVotes })),
    },
  });
  const rollup = (entries: ReturnType<typeof entry>[]) => ({
    coverage: { basis: "x", sections: 1, excludedSections: 0 },
    entries,
  });
  const TWO = new Map<number, PresidentialTicket>([
    ...TICKETS,
    [
      2,
      {
        number: 2,
        president: "Анастас Герджиков",
        vicePresident: "Невяна Митева",
        nominatedBy: { name: "ИК", kind: "committee" },
        color: "rgb(4, 5, 6)",
      },
    ],
  ]);

  it("lists the leading pairs with votes and share for BOTH rounds, the shown one marked", async () => {
    // ⚠ THE PARLIAMENTARY CARD'S JOB FOR A TWO-ROUND BALLOT. One sentence about the leader
    // („води Радев с 55%") was what the card used to say; a reader hovering a place wants the
    // result, and the two rounds are different results.
    mount(
      <PresidentialRegionsMap
        cycle="2021_11_14_pvr"
        round={2}
        leaders={LEADERS}
        tickets={TWO}
        rounds={[
          {
            round: 1,
            regions: rollup([
              entry("BLG", [
                [6, 60],
                [2, 40],
              ]),
            ]),
          },
          {
            round: 2,
            regions: rollup([
              entry("BLG", [
                [6, 70],
                [2, 30],
              ]),
            ]),
            abroad: rollup([
              entry("TR", [
                [2, 5],
                [6, 1],
              ]),
            ]),
          },
        ]}
      />,
    );
    const led = await screen.findByRole("button", { name: /Благоевград/ });
    fireEvent.mouseEnter(led, { pageX: 10, pageY: 10 });
    const tip = await waitFor(() => {
      const n = document.querySelector("[data-presidential-tip]");
      if (!n) throw new Error("no card");
      return n as HTMLElement;
    });
    const r1 = tip.querySelector("[data-tip-round='1']")!;
    const r2 = tip.querySelector("[data-tip-round='2']")!;
    expect(r1.textContent).toContain("Румен Радев");
    expect(r1.textContent).toContain("60%");
    expect(r2.textContent).toContain("70%");
    expect(r2.textContent).toContain("Анастас Герджиков");
    // The round NOT on screen is dimmed rather than hidden.
    expect(r1.className).toContain("opacity-75");
    expect(r2.className).not.toContain("opacity-75");
  });

  it("links the world inset to the abroad results, coloured by who led abroad", async () => {
    mount(
      <PresidentialRegionsMap
        cycle="2021_11_14_pvr"
        round={1}
        leaders={LEADERS}
        tickets={TWO}
        rounds={[
          {
            round: 1,
            regions: rollup([entry("BLG", [[6, 60]])]),
            abroad: rollup([
              entry("TR", [
                [2, 5],
                [6, 1],
              ]),
              entry("DE", [[6, 2]]),
            ]),
          },
        ]}
      />,
    );
    const inset = await waitFor(() => {
      const n = document.querySelector("[data-map-abroad-inset]");
      if (!n) throw new Error("no inset");
      return n;
    });
    expect(inset.getAttribute("href")).toBe(
      "/presidential/2021_11_14_pvr/abroad",
    );
    // Summed across countries: Герджиков 5 against Радев 3.
    expect(inset.querySelector("g")?.getAttribute("fill")).toBe("rgb(4, 5, 6)");
  });
});
