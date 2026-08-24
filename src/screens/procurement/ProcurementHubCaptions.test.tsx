// What a READER sees under each tile number on /procurement.
//
// procurementHubBands.test.ts proves the registry's `metricBasis` declarations match how the
// blob's fields actually behave. It cannot prove the screen USES them — and measured, it did
// not need to: deleting `metricCaption: captionFor(p)` from ProcurementScreen, i.e. reverting
// that whole step, left every one of those gates green, and so did swapping two captions so
// the NGO tile read „запазени в този браузър" and the watchlist read the scope. A figure with
// the wrong window under it is the §0 defect the captions exist to prevent, so the rendered
// half needs its own gate.
//
// This mounts the real screen against a stubbed hub_stats fetch, so the assertions are on the
// DOM a reader gets.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProcurementScreen } from "../ProcurementScreen";
import { PROCUREMENT_TILES } from "./procurementRegistry";

// A NON-EMPTY watchlist, because the „local" caption is otherwise unobservable: with an empty
// list `metricFor` returns undefined, the tile shows no figure, and swapping the two basis
// branches in the screen changes nothing a test can see. Measured — that inversion passed all
// 48 tests before this mock existed.
vi.mock("@/data/procurement/useWatchlist", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useWatchlist: () => [
    { kind: "company", id: "1" },
    { kind: "company", id: "2" },
    { kind: "awarder", id: "3" },
  ],
}));

/** Distinct per field, so a caption attached to the wrong figure is visible in the assertion
 *  rather than hidden behind two equal numbers. */
const STAT = {
  totalEur: 93_598_116_768,
  contracts: 409_848,
  contractors: 29_633,
  connected: 898,
  tenders: 237_941,
  appeals: 7_938,
  ngos: 331,
  places: 871,
  flags: 2_766,
  awarderCount: 4_418,
  // The head's ranked list. Present here because the aside renders only when it is —
  // otherwise the link-scope clause below silently checks four links instead of seven.
  topAwarders: [
    {
      eik: "000695089",
      name: 'Агенция "Пътна инфраструктура"',
      eur: 8_822_447_923,
    },
    { eik: "130823243", name: "НКЖИ", eur: 3_458_624_682 },
    { eik: "175203478", name: "Булгартрансгаз", eur: 3_127_497_219 },
  ],
};

const mount = (search = "?pscope=all") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/procurement${search}`]}>
        <ProcurementScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("hub_stats.json"))
        return new Response(JSON.stringify({ all: STAT }), { status: 200 });
      // Everything else this screen reaches for (sector stats, search) may 404 — the tiles
      // must caption their own figures regardless.
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** The tile link for a registry `to`, located by href — stable, declared in the registry, and
 *  immune to how the harness resolves i18n or formats numbers. `usePreserveParams` may append
 *  a query, so match on the pathname.
 *
 *  Scoped to the tile GRID: the WatchlistDigestTile above it links to /procurement/watchlist
 *  as well and comes first in the DOM, so an unscoped query asserted against the wrong
 *  element — which it did, silently, until this test caught it. */
const tileFor = (to: string): HTMLElement => {
  const grid = document.querySelector('[data-og="procurement-hub"]');
  if (!grid) throw new Error("tile grid not rendered");
  const links = [...grid.querySelectorAll("a[href]")].filter(
    (a) => (a.getAttribute("href") ?? "").split("?")[0] === to,
  );
  if (!links.length) throw new Error(`no tile link for ${to}`);
  return links[0] as HTMLElement;
};

describe("/procurement tile captions", () => {
  it("puts the scope caption under every figure the registry declares one for", async () => {
    mount();
    await screen.findAllByText(/whole corpus/i);

    const scoped = PROCUREMENT_TILES.filter(
      (t) => t.metric && t.metricBasis === "scope",
    );
    expect(scoped.length, "no scope-captioned tiles to check").toBeGreaterThan(
      0,
    );

    for (const t of scoped) {
      const tile = tileFor(t.to);
      // The figure and its window, in the same tile. Deleting `metricCaption` from the screen
      // — the whole point of the step — fails right here.
      expect(
        within(tile).getAllByText(/whole corpus/i).length,
        `${t.id}: figure has no basis caption`,
      ).toBeGreaterThan(0);
      expect(
        /\d/.test(tile.textContent ?? ""),
        `${t.id}: caption with no figure above it`,
      ).toBe(true);
    }
  });

  it("captions the watchlist as browser-local, never as a corpus window", async () => {
    mount();
    await screen.findAllByText(/whole corpus/i);
    const watch = tileFor("/procurement/watchlist");
    // It is localStorage, not the corpus, so the scope caption would be false there — and
    // this is the assertion that catches the two branches being swapped.
    expect(watch.textContent).toMatch(/3/);
    // The harness does not load the i18n resources, so `t()` returns the KEY — which is the
    // stabler assertion anyway: it pins WHICH string the screen chose, not how it reads.
    // `scopeBasis` is an inline bilingual ternary rather than a `t()` call, so it renders as
    // real English („whole corpus · …") and the two are trivially distinguishable.
    expect(watch.textContent).toMatch(/procurement_basis_local/);
    expect(watch.textContent).not.toMatch(/whole corpus/i);
  });

  it("carries the active scope on every link out of the head", async () => {
    mount("?pscope=all");
    await screen.findAllByText(/whole corpus/i);
    // The two link sets the head owns: the KPI cells and the ranked list (rows + its
    // „see the ranking" action). Collected directly rather than by walking up from the aside,
    // which depends on wrapper markup this test should not know about.
    const band = document.querySelector(
      '[class*="sm:grid-cols"][class*="bg-border"]',
    );
    const aside = document.querySelector("aside");
    expect(band, "KPI band not rendered").toBeTruthy();
    expect(aside, "ranked list not rendered").toBeTruthy();

    const links = [
      ...(band as HTMLElement).querySelectorAll("a[href]"),
      ...(aside as HTMLElement).querySelectorAll("a[href]"),
    ].map((a) => a.getAttribute("href"));

    // ⚠ THIS IS WHAT THE BAND'S OWN CAPTIONS PROMISE. react-router's bare Link drops the
    // search, so „€93,6 млрд. · целият корпус" linked to /procurement/overview at its DEFAULT
    // scope — this parliament, €3,3 млрд., a top three with zero names in common with the
    // rows directly above it.
    expect(links.length).toBeGreaterThan(4);
    const bare = links.filter((h) => h && !h.includes("pscope=all"));
    expect(bare, `head link(s) dropping the scope: ${bare.join(", ")}`).toEqual(
      [],
    );
  });

  it("gives the NGO tile no figure at all", async () => {
    mount();
    await screen.findAllByText(/whole corpus/i);
    // Its blob field is 331 while /procurement/ngos opens on a different, larger set — so the
    // tile shows no number rather than one that disagrees with its own destination.
    const ngo = tileFor("/procurement/ngos");
    expect(ngo.textContent).not.toMatch(/331/);
    expect(ngo.textContent).not.toMatch(/whole corpus/i);
  });
});
