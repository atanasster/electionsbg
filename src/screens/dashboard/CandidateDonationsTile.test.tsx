// The self-funding tile — the ONE tile both candidate surfaces render, so every property
// here is a property of two pages at once.
//
// It exists because the three things Tier 3 of
// docs/plans/person-candidate-display-unification-v1.md records as fixed had no gate at all,
// and each can be undone with every other test green:
//
//   1. the heading is „Самофинансиране", not „Дарения". That rename IS the tier's „name the
//      two facts apart" property — the person dashboard's „Дарения" block is the OTHER
//      direction (presence in a party's donor list) and the two carried the same word on the
//      same page. `t("donations")` is still a live key two files away.
//   2. the sub-line names each basis and omits an empty one. `formatThousands(0)` returns the
//      EMPTY STRING, so the unconditional pair rendered „511 парични · непарични" — a label
//      with no number, which reads as a missing value rather than as zero.
//   3. the count is a plural („1 вноска", not „1 дарения").
//
// Plus the two behavioural properties nothing else reaches: the payload path issues NO
// request, and the drill-down carries the cycle the rows describe.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./testI18n";
import { CandidateDonationsTile } from "./CandidateDonationsTile";
import type { FinancingFromCandidates } from "@/data/dataTypes";

vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2024_10_27" }),
}));

beforeAll(() => initTestI18n());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Row = Omit<FinancingFromCandidates, "name">;

const row = (monetary: number, nonMonetary = 0): Row => ({
  date: "25.09.2024",
  goal: "Кандидат",
  monetary,
  nonMonetary,
});

/** Rendered WITHOUT a QueryClientProvider on purpose where `rows` is given — see the
 *  no-request test, which asserts the property rather than relying on this. */
const show = (rows: Row[], election?: string) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CandidateDonationsTile
          name="Боян Иванов Бойчев"
          linkSlug="c-28-boyan-ivanov-boychev"
          rows={rows}
          election={election}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("CandidateDonationsTile", () => {
  it("is headed Самофинансиране, never Дарения", () => {
    // The tier's defining property. „Дарения" belongs to the person page's donor-list block,
    // which is money going the other way and carries no amount at all.
    show([row(511.29)]);
    expect(screen.getByText("Самофинансиране")).toBeInTheDocument();
    expect(screen.queryByText("Дарения")).toBeNull();
  });

  it("names each basis in the sub-line and omits an empty one", () => {
    const cashOnly = show([row(511.29)]);
    // „511 парични" — and no dangling „· непарични" with nothing in front of it.
    expect(screen.getByText("511 парични")).toBeInTheDocument();
    cashOnly.unmount();

    show([row(200, 300)]);
    expect(screen.getByText("200 парични · 300 непарични")).toBeInTheDocument();
  });

  it("headlines the COMBINED figure, with the split beside it", () => {
    // The headline is deliberately cash + in-kind (the hint says so). What makes that honest
    // is the sub-line beneath it: in-kind is 48% of one cycle's corpus total and 3% of
    // another's, so a lone „500 €" would read as money given.
    show([row(200, 300)]);
    expect(screen.getByText("500 €")).toBeInTheDocument();
    expect(screen.getByText("200 парични · 300 непарични")).toBeInTheDocument();
  });

  it("counts contributions as a plural", () => {
    const one = show([row(511)]);
    expect(screen.getByText("1 вноска")).toBeInTheDocument();
    one.unmount();
    show([row(511), row(200)]);
    expect(screen.getByText("2 вноски")).toBeInTheDocument();
  });

  it("renders a zero as 0, never as a bare currency symbol", () => {
    // `formatThousands(0)` is the empty string, so every money slot needs the guard — the
    // per-row cells got it in the same change that left the headline rendering „ €".
    show([row(0, 0)]);
    expect(screen.getByText("0 €")).toBeInTheDocument();
    // The per-row cells too.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("issues NO request when it is handed rows", () => {
    // The fetching arm is a separate component that only mounts when `rows` is absent, so
    // the payload path calls no react-query hook at all. Asserted rather than implied by the
    // absence of a QueryClientProvider, which a future test could add for another reason.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    show([row(511)]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("carries the cycle on the drill-down link", () => {
    // Only rendered above TOP_N rows, which exactly ONE person in the corpus reaches — an
    // argument for a cheap test rather than for none. Without the cycle the sub-page opens
    // on the header's election and can show a different set than the tile above it.
    show(
      Array.from({ length: 12 }, (_, i) => row(100 + i)),
      "2024_06_09",
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/candidate/c-28-boyan-ivanov-boychev/donations?elections=2024_06_09",
    );
  });

  it("still fetches the name-keyed shard when it has no rows", async () => {
    // The legacy arm, after the component was split in three. The candidate body that serves
    // a person-less URL has no payload and must keep working.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([row(4242)]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TooltipProvider>
            <CandidateDonationsTile name="Боян Иванов Бойчев" />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("4,242 €")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledOnce();
    // The NAME-keyed shard — one file per name, which is why the resolved surface passes
    // rows instead.
    expect(String(fetchSpy.mock.calls[0][0])).toContain(
      "/2024_10_27/candidates/Боян Иванов Бойчев/donations.json",
    );
  });
});
