// The project map's caption and links (transport-hub-v1 A8, C3): the coverage line
// shows when the function returns coverage and is hidden otherwise, and every feature
// links to the contracts browser over the bodies the CARD draws, on the page's scope.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TRANSPORT_SECTOR_EIKS } from "@/lib/transportReferenceData";

const state = vi.hoisted(() => ({
  coverage: null as null | { placedEur: number; totalEur: number },
}));
vi.mock("@/data/procurement/useTransportProjectMap", () => ({
  useTransportProjectMap: () => ({
    segments: [],
    points: [
      {
        town: "Варна",
        loc: [27.9, 43.2],
        facility: "port",
        contractCount: 3,
        totalEur: 1_000_000,
        bidKnownN: 3,
        singleBidN: 1,
      },
    ],
    coverage: state.coverage,
    isLoading: false,
  }),
}));
// Leaflet is not renderable in jsdom; expose each feature's link instead.
vi.mock("@/screens/components/maps/SectorPointMap", () => ({
  SectorPointMap: ({ points }: { points: { id: string; href: string }[] }) => (
    <ul>
      {points.map((p) => (
        <li key={p.id} data-href={p.href} />
      ))}
    </ul>
  ),
}));

import { TransportProjectMap } from "./TransportProjectMap";

const renderAt = (url: string, eiks?: string[]) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TransportProjectMap eiks={eiks} />
    </MemoryRouter>,
  );
const href = (c: HTMLElement) =>
  new URL(c.querySelector("li")!.getAttribute("data-href")!, "http://x");

describe("TransportProjectMap", () => {
  beforeEach(() => {
    state.coverage = null;
  });

  it("links the whole sector through the browse pack, keeping scope and dropping ?mode", () => {
    const { container } = renderAt("/sector/transport/network?pscope=all");
    const u = href(container);
    expect(u.pathname).toBe("/procurement/contracts");
    expect(u.searchParams.get("sector")).toBe("transport");
    expect(u.searchParams.get("pscope")).toBe("all");
    expect(u.searchParams.get("q")).toBe("Варна");
    expect(u.searchParams.has("mode")).toBe(false);
  });

  it("links a narrowed card to exactly its own bodies", () => {
    const eiks = TRANSPORT_SECTOR_EIKS.slice(0, 2);
    const { container } = renderAt(
      "/sector/transport/network?mode=rail&pscope=y:2025",
      eiks,
    );
    const u = href(container);
    expect(u.searchParams.has("sector")).toBe(false);
    expect(u.searchParams.get("awarder")).toBe(eiks.join(","));
    expect(u.searchParams.has("mode")).toBe(false);
  });

  it("shows the coverage line at one decimal only when coverage is returned", () => {
    renderAt("/sector/transport/network");
    expect(
      screen.queryByText(/places .* of the window's money|На картата са/),
    ).toBeNull();
    state.coverage = { placedEur: 35, totalEur: 1000 };
    renderAt("/sector/transport/network");
    expect(screen.getByText(/3[.,]5%/)).toBeTruthy();
  });
});
