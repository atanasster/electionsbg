// Component guard for the peer benchmark (audit T3.9).
//
// The controls are editorial: the percentile must be WITHHELD (not rendered as 0 or blank)
// when the server declines to compute it, the caveat must always render, and the block must
// self-hide rather than show an empty comparison heading on a profile.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { CohortBenchmark } from "./usePersonCohortBenchmark";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonCohortBenchmark } from "./PersonCohortBenchmark";

const data = (
  o: Partial<NonNullable<CohortBenchmark>> = {},
): CohortBenchmark => ({
  cohort: "mp",
  year: 2021,
  netEur: 845131,
  peers: 564,
  medianEur: 55576,
  percentile: 97,
  ...o,
});

const stub = (d: CohortBenchmark) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => d }) as Response),
  );

afterEach(() => vi.unstubAllGlobals());

describe("PersonCohortBenchmark", () => {
  it("renders the percentile alongside the declared and median figures", async () => {
    stub(data());
    render(<PersonCohortBenchmark slug="mp-1" />);
    await waitFor(() =>
      expect(screen.getByText("pp_cohort_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("97%")).toBeInTheDocument();
    expect(screen.getByText(/^€845/)).toBeInTheDocument(); // declared
    expect(screen.getByText(/^€55/)).toBeInTheDocument(); // cohort median
    // The caveat shares its <p> with the peer-count line, so match the substring.
    expect(screen.getByText(/pp_cohort_caveat/)).toBeInTheDocument();
  });

  // Below the 20-peer floor the server returns null. Rendering "0%" — or an empty tile —
  // would publish a rank the data does not support.
  it("withholds BOTH the percentile and the median below the 20-peer floor", async () => {
    // The real server payload nulls medianEur AND percentile together below the floor — a
    // handful of peers makes the median one person's exact figure. The fixture must model
    // that (an earlier fixture left medianEur set, a state the server never emits, which is
    // how the blank-median-tile bug shipped).
    stub(data({ percentile: null, medianEur: null, peers: 6 }));
    render(<PersonCohortBenchmark slug="mag-1" />);
    await waitFor(() =>
      expect(screen.getAllByText("pp_cohort_too_few").length).toBe(2),
    );
    // No rank and no formatted cohort median leak through.
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^€55/)).not.toBeInTheDocument();
    // The person's OWN declared figure still renders — only the peer stats are withheld.
    expect(screen.getByText(/^€845/)).toBeInTheDocument();
  });

  // A comparison heading with nothing under it reads as a finding.
  it("renders nothing for a person with no cohort", async () => {
    stub(null);
    const { container } = render(<PersonCohortBenchmark slug="x" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  // Negative net worth is real in this corpus (debts exceeding assets) and must render as a
  // negative figure, not be swallowed or shown as €0.
  it("renders a negative declared net worth", async () => {
    stub(data({ netEur: -63564, percentile: 6, peers: 118 }));
    render(<PersonCohortBenchmark slug="dm-1" />);
    await waitFor(() =>
      expect(screen.getByText("pp_cohort_title")).toBeInTheDocument(),
    );
    expect(screen.getByText(/-€63|€-63/)).toBeInTheDocument();
  });
});

// Income is a SECOND measure with its own population and its own floor. The editorial
// controls mirror the wealth row's and add one: a person who declared no income must get no
// income row at all, because a zero is "reported nothing", not "earned nothing".
describe("income row", () => {
  it("renders the declarant's income, median and percentile", async () => {
    stub(
      data({
        incomeEur: 27618,
        incomePeers: 195,
        incomeMedianEur: 99627,
        incomePercentile: 1,
      }),
    );
    render(<PersonCohortBenchmark slug="mp-4154" />);
    await waitFor(() =>
      expect(screen.getByText("pp_cohort_income")).toBeInTheDocument(),
    );
    expect(screen.getByText("pp_cohort_income_median")).toBeInTheDocument();
    expect(screen.getByText("pp_cohort_income_percentile")).toBeInTheDocument();
    expect(screen.getByText("1%")).toBeInTheDocument();
  });

  // THE guard: a zero income arrives as null, and no row may appear. Rendering "€0" beside
  // a median would state that the person earned nothing, which the filing does not say.
  it("renders no income row when the person declared none", async () => {
    stub(data({ incomeEur: null, incomePeers: 0 }));
    render(<PersonCohortBenchmark slug="mp-1588" />);
    await waitFor(() =>
      expect(screen.getByText("pp_cohort_declared")).toBeInTheDocument(),
    );
    expect(screen.queryByText("pp_cohort_income")).not.toBeInTheDocument();
  });

  // The income floor is INDEPENDENT of the wealth floor: wealth can clear 20 peers while
  // income does not, and the income tiles must withhold on their own count.
  it("withholds the income median and percentile below the income floor", async () => {
    stub(
      data({
        incomeEur: 27618,
        incomePeers: 4,
        incomeMedianEur: null,
        incomePercentile: null,
        // wealth side stays computed, proving the two floors are separate
        medianEur: 55576,
        percentile: 97,
      }),
    );
    render(<PersonCohortBenchmark slug="mp-4154" />);
    await waitFor(() =>
      expect(screen.getByText("pp_cohort_income")).toBeInTheDocument(),
    );
    expect(screen.getByText("97%")).toBeInTheDocument(); // wealth percentile still shown
    expect(screen.getAllByText("pp_cohort_too_few").length).toBeGreaterThan(0);
  });

  it("states that the income figure excludes the spouse", async () => {
    stub(
      data({
        incomeEur: 27618,
        incomePeers: 195,
        incomeMedianEur: 99627,
        incomePercentile: 1,
      }),
    );
    render(<PersonCohortBenchmark slug="mp-4154" />);
    await waitFor(() =>
      expect(screen.getByText("pp_cohort_income_peers")).toBeInTheDocument(),
    );
  });
});
