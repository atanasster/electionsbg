// /sector/health/vaccines — the honesty rules the page renders (plan §7):
//   - every channel of the plan ledger carries a hatched „няма публични данни"
//     segment, and a superseded announcement is dimmed, never dropped (§7.5);
//   - every head figure carries its own as-of line (§7.2);
//   - the head's comparison figure pairs two windows of the SAME months, never
//     the daily season-to-date count against last season's complete months
//     (§7.4).

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
vi.mock("@/i18n", () => ({ isBg: (l: string) => l === "bg" }));

import { Head, PlanLedger } from "./HealthVaccinesScreen";
import type {
  VaccinePlanRow,
  VaccinesOverview,
} from "@/data/health/useVaccines";

const wrap = (n: ReactNode) => render(<MemoryRouter>{n}</MemoryRouter>);

const row = (p: Partial<VaccinePlanRow>): VaccinePlanRow => ({
  id: "r",
  channel: "total",
  doses: 1000,
  qualifier: null,
  scope: null,
  basis: "planned",
  within: null,
  source: "МЗ",
  sourceUrl: "https://www.mh.government.bg/",
  sourceDate: "2026-10-01",
  supersededBy: null,
  ...p,
});

const overview = (
  recorded: Partial<VaccinesOverview["recorded"]>,
): VaccinesOverview => ({
  season: 2026,
  seasons: [2026, 2025],
  asOf: {},
  monthlyThrough: "2026-11",
  curve: { basis: "his_monthly", asOf: null, seasons: [], daily: null },
  plan: {
    basis: "curated",
    asOf: "2026-11-14",
    rows: [row({ id: "t1", doses: 520000 })],
    events: [],
  },
  recorded: {
    basis: "his_monthly",
    asOf: "2026-11-23T14:07:49Z",
    through: "2026-11",
    total: 151947,
    completeThrough: "2026-10",
    completeTotal: 52742,
    sameMonthsLastSeason: 279407,
    seasonToDate: 349385,
    seasonToDateAsOf: "2026-11-23T14:09:33Z",
    seasonToDateBasis: "his_daily_minus_jan_jul_monthly",
    byAge: [],
    ...recorded,
  },
  shortage: { basis: "ial", asOf: null, firstWindow: null, weeks: [] },
  incidence: { basis: "ncipd", asOf: null, weeks: [], virology: [] },
  imports: { basis: "eurostat", asOf: null, monthly: [], partners: [] },
  contracts: { basis: "contracts", awarderEik: "000695317", rows: null },
  euCoverage: { basis: "eurostat", asOf: null, rows: [] },
});

describe("PlanLedger", () => {
  it("marks every channel's delivered part as unknown and dims a superseded row", () => {
    const { container } = wrap(
      <PlanLedger
        rows={[
          row({ id: "old", doses: 500000, supersededBy: "new" }),
          row({ id: "new", doses: 520000, sourceDate: "2026-11-01" }),
          row({
            id: "p65",
            channel: "adults_65plus",
            doses: 300000,
            within: "total",
          }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("unknown-segment")).toHaveLength(2);
    expect(container.querySelectorAll(".opacity-50")).toHaveLength(1);
    expect(screen.getByText(/superseded by a later announcement/)).toBeTruthy();
  });
});

describe("Head", () => {
  it("gives every figure its own as-of line", () => {
    wrap(<Head o={overview({})} />);
    expect(screen.getAllByTestId("as-of")).toHaveLength(3);
  });

  it("compares the same complete months in both seasons", () => {
    wrap(<Head o={overview({})} />);
    expect(screen.getByText("52,742 / 279,407")).toBeTruthy();
    expect(screen.queryByText("279,407")).toBeNull();
  });

  it("shows a dash rather than a zero when a season has no complete month", () => {
    wrap(
      <Head
        o={overview({
          completeThrough: null,
          completeTotal: null,
          sameMonthsLastSeason: null,
        })}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
  });
});
