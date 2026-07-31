// Component guard for the "Най-рискови договори" board. Both properties below are
// DECISIONS the tile encodes and nothing else enforces — each would be reverted by
// a plausible cleanup, and neither failure is visible in a type check or a row count.
//
//   1. THE ROW DATE IS `date`, NOT THE SIGNATURE. The scope filters on `date`
//      (useRiskiestContracts), and the two land in different YEARS on 13% of the
//      D/E/F rows — so a "use the real signed date everywhere" pass would put
//      "2022-07-25" in a board captioned 2024, the exact caption/row contradiction
//      the scope fix closed. The signature stays reachable as the date's tooltip.
//   2. THE "SEE ALL" LINK CARRIES THE SCOPE AND THE GRADE FILTER. A bare pathname
//      would drop ?pscope and land on the browser's default window — cf.
//      ProcurementTreemapTile, which does exactly that — and a missing ?grade
//      would open the whole corpus instead of the previewed set. Either way the
//      destination silently stops matching the rows above it.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RiskiestContract } from "@/data/procurement/useRiskiestContracts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));

const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/data/procurement/useRiskiestContracts", async (importOriginal) => ({
  // RISKIEST_GRADES is the value the see-all filter is built from, so take the
  // REAL one — a stub would let the assertion below pass against a wrong set.
  ...(await importOriginal<
    typeof import("@/data/procurement/useRiskiestContracts")
  >()),
  useRiskiestContracts: () => ({ data: rows.value }),
}));

import { RiskiestContractsTile } from "./RiskiestContractsTile";

// date_signed in a DIFFERENT YEAR from date — the 13% case the decision is about.
const row = (over: Partial<RiskiestContract> = {}): RiskiestContract =>
  ({
    key: "abc123",
    date: "2024-05-22",
    dateSigned: "2022-07-25",
    title: "Изпълнение на дейности по системна интеграция",
    awarderName: "Министерство на електронното управление",
    contractorName: "Информационно обслужване АД",
    amountEur: 6_000_000,
    riskFired: 6,
    riskAvailable: 11,
    riskGrade: "F",
    ...over,
  }) as RiskiestContract;

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <RiskiestContractsTile />
    </MemoryRouter>,
  );

describe("RiskiestContractsTile", () => {
  it("renders the contract subject and the date the scope filters on", () => {
    rows.value = [row()];
    renderAt("/procurement/overview?pscope=y:2024");
    expect(
      screen.getByText(/Изпълнение на дейности по системна интеграция/),
    ).toBeInTheDocument();
    // `date`, not `dateSigned` — 2024 (the captioned window), never 2022.
    expect(screen.getByText(/2024-05-22/)).toBeInTheDocument();
    expect(screen.queryByText(/2022-07-25/)).not.toBeInTheDocument();
  });

  it("keeps the distinct signing date reachable as the date's tooltip", () => {
    rows.value = [row()];
    renderAt("/procurement/overview");
    expect(screen.getByText(/2024-05-22/)).toHaveAttribute(
      "title",
      expect.stringContaining("2022-07-25"),
    );
  });

  it("shows no signing tooltip when date_signed is the load-time fallback", () => {
    // date_signed === date is the fallback the loader writes, not a signature.
    rows.value = [row({ dateSigned: "2024-05-22" })];
    renderAt("/procurement/overview");
    expect(screen.getByText(/2024-05-22/)).not.toHaveAttribute("title");
  });

  it("points 'see all' at the contracts browser, carrying the scope and the grades", () => {
    rows.value = [row()];
    renderAt("/procurement/overview?pscope=y:2024");
    const href = screen
      .getByRole("link", { name: /procurement_tile_see_all/ })
      .getAttribute("href");
    const url = new URL(href ?? "", "http://x");
    expect(url.pathname).toBe("/procurement/contracts");
    expect(url.searchParams.get("grade")).toBe("D,E,F");
    // The scope survives the click, or the destination answers a different window.
    expect(url.searchParams.get("pscope")).toBe("y:2024");
  });

  it("renders nothing when the scope has no elevated-risk contracts", () => {
    rows.value = [];
    const { container } = renderAt("/procurement/overview");
    expect(container).toBeEmptyDOMElement();
  });
});
