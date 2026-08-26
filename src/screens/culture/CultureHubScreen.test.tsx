// The hub renders no data of its own — every figure is a frozen string and every
// tile is a link — so the failure modes are structural, not numeric:
//
//   • a missing COPY key throws inside `t()` andwhite-screens the page;
//   • a missing scene renders `undefined` as a component and does the same;
//   • a tile whose `to` is wrong is invisible until somebody clicks it.
//
// `cultureRegistry.test.ts` checks those against the registry; this mounts the
// real component so a break in the WIRING (not the data) is caught too.
//
// Asserted against the ENGLISH copy: the harness's i18n default is `en`, and a
// test written against the Bulgarian strings passes only by accident of locale.

import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CultureHubScreen } from "./CultureHubScreen";
import { CULTURE_HUB_COPY } from "./cultureRegistry";
import { CULTURE_TILES } from "./cultureRegistry";

// The hub reads data/culture/derived/hub_stats.json for its tile metrics AND for the
// head's four-cell band. `mount()` has no fetch stub on purpose: the query fails in jsdom,
// `stats` stays undefined and both the band and `tileMetric` render nothing — the state a
// checkout that never ran the generator is in, and the one the page must render cleanly.
// `mountWith()` below stubs it, for the states where the band exists.
// The FIGURES are gated separately, against Postgres, in
// scripts/db/tests/culture_hub_figures.data.test.ts.
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={["/culture"]}>
        <CultureHubScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The same mount with the hub-stats query answered, so the BAND renders. */
const mountWith = (data: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("hub_stats.json")
        ? { ok: true, status: 200, json: async () => data }
        : { ok: false, status: 404, json: async () => null },
    ),
  );
  return mount();
};

afterEach(() => vi.unstubAllGlobals());

/** Verbatim from the committed blob, 2026-08-26. */
const FULL_STATS = {
  generatedAt: "2026-08-26",
  procurement: {
    contracts: 972,
    eur: 166898550,
    buyers: 59,
    suppliers: 408,
    singleBid: 0,
    bidKnown: 0,
    nationalSingleBid: 0,
    nationalBidKnown: 0,
    firstDate: "2011-01-19",
  },
  risk: { grades: {} },
  funds: {
    eikExactEur: 105920570,
    eikExactProjects: 47,
    byNameEur: 147024687,
    byNameProjects: 1365,
    chitalishtaEur: 0,
  },
  agri: { chitalishtaEur: 18341814, chitalishtaRows: 264 },
  interreg: { thematicEur: 0, partnerRows: 0, partners: 0, rowsWithEik: 0 },
  people: { culturalInstituteRoles: 0 },
  budget: { eur: 269051700, fiscalYear: 2026 },
  films: { eur: 94944781, films: 944, firstYear: 2014, lastYear: 2025 },
};
/** A blob minted before the two optional fields existed — the bucket-sync lag state. */
const BARE_STATS = (() => {
  const b = { ...FULL_STATS } as Record<string, unknown>;
  delete b.budget;
  delete b.films;
  return b;
})();

describe("CultureHubScreen", () => {
  it("renders every tile as a link to its destination", () => {
    mount();
    // Looked up by HREF, not by name. A tile's title can appear inside another
    // tile's description („The ministry" is also a word in the procurement
    // tile's copy), so a name regex matches two links and the assertion becomes
    // about the copy rather than about the wiring.
    //
    // React Router percent-encodes reserved characters in the query, so
    // `grade=C,D` renders as `grade=C%2CD`. URLSearchParams decodes it back on
    // read, so the destination sees the same value — compare decoded.
    const hrefs = screen
      .getAllByRole("link")
      .map((el) => decodeURIComponent(el.getAttribute("href") ?? ""));
    for (const tile of CULTURE_TILES) {
      expect(hrefs, `no link renders tile "${tile.id}" (${tile.to})`).toContain(
        tile.to,
      );
      const link = screen
        .getAllByRole("link")
        .find(
          (el) => decodeURIComponent(el.getAttribute("href") ?? "") === tile.to,
        );
      expect(link?.textContent).toContain(CULTURE_HUB_COPY[tile.titleKey].en);
    }
  });

  it("names every band", () => {
    mount();
    for (const key of [
      "culture_band_money",
      "culture_band_award",
      "culture_band_who",
    ])
      expect(screen.getByText(CULTURE_HUB_COPY[key].en)).toBeTruthy();
  });

  it("says the four streams do not sum", () => {
    // The one claim on this page that is an ARGUMENT rather than a number: the
    // streams sit on different bases and the tile order is editorial. Losing this
    // sentence turns the grid back into a leaderboard.
    mount();
    expect(screen.getByText(/do NOT sum/)).toBeTruthy();
  });

  it("renders the finder", () => {
    mount();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  // ⚠️ THE HIGHEST-RISK INVARIANT ON THIS PAGE, AND IT IS HELD BY TWO GUARDS IN TWO FILES
  // THAT MUST STAY EXACT COMPLEMENTS. The streams note renders as `kpiNote` when the head
  // draws its band block and as a paragraph above the grid when it does not — HubHead keeps
  // `kpiNote` INSIDE that block, so the two conditions cannot simply both be „is there a
  // note". Tightening one side gives ZERO placements and loosening the other gives TWO, and
  // both are silent at a 200. The suite could not see either until this fixture existed:
  // every case mounted with no stub, so only the no-blob state was ever entered.
  it.each([
    ["a full blob", FULL_STATS, 4],
    ["a blob predating the optional cells", BARE_STATS, 2],
    ["no blob at all", null, 0],
  ])(
    "renders the streams note exactly once with %s",
    async (_label, data, cells) => {
      mountWith(data);
      await screen.findByText(/do NOT sum/);
      expect(
        screen.getAllByText(/do NOT sum/),
        "the note must appear exactly once — never zero, never in both homes",
      ).toHaveLength(1);
      await waitFor(() =>
        expect(document.querySelectorAll("[data-kpi-cell]")).toHaveLength(
          cells,
        ),
      );
    },
  );
});
