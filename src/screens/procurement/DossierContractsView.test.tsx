// Guards the two dossier-mode branches and the headline invariant. useProjectFile
// is mocked so the test drives the resolved model directly (no network); the
// truncated branch renders a DbDataTable that fetches, so fetch is stubbed empty.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProcurementContract } from "@/data/dataTypes";

// Mutable model the mocked hook returns.
let model: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
};

vi.mock("@/data/procurement/useProjectFile", async (orig) => {
  const actual =
    await orig<typeof import("@/data/procurement/useProjectFile")>();
  return { ...actual, useProjectFile: () => model };
});

import { DossierContractsView } from "./DossierContractsView";

const contract = (over: Partial<ProcurementContract>): ProcurementContract =>
  ({
    key: "k",
    tag: "contract",
    date: "2021-05-01",
    awarderName: "Възложител",
    contractorName: "Изпълнител",
    amountEur: 1_000_000,
    ...over,
  }) as ProcurementContract;

const renderView = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter>
          <DossierContractsView
            spec={{ search: [{ terms: "x" }] }}
            title="Тест"
          />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        rows: [],
        total: 0,
        totalExact: true,
        page: 0,
        pageSize: 25,
        aggregates: {},
      }),
    })),
  );
});

describe("DossierContractsView — bounded branch (exact members)", () => {
  beforeEach(() => {
    model = {
      isLoading: false,
      isError: false,
      data: {
        contracts: [
          contract({ key: "a", contractorName: "Алфа", numberOfTenderers: 1 }),
          contract({ key: "b", contractorName: "Бета", numberOfTenderers: 3 }),
        ],
        tenders: [],
        funds: [],
        fold: {
          totalContractedEur: 5_000_000,
          contractCount: 2,
          contractorCount: 2,
          singleBidCount: 1,
          methodMix: { competitive: 0, nonCompetitive: 0, unspecified: 0 },
          byYear: {},
        },
        truncated: false,
        contractsTruncated: false,
        matchedTotal: null,
        collision: null,
        corpusContractedEur: null,
        corpusContractCount: null,
      },
    };
  });

  it("renders every exact member row", () => {
    renderView();
    expect(screen.getByText("Алфа")).toBeInTheDocument();
    expect(screen.getByText("Бета")).toBeInTheDocument();
  });

  it("a view filter narrows the rows but NEVER moves the headline total", () => {
    renderView();
    // headline count = the full member count (2), before any filter
    expect(screen.getByText("2")).toBeInTheDocument();
    // toggle single-bidder → the 3-tenderer row drops, the 1-tenderer stays
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.queryByText("Бета")).not.toBeInTheDocument();
    expect(screen.getByText("Алфа")).toBeInTheDocument();
    // headline STILL shows the full member count (2), not the filtered 1
    expect(screen.getByText("2")).toBeInTheDocument();
    // and the filtered-view marker is shown
    expect(
      screen.getByText(/филтриран изглед|filtered view/),
    ).toBeInTheDocument();
  });
});

describe("DossierContractsView — truncated branch (seed reproduction)", () => {
  it("renders the seed-repro note instead of the exact table", () => {
    model = {
      isLoading: false,
      isError: false,
      data: {
        contracts: [],
        tenders: [],
        funds: [],
        fold: {
          totalContractedEur: 0,
          contractCount: 0,
          contractorCount: 0,
          singleBidCount: 0,
          methodMix: { competitive: 0, nonCompetitive: 0, unspecified: 0 },
          byYear: {},
        },
        truncated: true,
        contractsTruncated: true,
        matchedTotal: 4538,
        collision: null,
        corpusContractedEur: null,
        corpusContractCount: null,
      },
    };
    const { container } = renderView();
    expect(
      screen.getByText(/само най-големите|largest by value/),
    ).toBeInTheDocument();
    // it's the server DbDataTable path — the "Изпълнител" client-column rows are
    // NOT rendered from an empty fetch.
    expect(within(container).queryByText("Алфа")).not.toBeInTheDocument();
  });
});
