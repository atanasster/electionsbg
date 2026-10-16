// The roads cross-link reads its figure from the roads hub blob. Two states: the
// blob present (the amount and its whole-period basis show) and absent (the clause
// is dropped, never rendered as „€0").

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const hub = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/data/roads/hubStats", () => ({
  useRoadsHubStats: () => ({ data: hub.data }),
}));

import { TransportRoadsLinkTile } from "./TransportRoadsLinkTile";

const renderTile = () =>
  render(
    <MemoryRouter>
      <TransportRoadsLinkTile />
    </MemoryRouter>,
  );

describe("TransportRoadsLinkTile", () => {
  beforeEach(() => {
    hub.data = null;
  });

  it("shows the roads figure with its whole-period basis when the blob loads", () => {
    hub.data = { procurement: { eur: 9_138_095_867 } };
    renderTile();
    expect(screen.getByText(/in contracts over the whole period/)).toBeTruthy();
  });

  it("drops the amount clause while the blob is missing", () => {
    renderTile();
    const p = screen.getByText(/is a separate sector and is not counted/);
    expect(p.textContent).not.toMatch(/€/);
  });
});
