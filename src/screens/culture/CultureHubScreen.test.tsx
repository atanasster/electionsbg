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

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CultureHubScreen } from "./CultureHubScreen";
import { CULTURE_HUB_COPY } from "./cultureRegistry";
import { CULTURE_TILES } from "./cultureRegistry";

// The hub reads data/culture/derived/hub_stats.json for its tile metrics. There
// is no fetch stub here on purpose: the query fails in jsdom, `stats` stays
// undefined and `tileMetric` returns nothing — which is the state a checkout
// that never ran the generator is in, and the one the tiles must render cleanly.
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
});
