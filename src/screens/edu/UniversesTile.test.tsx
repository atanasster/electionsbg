// T4: each group's single-bid share is coloured against the same-window
// every-other-buyer rate; with no baseline nothing is coloured and the caption
// says so; a group with too few known-bid contracts shows no share at all.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UniversesTile } from "./EduProcurementScreen";
import type { UniverseRow } from "./eduSectorData";

const row = (
  universe: UniverseRow["universe"],
  single: number,
  known: number,
): UniverseRow => ({
  universe,
  totalEur: 1_000_000,
  contractCount: known,
  bidKnownN: known,
  singleBidN: single,
});

const renderTile = (rows: UniverseRow[], others: number | null) =>
  render(
    <MemoryRouter>
      <UniversesTile rows={rows} selected={null} others={others} />
    </MemoryRouter>,
  ).container;

const COLOURED = /text-(emerald|amber|red)-600/;

describe("UniversesTile — the single-bid colouring", () => {
  it("colours a share well above the baseline red and names the baseline", () => {
    const c = renderTile([row("ministry", 9, 10)], 0.417);
    expect(c.querySelector(".text-red-600")?.textContent).toMatch(/90/);
    expect(c.textContent).toMatch(/41[,.]7%/);
  });

  it("colours nothing without a baseline, and says why", () => {
    const c = renderTile([row("ministry", 9, 10), row("agency", 1, 10)], null);
    expect(c.innerHTML).not.toMatch(COLOURED);
    expect(c.textContent).toMatch(/не е налично|unavailable/);
  });

  it("shows no share for a group under the known-bid floor", () => {
    const c = renderTile([row("ministry", 2, 2)], 0.417);
    // The share is the only `font-medium` span on a row (the caption also says
    // „с една оферта", so the text alone cannot tell).
    expect(c.querySelector("li span.font-medium")).toBeNull();
    expect(c.textContent).not.toMatch(/100[,.]0%/);
  });
});
