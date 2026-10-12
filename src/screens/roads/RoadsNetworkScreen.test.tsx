// ?corridor on /sector/roads/network: the hub's evidence rail links here with it,
// so a known corridor must arrive focused, an unknown one must be ignored rather
// than drawn as an empty focus, and clearing it must write the URL back.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { buildRoadsModel } from "@/lib/roadAttributes";
import type { ProcurementContract } from "@/data/dataTypes";

const model = buildRoadsModel([
  {
    key: "k1",
    tag: "contract",
    date: "2024-01-01",
    contractorEik: "1",
    contractorName: "Фирма",
    amountEur: 1_000_000,
    title: "Ремонт на АМ „Хемус“ от км 10+000 до км 20+000",
  } as ProcurementContract,
]);

vi.mock("@/data/roads/useRoadsModel", () => ({
  useRoadsModel: () => ({ model, isLoading: false, isError: false }),
}));
vi.mock("@/screens/components/procurement/roads/RoadNetworkCard", () => ({
  RoadNetworkCard: (p: {
    focusCorridor: string | null;
    onFocusCorridor: (c: string | null) => void;
  }) => (
    <button data-testid="card" onClick={() => p.onFocusCorridor(null)}>
      {p.focusCorridor ?? "none"}
    </button>
  ),
}));
vi.mock("@/screens/components/procurement/roads/RoadChainageStripTile", () => ({
  RoadChainageStripTile: () => null,
}));
vi.mock("@/screens/components/ScopeControl", () => ({
  ScopeControl: () => null,
}));

const { RoadsNetworkScreen } = await import("./RoadsNetworkScreen");

const Where = () => <span data-testid="search">{useLocation().search}</span>;
const mount = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/sector/roads/network${search}`]}>
      <RoadsNetworkScreen />
      <Where />
    </MemoryRouter>,
  );

describe("RoadsNetworkScreen ?corridor", () => {
  it("focuses a known corridor", () => {
    mount("?corridor=%D0%A5%D0%B5%D0%BC%D1%83%D1%81&pscope=all");
    expect(screen.getByTestId("card").textContent).toBe("Хемус");
  });

  it("ignores an unknown one", () => {
    mount("?corridor=nope");
    expect(screen.getByTestId("card").textContent).toBe("none");
  });

  it("clearing removes the param and keeps the rest", () => {
    mount("?corridor=%D0%A5%D0%B5%D0%BC%D1%83%D1%81&pscope=all");
    fireEvent.click(screen.getByTestId("card"));
    expect(screen.getByTestId("search").textContent).toBe("?pscope=all");
  });
});
