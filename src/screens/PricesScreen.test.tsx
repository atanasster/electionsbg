// The wiring, not the figures — `pricesHubFigures.test.ts` owns those.
//
// ⚠️ WHAT THIS EXISTS FOR: §3.1 rule 5 is resolved FOUR different ways on this page, and
// three of them are invisible to a unit test of the builder —
//
//   hero     the big number goes and the CHART stays, so the demotion must not also take
//            the base/as-of caption (a caption with nothing to caption reads as a second,
//            missing statistic) nor leave the coverage clause opening with a dangling „ · "
//   chains   the tile is a LIST, so it starts at the second row rather than blanking
//   verdict  the tile is a three-bucket BAR with no metric to blank, so only its heading
//            changes — it stopped asking the question the <h1> now asks
//   deals    an ordinary metric, simply withheld
//
// Only a render can see any of that.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PricesScreen } from "./PricesScreen";

/** Verbatim from the live payloads, 2026-08-31 (corpus day 2026-08-30). */
const HUB = {
  products: 46682,
  dearerPct: 21,
  cheaperPct: 22,
  chains: 85,
  settlements: 169,
  categories: 14,
  basketChangePct: -1,
  biggestDealPct: 54,
  foodInflationPct: 3.8,
  basketFrom: "2026-01-02",
  basketAsOf: "2026-08-30",
  basketWindowFrom: "2026-08-24",
  basketWindowDays: 7,
  cheapestChains: [
    { eik: "111017831", chain: "ЖИЗЕЛ", basket: 14.56 },
    { eik: "131071587", chain: "Лидл България", basket: 15.09 },
  ],
  comparableChainCount: 28,
  rankedChainCount: 85,
  commonBasketSize: 12,
  basketPricedOn: "2026-08-30",
};

const INDEX = {
  firstDate: "2026-01-02",
  baseline: "2026-01-02",
  categories: [{ id: 1, bg: "Хляб", en: "Bread" }],
  coverage: {
    chains: 85,
    settlements: 169,
    headlineDate: "2026-08-30",
    incompleteDates: [],
  },
  national: {
    index: [
      { d: "2026-01-02", v: 100, n: 900 },
      { d: "2026-08-30", v: 99, n: 900 },
    ],
    byCategory: { 1: [{ d: "2026-08-30", v: 99, n: 900 }] },
  },
};

const CHAINS = {
  commonBasketSize: 12,
  national: [
    { eik: "111017831", chain: "ЖИЗЕЛ", basket: 14.56, nPriced: 12 },
    { eik: "131071587", chain: "Лидл България", basket: 15.09, nPriced: 12 },
    { eik: "127585839", chain: "BulMag", basket: 15.25, nPriced: 12 },
  ],
};

/** The DEALS payload — a second blob, and the one that dates the band's fourth cell. */
const DEALS = {
  latestDate: "2026-08-30",
  deals: [
    { slug: "a", title: "Кашкавал", discPct: 54, promo: 5.2, reg: 11.3 },
    { slug: "b", title: "Олио", discPct: 40, promo: 2.1, reg: 3.5 },
    { slug: "c", title: "Ориз", discPct: 33, promo: 1.9, reg: 2.8 },
    { slug: "d", title: "Кафе", discPct: 30, promo: 6.1, reg: 8.7 },
    { slug: "e", title: "Захар", discPct: 25, promo: 1.4, reg: 1.9 },
  ],
};

const mount = (hub: unknown = HUB) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes("hub-stats")
        ? hub
        : u.includes("kind=index")
          ? INDEX
          : u.includes("kind=chains")
            ? CHAINS
            : u.includes("kind=deals")
              ? DEALS
              : null;
      return body
        ? { ok: true, status: 200, json: async () => body }
        : { ok: false, status: 404, json: async () => null };
    }),
  );
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/prices"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PricesScreen />, { wrapper: Wrapper });
};

afterEach(() => vi.unstubAllGlobals());

// ⚠️ THE HARNESS MOUNTS EN, so this screen's `T(bg, en)` helper returns the ENGLISH half of
// every literal. Asserting on the Bulgarian string is VACUOUS — `not.toContain("спрямо")`
// passes on a page that still renders „vs". Every literal below is the EN one deliberately.
const cells = () => [...document.querySelectorAll("[data-kpi-cell]")];
const head = () => document.querySelector("[data-hub-head]");

/** A tile in the GRID, by destination — never the band cell that shares that destination. */
const gridTile = (href: string) =>
  document.querySelector(`a[href^="${href}"]:not([data-kpi-cell])`)
    ?.parentElement;

describe("PricesScreen", () => {
  it("renders exactly one h1, and it is the head's", async () => {
    // The old `<Title>` + `<SEO>` pair is GONE rather than kept beside `HubHead` — two h1s
    // is what `hubHead.gates.test.ts` globs for, and two `<SEO>`s is a last-writer-wins
    // race over the canonical.
    mount();
    await waitFor(() => expect(head()).not.toBeNull());
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe("prices_head_title");
  });

  it("puts the search box in the head's slot, not loose above the grid", async () => {
    mount();
    await waitFor(() => expect(head()).not.toBeNull());
    // The /persons and /parliament shape. A search field inside the head is why those two
    // budgets are wider than /procurement's.
    expect(head()!.querySelector("input")).not.toBeNull();
  });

  it("renders the four band cells at their own destinations", async () => {
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(cells().map((c) => c.getAttribute("href"))).toEqual([
      "/consumption/categories",
      "/consumption/products",
      "/consumption/chain/111017831",
      "/consumption/deals",
    ]);
  });

  it("⚠️ the demoted hero drops its CAPTION with its number", async () => {
    // A caption is a caption OF something. „спрямо 2 яну · числото е към 30 авг" under no
    // figure describes the chart's own axis and reads as a second, missing statistic — the
    // lone-caption shape `InfographicTile` guards against by construction and a hand-rolled
    // Card does not.
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    const hero = document.querySelector('[data-testid="prices-hero"]')!;
    // ⚠️ THE FIGURE ITSELF FIRST — without this the caption clause below passes on a hero
    // that kept its number, which is the half rule 5 is actually about.
    //
    // ⚠️ ON THE ELEMENT, NOT ON THE STRING. The obvious form — `not.toContain("−1.0%")` —
    // asserts nothing: the headline is a TRAILING MEAN, so this two-point fixture yields
    // −0,5% rather than the blob's −1%, and the literal never matched. The big number has
    // its own `text-4xl` class and nothing else in the card does.
    expect(hero.querySelector(".text-4xl")).toBeNull();
    expect(hero.textContent).not.toContain("vs ");
    expect(hero.textContent).not.toContain("figure as of");
    // Non-vacuity: the caption's OTHER half is still there, so this is not asserting over
    // an empty card.
    expect(hero.textContent).toContain("chains");
  });

  it("⚠️ and does not leave the coverage clause opening with a dangling separator", async () => {
    // That clause used to FOLLOW the base/as-of text and hard-coded its own leading „ · ".
    // With the hero demoted it is first.
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    const hero = document.querySelector('[data-testid="prices-hero"]')!;
    expect(hero.textContent).toContain("169");
    expect(hero.textContent).not.toContain("· 169");
  });

  it("keeps the hero's CHART, which is what its demotion leaves behind", async () => {
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(
      document.querySelector(".col-span-full svg, .col-span-full canvas"),
    ).not.toBeNull();
  });

  it("⚠️ the chains tile starts at the SECOND chain, which the band did not name", async () => {
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    const tile = gridTile("/consumption/chains");
    expect(tile).toBeTruthy();
    // ЖИЗЕЛ is the band's own cell; the tile shows the runners-up.
    expect(tile!.textContent).toContain("Лидл");
    expect(tile!.textContent).not.toContain("ЖИЗЕЛ");
  });

  it("⚠️ the verdict tile stops asking the question the h1 now asks", async () => {
    // „Виновно ли е еврото?" sat 200px under an h1 reading „Какво се случи с цените след
    // еврото" — the same question twice. The tile keeps its bar (there is no metric to
    // blank) and its heading becomes what it actually shows.
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(document.body.textContent).not.toContain("Is the euro to blame");
    expect(document.body.textContent).toContain("How the products split");
  });

  it("⚠️ the DEALS tile does not repeat the band's own discount", async () => {
    // TEST-001. The header enumerates four rule-5 resolutions and this was the untested
    // one — „an ordinary metric, simply withheld". Writing the clause is what forces the
    // question „withheld from WHERE?", and the answer had been wrong: the demotion blanked a
    // small line in the hero's stat row while the Deals TILE, which the band cell links to,
    // still led with the identical −54%. `biggestDealPct` IS `deals[0].discPct`.
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    // ⚠️ `:not([data-kpi-cell])` IS LOAD-BEARING. The band's fourth cell links to
    // /consumption/deals too, so an unscoped query returns the CELL — which of course
    // contains „54%", and the assertion then fails against correct code and would pass
    // against the broken version. Measured: that is exactly what happened.
    const tile = gridTile("/consumption/deals");
    expect(tile).toBeTruthy();
    expect(tile!.textContent).not.toContain("54%");
    // …and the runners-up are still there, so this is not asserting over an emptied tile.
    expect(tile!.textContent).toContain("40%");
    // The hero's secondary restatement goes too.
    const hero = document.querySelector('[data-testid="prices-hero"]')!;
    expect(hero.textContent).not.toContain("biggest deal");
  });

  it("keeps the deals leader when the band did NOT take it", async () => {
    // Non-vacuity for the clause above: with the demotion applied unconditionally, it would
    // pass over a tile that had simply lost its first row for no reason.
    mount({ ...HUB, biggestDealPct: null });
    await waitFor(() => expect(cells()).toHaveLength(3));
    // ⚠️ `:not([data-kpi-cell])` IS LOAD-BEARING. The band's fourth cell links to
    // /consumption/deals too, so an unscoped query returns the CELL — which of course
    // contains „54%", and the assertion then fails against correct code and would pass
    // against the broken version. Measured: that is exactly what happened.
    const tile = gridTile("/consumption/deals");
    expect(tile!.textContent).toContain("54%");
  });

  it("renders NO band, and no promotion, when the blob is missing", async () => {
    // Every figure stays on its tile — a page that loses its head must not also lose its
    // numbers.
    mount(null);
    await waitFor(() => expect(document.querySelector("h1")).not.toBeNull());
    expect(cells()).toHaveLength(0);
    expect(document.body.textContent).toContain("Is the euro to blame");
  });
});
