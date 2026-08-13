// Render-level gates for the national card.
//
// The rule that shipped broken and that these hold: the headline and the
// comparison must name ONE quarter. Commitments and arrears legitimately end at
// different quarters — МФ freezes a column and the ingest withholds it — so
// reading each series' own newest gave a Q2 caption over a Q2÷Q3 ratio.
// Arithmetically fine, false as a sentence, and these are stocks, so a ratio
// across two dates is not a ratio of anything.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MacroPayload, MacroPoint } from "@/data/macro/useMacro";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o ? `${k}:${JSON.stringify(o)}` : k,
    i18n: { language: "bg" },
  }),
}));

const mockMacro = vi.fn();
vi.mock("@/data/macro/useMacro", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMacro: () => mockMacro(),
}));

import { GovernanceMunicipalCommitmentsTile } from "./GovernanceMunicipalCommitmentsTile";

const p = (period: string, value: number, extra: object = {}): MacroPoint =>
  ({
    year: Number(period.slice(0, 4)),
    quarter: Number(period.slice(6)) as 1 | 2 | 3 | 4,
    period,
    value,
    municipalityCount: 265,
    partial: false,
    ...extra,
  }) as MacroPoint;

const renderCard = (series: Record<string, MacroPoint[]> | null) => {
  mockMacro.mockReturnValue({
    data: series
      ? ({ series, indicators: {} } as unknown as MacroPayload)
      : undefined,
  });
  return render(
    <MemoryRouter>
      <GovernanceMunicipalCommitmentsTile />
    </MemoryRouter>,
  );
};

// The real shape: commitments frozen at Q2, arrears running to Q3.
const REAL = {
  municipalCommitments: [p("2024-Q4", 3956.9), p("2025-Q2", 4162.6)],
  municipalArrears: [
    p("2024-Q4", 73.1),
    p("2025-Q2", 77.4),
    p("2025-Q3", 75.4),
  ],
};

describe("GovernanceMunicipalCommitmentsTile", () => {
  it("renders nothing before macro.json lands", () => {
    const { container } = renderCard(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the series are absent", () => {
    const { container } = renderCard({});
    expect(container).toBeEmptyDOMElement();
  });

  it("captions the quarter BOTH series cover, not each one's own newest", () => {
    renderCard(REAL);
    expect(
      screen.getByText(/gov_municipal_commitments_period:/),
    ).toHaveTextContent('"2025-Q2"');
  });

  it("divides two figures from the SAME quarter", () => {
    // 4162.6 / 77.4 = 54 at Q2. Against Q3's 75.4 it would be 55 — a number
    // that is right about nothing.
    renderCard(REAL);
    expect(
      screen.getByText(/gov_municipal_commitments_vs_arrears:/),
    ).toHaveTextContent('"times":54');
  });

  it("still shows the headline when the sibling series has no matching quarter", () => {
    renderCard({
      municipalCommitments: [p("2025-Q2", 4162.6)],
      municipalArrears: [p("2024-Q4", 73.1)],
    });
    expect(screen.getByText(/gov_municipal_commitments_period:/)).toBeVisible();
    expect(
      screen.queryByText(/gov_municipal_commitments_vs_arrears/),
    ).toBeNull();
  });

  it("suppresses the ratio rather than printing Infinity", () => {
    renderCard({
      municipalCommitments: [p("2025-Q2", 4162.6)],
      municipalArrears: [p("2025-Q2", 0)],
    });
    const { container } = renderCard({
      municipalCommitments: [p("2025-Q2", 4162.6)],
      municipalArrears: [p("2025-Q2", 0)],
    });
    expect(container.textContent).not.toContain("Infinity");
    expect(
      screen.queryByText(/gov_municipal_commitments_vs_arrears/),
    ).toBeNull();
  });

  it("suppresses the ratio when it would point the wrong way", () => {
    // The sentence says „N times smaller". If arrears ever exceeded
    // commitments it would render „0 times smaller", false in the other
    // direction.
    renderCard({
      municipalCommitments: [p("2025-Q2", 50)],
      municipalArrears: [p("2025-Q2", 100)],
    });
    expect(
      screen.queryByText(/gov_municipal_commitments_vs_arrears/),
    ).toBeNull();
  });

  it("names the roster when the total is an undercount", () => {
    renderCard({
      municipalCommitments: [
        p("2025-Q2", 4000, { partial: true, municipalityCount: 260 }),
      ],
      municipalArrears: [p("2025-Q2", 77.4)],
    });
    expect(
      screen.getByText(/gov_municipal_commitments_partial:/),
    ).toHaveTextContent('"count":260');
  });

  it("says nothing about the roster when every município reported", () => {
    renderCard(REAL);
    expect(screen.queryByText(/gov_municipal_commitments_partial/)).toBeNull();
  });

  it("states the watched-vs-unwatched contrast, and sums nothing", () => {
    const { container } = renderCard(REAL);
    expect(
      screen.getByText("gov_municipal_commitments_contrast"),
    ).toBeVisible();
    // Never a combined figure with the state debt.
    expect(container.textContent).not.toMatch(/38[.,]\d/);
  });
});
