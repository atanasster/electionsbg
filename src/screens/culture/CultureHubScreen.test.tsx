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
import { CultureHubScreen } from "./CultureHubScreen";
import { CULTURE_HUB_COPY } from "./cultureRegistry";
import { CULTURE_TILES } from "./cultureRegistry";

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/culture"]}>
      <CultureHubScreen />
    </MemoryRouter>,
  );

describe("CultureHubScreen", () => {
  it("renders every tile as a link to its destination", () => {
    mount();
    for (const tile of CULTURE_TILES) {
      const title = CULTURE_HUB_COPY[tile.titleKey].en;
      const link = screen.getByRole("link", { name: new RegExp(title) });
      // React Router percent-encodes reserved characters in the query, so
      // `grade=C,D` renders as `grade=C%2CD`. URLSearchParams decodes it back on
      // read, so the destination sees the same value — compare decoded rather
      // than pinning one spelling.
      expect(decodeURIComponent(link.getAttribute("href") ?? "")).toBe(tile.to);
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
