// Component guard for the accumulation gap (audit T3.2). Every assertion here is a
// defamation control from docs/methodology/accumulation-gap.md, not a styling preference:
//
//   · a null payload (outside the senior cohort, or <2 filings) renders NOTHING;
//   · the unvalued-real-estate caveat appears whenever the count is non-zero, because a
//     gap computed over unvalued property is not a precise figure;
//   · the legitimate-untracked-sources caveat and the declared-not-audited caveat are
//     always present, positive gap or negative;
//   · a NEGATIVE gap renders just as plainly as a positive one — suppressing the ordinary
//     case is what would make the positive one read as an accusation by default.
//
// Hermetic: fetch stubbed, no network, no DB.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AccumulationGap } from "./usePersonAccumulationGap";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Echo the key + any interpolation so assertions can read both.
    t: (k: string, o?: Record<string, unknown>) =>
      o ? `${k}:${JSON.stringify(o)}` : k,
    i18n: { language: "bg" },
  }),
}));

import { PersonAccumulationGap } from "./PersonAccumulationGap";

const stub = (payload: AccumulationGap) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => payload }) as Response),
  );

const gap = (o: Partial<NonNullable<AccumulationGap>> = {}) => ({
  slug: "mp-49",
  fromYear: 2015,
  toYear: 2025,
  years: 10,
  fromNetEur: 29929,
  toNetEur: 285095,
  deltaNetEur: 255166,
  declaredIncomeEur: 434305,
  gapEur: -179139,
  unvaluedRealEstate: 0,
  ...o,
});

afterEach(() => vi.unstubAllGlobals());

describe("PersonAccumulationGap", () => {
  // THE COHORT GATE. The server returns null for anyone outside accountability_senior;
  // the component must render nothing at all, not an empty shell.
  it("renders nothing when the payload is null (outside the cohort)", async () => {
    stub(null);
    const { container } = render(<PersonAccumulationGap slug="councillor" />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("always carries the declared-not-audited and untracked-sources caveats", async () => {
    stub(gap());
    render(<PersonAccumulationGap slug="mp-49" />);
    await waitFor(() =>
      expect(screen.getByText("pp_gap_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("pp_gap_caveat_declared")).toBeInTheDocument();
    expect(screen.getByText("pp_gap_caveat_sources")).toBeInTheDocument();
    expect(screen.getByText("pp_gap_methodology")).toBeInTheDocument();
  });

  // THE DENOMINATOR. Unvalued property counts as €0, so the gap is not exact — the count
  // must be surfaced, never silently folded in.
  it("surfaces the unvalued-real-estate count when it is non-zero", async () => {
    stub(gap({ unvaluedRealEstate: 9 }));
    render(<PersonAccumulationGap slug="mp-49" />);
    await waitFor(() =>
      expect(screen.getByText("pp_gap_title")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/pp_gap_caveat_unvalued.*"count":9/),
    ).toBeInTheDocument();
  });

  it("omits the unvalued caveat when every property carries a value", async () => {
    stub(gap({ unvaluedRealEstate: 0 }));
    render(<PersonAccumulationGap slug="mp-49" />);
    await waitFor(() =>
      expect(screen.getByText("pp_gap_title")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/pp_gap_caveat_unvalued/),
    ).not.toBeInTheDocument();
  });

  // A negative gap is the ordinary case and is shown plainly. If it were suppressed, the
  // mere presence of this section would imply an allegation.
  it("renders a negative gap with the neutral caption", async () => {
    stub(gap({ gapEur: -179139 }));
    render(<PersonAccumulationGap slug="mp-49" />);
    await waitFor(() =>
      expect(screen.getByText("pp_gap_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("pp_gap_negative_sub")).toBeInTheDocument();
    expect(screen.queryByText("pp_gap_positive_sub")).not.toBeInTheDocument();
  });

  it("renders a positive gap with the descriptive, non-accusatory caption", async () => {
    stub(gap({ gapEur: 250000 }));
    render(<PersonAccumulationGap slug="mp-49" />);
    await waitFor(() =>
      expect(screen.getByText("pp_gap_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("pp_gap_positive_sub")).toBeInTheDocument();
  });
});
