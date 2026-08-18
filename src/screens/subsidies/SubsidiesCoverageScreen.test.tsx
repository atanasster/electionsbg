// /subsidies/coverage — the page whose subject IS what the corpus does and does not contain.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS PAGE NEEDS ITS OWN FAILURE TEST. The seven sibling sub-pages inherit their four
// states from `AgriScopeFallback`. This one has no scope picker — it always reads the all-years
// payload, deliberately, because a coverage page that changed its answer with the pill would be
// describing the pill — so it sat outside that arrangement, and outside `scopeContract.test.ts`,
// whose consumer set is „files rendering the shared picker".
//
// What being outside cost: `data?.years ?? AGRI_FINANCIAL_YEARS` and `(data?.years ?? []).length`
// turned a FAILED or PAUSED fetch into assertions about ДФЗ's registers. The footer read
// „0 покрити финансови години" and the year grid drew a coverage picture invented from a client
// constant — on the one page that exists to stop the rest of the module being read as more
// complete than it is. Absence of a payload is not evidence about the source.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgriIndexFile } from "@/data/agri/types";

type Q = {
  data: AgriIndexFile | null | undefined;
  isError: boolean;
  isSuccess: boolean;
  fetchStatus: "idle" | "fetching" | "paused";
  refetch: () => void;
};

const q = vi.hoisted(() => ({ value: null as unknown as Q }));
vi.mock("@/data/agri/useAgriOverview", () => ({
  useAgriOverview: () => q.value,
}));

const { SubsidiesCoverageScreen } = await import("./SubsidiesCoverageScreen");

const PAYLOAD = {
  generatedFrom: "ДФЗ (тест)",
  bgnPerEur: 1.95583,
  scope: "all",
  scopeYear: null,
  years: [2015, 2016, 2017, 2021, 2022, 2023, 2024, 2025],
  latestYear: 2025,
  headline: {
    totalEur: 11_000_000_000,
    entityEur: 6_000_000_000,
    individualEur: 5_000_000_000,
    entityCount: 10,
    individualCount: 20,
    topScheme: null,
  },
  totalsByYear: [],
  byScheme: [],
  byOblast: [],
  concentration: {
    year: 2025,
    scope: "all",
    basis: "legal-entities",
    entityCount: 10,
    entityEur: 6_000_000_000,
    top1Share: 10,
    top10Share: 50,
    top100Share: 90,
    top1000Share: 100,
    lorenz: [],
  },
  topRecipients: [],
} as unknown as AgriIndexFile;

const LOADING: Q = {
  data: undefined,
  isError: false,
  isSuccess: false,
  fetchStatus: "fetching",
  refetch: vi.fn(),
};

const at = () =>
  render(
    <MemoryRouter initialEntries={["/subsidies/coverage"]}>
      <TooltipProvider>
        <SubsidiesCoverageScreen />
      </TooltipProvider>
    </MemoryRouter>,
  );

// i18next resolves nothing under vitest, so the English branch renders.
const body = () => document.body.textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  q.value = { ...LOADING, data: PAYLOAD, isSuccess: true, fetchStatus: "idle" };
});

describe("SubsidiesCoverageScreen", () => {
  it("reports the corpus's coverage when the payload is in hand", () => {
    at();
    expect(body()).toMatch(/8 financial years covered/);
    // The year grid is what a reader looks at, so it must be there in the good case —
    // otherwise the failure assertions below could pass on a page that renders nothing.
    expect(document.querySelector("#subsidies-coverage-years")).toBeTruthy();
  });

  it("says the coverage did not load, rather than that the corpus has none", () => {
    q.value = { ...LOADING, isError: true, fetchStatus: "idle" };
    at();
    expect(body()).toMatch(/failed to load/);
    // The two specific false claims this page used to make.
    expect(body()).not.toMatch(/0 financial years covered/);
    expect(
      document.querySelector("#subsidies-coverage-years"),
      "the year grid rendered from a client constant, with no payload behind it",
    ).toBeNull();
  });

  it("treats a paused query as waiting, and offers no dead retry", () => {
    q.value = { ...LOADING, fetchStatus: "paused" };
    at();
    expect(body()).toMatch(/waiting for the connection/);
    expect(body()).not.toMatch(/0 financial years covered/);
    // React Query refuses to run a retry while paused and resumes on its own.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("offers a retry on a real failure", () => {
    q.value = { ...LOADING, isError: true, fetchStatus: "idle" };
    at();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("does not claim a coverage figure while still loading", () => {
    at();
    q.value = LOADING;
    at();
    expect(body()).not.toMatch(/0 financial years covered/);
  });
});
