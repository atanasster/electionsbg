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

/** The RANKING payload — the rail's own source, and a third blob. */
const RANKING = {
  coverage: { latestDate: "2026-08-30", chains: 85 },
  // ⚠️ THE RANKING'S OWN BASKET SIZE. The rail's denominator comes from the payload its rows
  // come from, not from the chains blob.
  commonBasketSize: 12,
  places: [
    // ⚠️ THE МИР ARTIFACTS ARE IN THE FIXTURE ON PURPOSE — `tier: "oblast"` is МИР-keyed and
    // carries the Пловдив CITY row (€13,59) beside обл. Пловдив (€17,68).
    { code: "PDV-00", name: "Пловдив", tier: "oblast", basketLevel: 13.59 },
    { code: "PDV", name: "обл. Пловдив", tier: "oblast", basketLevel: 17.68 },
    { code: "S23", name: "23", tier: "oblast", basketLevel: 16.33 },
    { code: "KNL", name: "Кюстендил", tier: "oblast", basketLevel: 14.35 },
    { code: "DOB", name: "Добрич", tier: "oblast", basketLevel: 14.36 },
    { code: "GAB", name: "Габрово", tier: "oblast", basketLevel: 14.42 },
    { code: "BGS", name: "Бургас", tier: "oblast", basketLevel: 14.48 },
    { code: "KRZ", name: "Кърджали", tier: "oblast", basketLevel: 19.93 },
  ],
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
              : u.includes("kind=ranking")
                ? RANKING
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

  it("carries NO search box — /consumption owns the one copy", async () => {
    mount();
    await waitFor(() => expect(head()).not.toBeNull());
    // Both pages rendered the SAME `ConsumptionSearchTile` over the same corpus, one click
    // apart, so this one was a duplicate rather than a second entry point. The assertion is
    // over the whole page, not just the head: re-adding it loose above the grid — where it
    // sat before it moved into the head's slot — is the same duplication back.
    expect(head()!.querySelector("input")).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(0);
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

  it("renders the rail, and it is the only place the oblasts appear", async () => {
    // ⚠️ `evidence={evidence}` IS COVERED BY NOTHING ELSE. A prop computed and never passed
    // compiles, type-checks and renders a head with no aside — it happened once on /culture.
    mount();
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head] aside")).not.toBeNull(),
    );
    const aside = document.querySelector("[data-hub-head] aside")!;
    // ⚠️ КЮСТЕНДИЛ, NOT ПЛОВДИВ. The payload's cheapest „oblast" row is the CITY of Пловдив;
    // the rail ranks real oblasts, where Пловдив is nowhere near the top.
    expect(aside.textContent).toContain("Кюстендил");
    expect(aside.textContent).not.toContain("Пловдив");
    const rows = [...aside.querySelectorAll('a[href^="/consumption/region/"]')];
    expect(rows).toHaveLength(4);

    // …and the „Най-евтини области" tile is gone, because those ARE its rows.
    const outside = [
      ...document.querySelectorAll('a[href^="/consumption/region/"]'),
    ].filter((a) => !a.closest("[data-hub-head]"));
    expect(
      outside,
      "the oblasts tile still lists the rail's rows",
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Cheapest oblasts");
    // ⚠️ AND ITS DESTINATION SURVIVES: /prices/map is the „Карта на цените" tile's too, so
    // what the demotion removed is a duplicate route rather than a route.
    expect(document.body.textContent).toContain("Price map");

    // ⚠️ AND NO TILE ANYWHERE REPEATS A RAIL ROW — the clause that catches the half both
    // builder gates are blind to. They compare rail values against BAND CELL values only, so
    // the „Карта на цените" tile went on printing `oblastLevels[0]` — the rail's own first
    // row, same label, same formatter — in plain <span>s that no href query can see.
    const railRows = [...aside.querySelectorAll("li")].map(
      (li) => li.textContent ?? "",
    );
    expect(railRows.length).toBeGreaterThan(0);
    // ⚠️ A TEST HOOK, not `.grid` — back when the page carried a search tile, `.grid`
    // matched THAT tile's own grid, so the loop below ran over an element containing none of
    // the tiles and passed against a map tile that WAS repeating the rail's first row.
    // Measured. The hook stays: the next element to grow a grid would do it again.
    const grid = document.querySelector('[data-testid="prices-grid"]')!;
    for (const row of railRows) {
      const label = row.replace(/[\d\s,.€]+$/, "").trim();
      const value = row.slice(label.length).trim();
      expect(label.length, `unparsed rail row: ${row}`).toBeGreaterThan(1);
      expect(
        grid.textContent,
        `the grid repeats the rail's ${label} ${value}`,
      ).not.toContain(`${label}${value}`);
    }
  });

  it("⚠️ the map tile SAYS which end it shows, and anchors its gap to it", async () => {
    // The demoted form renders ONE place and one €, in a grid whose neighbours („Най-евтини
    // вериги", „€ на килограм", the cheapest-oblasts tile in its undemoted form) are all
    // cheapest-first lists — so an unlabelled „Кърджали 18,37 €" reads as the top of another
    // cheapest ranking, which is the opposite of what it is. `text-red-600` is a hint, not a
    // label, and no test can see a colour anyway.
    mount();
    await waitFor(() => expect(cells()).toHaveLength(4));
    const tile = [...document.querySelectorAll('a[href="/prices/map"]')]
      .map((a) => a.closest("[class]")?.parentElement)
      .find((el) => el?.textContent?.includes("Price map"))!;
    expect(tile, "no /prices/map tile").toBeTruthy();
    expect(tile.textContent).toContain("dearest oblast");
    // ⚠️ AND THE GAP NAMES ONLY THE ROW THAT IS ON SCREEN. „X between the cheapest and the
    // dearest" cites two ends where one is rendered — the other is deliberately up in the
    // rail — so a reader hunts the tile for a cheapest row that is not there by design.
    expect(tile.textContent).toContain("above the cheapest oblast");
    expect(tile.textContent).not.toContain("between the cheapest and dearest");
  });

  it("keeps the oblasts tile when the rail was refused", async () => {
    // ⚠️ THE PAYLOAD DROPPED HERE IS `ranking`, WHICH IS ALSO THE TILE'S OWN SOURCE, so what
    // this pins is only that the tile's HEADING comes back — it renders a skeleton, and there
    // are no places to reach. That is worth pinning (the demotion must be conditional) but it
    // is not the degrade that breaks, which is the clause below.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        const body = u.includes("hub-stats")
          ? HUB
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
    render(<PricesScreen />, {
      wrapper: ({ children }) => (
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter initialEntries={["/prices"]}>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    });
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(document.querySelector("[data-hub-head] aside")).toBeNull();
    expect(document.body.textContent).toContain("Cheapest oblasts");
  });

  it("⚠️ keeps the tile's ROWS when the ranking is there and the rail is not", async () => {
    // TEST-003, and the state that actually breaks: `ranking` present, `chains` absent. The
    // rail needs a basket size and the tile does not, so the tile renders four REAL rows
    // while the head shows no aside — which is the only degrade where a reader can still see
    // the places. Dropping `ranking` instead tests a skeleton.
    //
    // ⚠️ IT FAILS IF THE RAIL'S DENOMINATOR MOVES BACK TO THE CHAINS BLOB, which is the
    // point: the rail's rows and its denominators must come from one payload.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        const body = u.includes("hub-stats")
          ? HUB
          : u.includes("kind=index")
            ? INDEX
            : u.includes("kind=deals")
              ? DEALS
              : u.includes("kind=ranking")
                ? RANKING
                : null;
        return body
          ? { ok: true, status: 200, json: async () => body }
          : { ok: false, status: 404, json: async () => null };
      }),
    );
    render(<PricesScreen />, {
      wrapper: ({ children }) => (
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter initialEntries={["/prices"]}>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    });
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head] aside")).not.toBeNull(),
    );
    // The rail is built from `ranking` alone, so it renders — and the tile it displaces is
    // gone, with the places still reachable from the head.
    expect(document.body.textContent).not.toContain("Cheapest oblasts");
    expect(
      document.querySelector("[data-hub-head] aside")!.textContent,
    ).toContain("Кюстендил");
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
