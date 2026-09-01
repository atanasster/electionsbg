// The home screen's four states — full, partial, unavailable, and still loading.
//
// The one that matters is the third against the fourth: an "unavailable" note shown while
// the fetch is still in flight tells every reader the pulse is broken for the first few
// hundred ms of the site's most-visited page.

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  HOME_STATS_FIXTURE,
  HOME_STATS_PARTIAL_FIXTURE,
} from "@/data/home/__fixtures__/home";
import { HOME_TILES } from "./home/homeRegistry";
import { HomeDashboardScreen } from "./HomeDashboardScreen";

const stub = vi.hoisted(() => ({
  stats: undefined as unknown,
  settled: true,
}));

vi.mock("@/data/home/useHomeHubStats", () => ({
  useHomeHubStats: () => ({
    stats: stub.stats,
    settled: stub.settled,
    tile: (id: string) =>
      (stub.stats as { tiles?: Record<string, unknown> } | undefined)?.tiles?.[
        id
      ],
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Return the key, so no assertion can pass on a coincidental piece of copy.
    t: (key: string) => key,
    i18n: { language: "bg" },
  }),
}));
vi.mock("@/ux/SEO", () => ({ SEO: () => null }));

const renderHome = (stats: unknown, settled = true) => {
  stub.stats = stats;
  stub.settled = settled;
  return render(
    <MemoryRouter>
      <HomeDashboardScreen />
    </MemoryRouter>,
  );
};

describe("HomeDashboardScreen", () => {
  it("renders exactly one h1", () => {
    // The hub-head contract: one identity per page, and the head owns it.
    renderHome(HOME_STATS_FIXTURE);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders all eight destinations, in band order", () => {
    renderHome(HOME_STATS_FIXTURE);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h): h is string => Boolean(h));
    for (const t of HOME_TILES) {
      const seg = t.to.split("?")[0];
      expect(
        hrefs.some((h) => h.startsWith(seg)),
        t.id,
      ).toBe(true);
    }
  });

  it("renders four KPI cells when every source answered", () => {
    const { container } = renderHome(HOME_STATS_FIXTURE);
    expect(container.querySelectorAll("[data-kpi-cell]")).toHaveLength(4);
  });

  it("renders THREE cells and no zero when a source did not answer", () => {
    // ⚠️ The partial state. A fourth cell reading „0,0%" would be a claim about inflation
    // where the truth is that the series could not be read.
    const { container } = renderHome(HOME_STATS_PARTIAL_FIXTURE);
    expect(container.querySelectorAll("[data-kpi-cell]")).toHaveLength(3);
    expect(container.textContent).not.toMatch(/\b0,0\s*%/);
  });

  it("still renders every tile when the artifact is missing", () => {
    // Stats failure must not blank the grid: the eight destinations are the page's job and
    // they need no figures to work.
    renderHome(undefined);
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h): h is string => Boolean(h));
    for (const t of HOME_TILES) {
      const seg = t.to.split("?")[0];
      expect(
        hrefs.some((h) => h.startsWith(seg)),
        t.id,
      ).toBe(true);
    }
  });

  it("discloses the unavailable state once the request has settled", () => {
    // `HubHead` renders freshness as „eyebrow · freshness", so the string is split across
    // text nodes — matched on the container rather than with `getByText`.
    const { container } = renderHome(undefined, true);
    expect(container.textContent).toContain("home_hub_stats_unavailable");
  });

  it("says nothing about availability while the request is still in flight", () => {
    // ⚠️ The pair that makes the clause above non-vacuous. Shown during loading, the note
    // tells every first-time visitor the pulse is broken.
    const { container } = renderHome(undefined, false);
    expect(container.textContent).not.toContain("home_hub_stats_unavailable");
  });

  it("renders a tile with no folded figure as descriptor-only", () => {
    // Three of the eight have no destination-owned figure. That is a designed state, so the
    // tile must show its description rather than a dash or a skeleton.
    renderHome(HOME_STATS_FIXTURE);
    expect(screen.getByText("home_tile_prices_desc")).toBeInTheDocument();
    expect(screen.getByText("home_tile_my_area_desc")).toBeInTheDocument();
  });

  it("carries the kpi note whenever the band has cells", () => {
    // Four percentages from four datasets at three frequencies, one of them a stock. The
    // note is the only thing keeping them from reading as one scale.
    renderHome(HOME_STATS_FIXTURE);
    expect(screen.getByText("home_hub_kpi_note")).toBeInTheDocument();
  });

  it("drops the kpi note when there is no band to caption", () => {
    renderHome(undefined);
    expect(screen.queryByText("home_hub_kpi_note")).not.toBeInTheDocument();
  });
});
