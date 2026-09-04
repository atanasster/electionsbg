// The self-funding block on the person dashboard — the block /candidate/:id had and the
// merged person page did not, which is half of what made the two pages read as different
// pages (docs/plans/person-candidate-display-unification-v1.md §1.2).
//
// What is worth gating here is almost entirely about NOT publishing a claim the corpus does
// not support:
//   • a zero is never rendered as „gave nothing" — 10 filing rows / €7,284.85 across 7
//     candidates do not attribute because ЕРИК spells their name shorter than the ballot
//     does, so absence of a figure is absence of an ATTRIBUTION;
//   • „this vote publishes no campaign financing" and „nothing was declared" are different
//     sentences, and only three cycles publish any;
//   • cash and in-kind stay apart, because the mix swings from 48% of a cycle's total to 3%
//     and a combined figure reads as money given.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "@/screens/dashboard/testI18n";
import { PersonSelfFunding } from "./PersonSelfFunding";
import type { PersonElectionRow } from "@/data/dashboard/usePersonElections";

// Only `stats` (the elections table, already in the bundle) and `selected` are read.
vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({
    selected: "2024_10_27",
    stats: [
      { name: "2026_04_19", hasFinancials: true },
      { name: "2024_10_27", hasFinancials: true },
      { name: "2024_06_09", hasFinancials: true },
      { name: "2022_10_02", hasFinancials: false },
    ],
  }),
}));

beforeAll(() => initTestI18n());

const row = (
  election: string,
  over: Partial<PersonElectionRow> = {},
): PersonElectionRow => ({
  election,
  partyNum: 28,
  totalVotes: 18,
  regions: [],
  history: [],
  topSettlements: [],
  topSections: [],
  donatedMonetaryEur: 0,
  donatedNonMonetaryEur: 0,
  donationCount: 0,
  donations: [],
  ...over,
});

const funded = (
  election: string,
  monetary: number,
  nonMonetary = 0,
  n = 1,
): PersonElectionRow =>
  row(election, {
    donatedMonetaryEur: monetary,
    donatedNonMonetaryEur: nonMonetary,
    donationCount: n,
    donations: Array.from({ length: n }, () => ({
      date: "25.09.2024",
      goal: "Кандидат",
      monetary: monetary / n,
      nonMonetary: nonMonetary / n,
    })),
  });

const show = (rows: PersonElectionRow[], cycle = "2024_10_27") =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PersonSelfFunding
          rows={rows}
          selectedCycle={cycle}
          name="Боян Иванов Бойчев"
          linkSlug="c-28-boyan-ivanov-boychev"
        />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("PersonSelfFunding", () => {
  it("renders NOTHING when nothing is attributed — never a zero", () => {
    // The load-bearing case. A €0 here would say „gave nothing" about a person whose
    // declaration may simply not have joined on their name.
    const { container } = show([row("2024_10_27"), row("2022_10_02")]);
    expect(container.textContent).toBe("");
  });

  it("shows the selected cycle's figure from the payload, and issues no request", () => {
    // Asserted rather than implied by the absence of a QueryClientProvider in `show()` — the
    // day another test here needs one, the natural fix is to add it to the shared helper, at
    // which point the payload path could start fetching with everything still green.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    show([funded("2024_10_27", 25564.59)]);
    expect(screen.getAllByText(/25[\s ]?565|25,565/).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("distinguishes a cycle with nothing declared from one that publishes nothing", () => {
    // Two different sentences. A shared „no data" would conflate the register's coverage
    // with the person's behaviour.
    const rows = [funded("2024_06_09", 5000), row("2024_10_27")];
    const declared = show(rows, "2024_10_27");
    expect(screen.getByText(/Няма декларирани вноски/)).toBeInTheDocument();
    declared.unmount();

    show([funded("2024_06_09", 5000), row("2022_10_02")], "2022_10_02");
    expect(
      screen.getByText(/не се публикува кампанийно финансиране/),
    ).toBeInTheDocument();
  });

  it("lists the history newest-first, cash and in-kind apart", () => {
    // ⚠️ Fed in the WRONG order deliberately. 085 does return the rows newest-first, but
    // `personDataCycles` re-sorts the same array rather than relying on that, so this
    // component sorts too — and without the assertion a change to 085's ORDER BY would put
    // a person's history out of chronological order with every test green.
    show([
      funded("2024_06_09", 201337, 184964),
      funded("2024_10_27", 585179, 18523),
    ]);
    expect(screen.getByText("По избори")).toBeInTheDocument();
    // Scoped to the history: the donations tile above it heads its own columns the same way.
    const history = within(screen.getByTestId("self-funding-history"));
    expect(
      [...screen.getByTestId("self-funding-history").querySelectorAll("span")]
        .map((el) => el.textContent ?? "")
        .filter((tx) => /^\d{2}\.\d{2}\.\d{4}$/.test(tx)),
    ).toEqual(["27.10.2024", "09.06.2024"]);
    // Both bases present as separate columns — a single total would read as money given
    // while 48% of the 2024_06_09 figure is in-kind.
    expect(history.getByText("Парични")).toBeInTheDocument();
    expect(history.getByText("Непарични")).toBeInTheDocument();
    // And the two are not summed: the cash figure appears on its own.
    expect(history.getByText(/585[\s ,]?179/)).toBeInTheDocument();
  });

  it("does not call one cycle a history", () => {
    // A single point is the figure already on the card above it.
    show([funded("2024_10_27", 511), row("2024_06_09")]);
    expect(screen.queryByText("По избори")).toBeNull();
  });

  it("omits a cycle with no attributed rows from the history", () => {
    // Same rule as the section-level one: a cycle listed at €0 asserts the person declared
    // nothing, which is not what an unattributed row means.
    show([
      funded("2024_10_27", 511),
      row("2024_06_09"),
      funded("2026_04_19", 700),
    ]);
    expect(screen.getByText("По избори")).toBeInTheDocument();
    const history = within(screen.getByTestId("self-funding-history"));
    expect(history.queryByText("09.06.2024")).toBeNull();
  });
});
