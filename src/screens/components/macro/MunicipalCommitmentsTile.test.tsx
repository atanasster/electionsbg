// Component-level gates for the three rules the tile's header comment states.
//
// The helpers each have their own tests; these assert the rules survive at the
// RENDER level, which is where a "small enhancement" would break them:
//
//   - a withheld quarter must produce no bar and no „€0" anywhere;
//   - the vs-reserve sentence names ONE quarter, and it is the same one for both
//     figures (rule 2 — stocks compare only at the same date);
//   - no município name appears anywhere (rule 3 — this page is the national
//     aggregate; the per-município view is a different page).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MacroPayload, MacroPoint } from "@/data/macro/useMacro";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolations are echoed so the assertions can read the values the
    // component passed in, without depending on either locale's phrasing.
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

// recharts measures its container, which jsdom reports as 0×0 — so the SVG never
// paints and a bar assertion would be vacuous. Stubbed to render each <Bar>'s
// dataKey plus the row values, which is what the assertions actually need.
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ResponsiveContainer: Pass,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    BarChart: ({
      data,
      children,
    }: {
      data: Record<string, unknown>[];
      children?: React.ReactNode;
    }) => (
      <div data-testid="chart" data-rows={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Bar: ({ dataKey }: { dataKey: string }) => (
      <div data-testid="bar" data-key={dataKey} />
    ),
  };
});

import { MunicipalCommitmentsTile } from "./MunicipalCommitmentsTile";

const q = (period: string, value: number, extra: object = {}): MacroPoint =>
  ({
    year: Number(period.slice(0, 4)),
    quarter: Number(period.slice(6)) as 1 | 2 | 3 | 4,
    period,
    value,
    municipalityCount: 265,
    partial: false,
    ...extra,
  }) as MacroPoint;

const payload = (series: Record<string, MacroPoint[]>) =>
  ({ series, indicators: {} }) as unknown as MacroPayload;

// The real shape: МФ froze the commitments column at 2025-Q3, so arrears has a
// quarter the other two do not.
const REAL = payload({
  municipalCommitments: [q("2024-Q4", 3956.9), q("2025-Q2", 4162.6)],
  municipalExpenseObligations: [q("2024-Q4", 372.4), q("2025-Q2", 386.1)],
  municipalArrears: [
    q("2024-Q4", 73.1),
    q("2025-Q2", 74.2),
    q("2025-Q3", 75.4),
  ],
  fiscalReserve: [q("2024-Q4", 8931), q("2025-Q2", 6729)],
});

const renderTile = (data: MacroPayload | undefined) => {
  mockMacro.mockReturnValue({ data });
  return render(
    <MemoryRouter>
      <MunicipalCommitmentsTile />
    </MemoryRouter>,
  );
};

describe("MunicipalCommitmentsTile", () => {
  it("renders nothing at all before macro.json lands", () => {
    const { container } = renderTile(undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the corpus produced no quarters", () => {
    const { container } = renderTile(payload({}));
    expect(container).toBeEmptyDOMElement();
  });

  it("never prints €0 for a withheld quarter", () => {
    // The rule the whole pillar rests on: a frozen column is „not published",
    // and „€0" would assert that nothing was contracted that quarter.
    const { container } = renderTile(REAL);
    expect(container.textContent).not.toMatch(/€\s*0\s*(млн|млрд|m|bn)/);
  });

  it("gives the withheld quarter no value in the chart row", () => {
    renderTile(REAL);
    const rows = JSON.parse(
      screen.getByTestId("chart").getAttribute("data-rows") ?? "[]",
    ) as Record<string, unknown>[];
    const q3 = rows.find((r) => r.period === "2025-Q3");
    expect(q3).toBeDefined();
    expect(q3?.municipalCommitments).toBeUndefined();
    expect(q3?.municipalArrears).toBe(75.4);
  });

  it("draws the three stocks as separate, unstacked bars", () => {
    // A `stackId` would triple-count the same lev, since the stocks nest.
    renderTile(REAL);
    const bars = screen.getAllByTestId("bar");
    expect(bars.map((b) => b.getAttribute("data-key"))).toEqual([
      "municipalCommitments",
      "municipalExpenseObligations",
      "municipalArrears",
    ]);
  });

  it("names ONE quarter in the vs-reserve sentence, for both figures", () => {
    renderTile(REAL);
    const el = screen.getByText(/municipal_fiscal_vs_reserve/);
    const args = JSON.parse(el.textContent!.split(":").slice(1).join(":")) as {
      period: string;
      commitments: string;
      reserve: string;
      pct: number;
    };
    // 2025-Q2 is the newest quarter BOTH series cover — not 2025-Q3, which only
    // arrears reaches, and not the newest of each.
    expect(args.period).toBe("2025-Q2");
    expect(args.commitments).toContain("4,16");
    expect(args.reserve).toContain("6,73");
    expect(args.pct).toBe(62);
  });

  it("flags the cards when they are not all as of the same quarter", () => {
    renderTile(REAL);
    expect(screen.getByText("municipal_fiscal_mixed_quarters")).toBeVisible();
  });

  it("omits that flag when every card is as of the same quarter", () => {
    renderTile(
      payload({
        municipalCommitments: [q("2025-Q2", 4162.6)],
        municipalExpenseObligations: [q("2025-Q2", 386.1)],
        municipalArrears: [q("2025-Q2", 74.2)],
      }),
    );
    expect(screen.queryByText("municipal_fiscal_mixed_quarters")).toBeNull();
  });

  it("gives each card its own newest quarter rather than the newest row's", () => {
    renderTile(REAL);
    const asOf = screen
      .getAllByText(/municipal_fiscal_as_of/)
      .map((el) => JSON.parse(el.textContent!.split(":").slice(1).join(":")));
    expect(asOf.map((a) => a.period)).toEqual([
      "2025-Q2",
      "2025-Q2",
      "2025-Q3",
    ]);
    // And no card falls back to the „never published" state on this data.
    expect(screen.queryByText("municipal_fiscal_never_published")).toBeNull();
  });

  it("says not-published for a stock the corpus has never carried", () => {
    renderTile(payload({ municipalArrears: [q("2024-Q4", 73.1)] }));
    expect(
      screen.getAllByText("municipal_fiscal_never_published"),
    ).toHaveLength(2);
  });

  it("mentions no município anywhere — this page is the national aggregate", () => {
    const { container } = renderTile(REAL);
    // Guarded against the likeliest regression: a „biggest contributor" garnish.
    for (const name of ["София", "Столична", "Пловдив", "Варна", "Бургас"]) {
      expect(container.textContent).not.toContain(name);
    }
  });

  it("offers exactly one way out, to the per-município browse", () => {
    // That route competes with `governance/:id`, a catch-all over any single
    // segment. React Router ranks by specificity so the static path wins;
    // `routes.municipalFinance.test.tsx` asserts the outcome, since the day it
    // stops being true this URL renders the place dashboard's „unknown place"
    // state at a 200 rather than 404ing.
    const { container } = renderTile(REAL);
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain("/governance/municipal-finance");
  });
});
