// /following renders two lists off one fetch: the site-wide feed, and the subset the reader
// follows. The controls: the empty state doubles as the follow explainer; the followed
// section filters to the local watchlist; and the request carries NO watchlist (a privacy
// property — the URL must be the same for every reader).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { NewFilingRow } from "./useNewFilings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { FollowingScreen } from "./FollowingScreen";
import { watchlist } from "@/lib/watchlist";

const row = (o: Partial<NewFilingRow>): NewFilingRow => ({
  slug: "x",
  name: "X",
  year: 2018,
  fiscalYear: 2018,
  declarationType: "Annualy",
  institution: "Some agency",
  positionTitle: null,
  firstSeen: "2026-07-24",
  filedAt: "2019-03-01",
  sourceUrl: `https://register.cacbg.bg/${o.slug ?? "x"}.xml`,
  ...o,
});

const FEED = [
  row({ slug: "ivan-a", name: "Иван А" }),
  row({ slug: "petar-b", name: "Петър Б" }),
  row({ slug: "georgi-c", name: "Георги В" }),
];

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  fetchSpy = vi.fn(async () => ({ json: async () => FEED }) as Response);
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const draw = () =>
  render(
    <MemoryRouter>
      <FollowingScreen />
    </MemoryRouter>,
  );

describe("FollowingScreen", () => {
  it("shows the follow explainer and the whole site-wide feed when following nobody", async () => {
    draw();
    await waitFor(() =>
      expect(screen.getByText("Георги В")).toBeInTheDocument(),
    );
    // The empty-state help is shown instead of a "following" section.
    expect(screen.getByText("pp_watch_empty_help")).toBeInTheDocument();
    expect(screen.getByText("pp_watch_sitewide_title")).toBeInTheDocument();
    // All three feed rows render (site-wide list).
    expect(
      screen.getAllByRole("link", { name: /Иван А|Петър Б|Георги В/ }),
    ).toHaveLength(3);
  });

  it("shows the followed subset and still the full feed once someone is followed", async () => {
    watchlist.toggle("ivan-a");
    draw();
    await waitFor(() =>
      expect(screen.getByText("pp_watch_following_count")).toBeInTheDocument(),
    );
    expect(screen.queryByText("pp_watch_empty_help")).not.toBeInTheDocument();
    // Ivan appears twice: once in the followed section, once in the site-wide feed.
    // Petar/Georgi appear once each (site-wide only).
    expect(screen.getAllByRole("link", { name: "Иван А" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Петър Б" })).toHaveLength(1);
  });

  // The privacy property: the request must never carry the watchlist.
  it("fetches the site-wide feed without transmitting the follow list", async () => {
    watchlist.toggle("ivan-a");
    watchlist.toggle("petar-b");
    draw();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).toMatch(/\/api\/db\/new-filings/);
      expect(url).not.toMatch(/ivan-a|petar-b|slugs=/);
    }
  });
});
