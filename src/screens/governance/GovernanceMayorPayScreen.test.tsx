import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MayorPayRankingRow } from "@/data/officials/useMayorPayRanking";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: "bg" },
  }),
}));
const mockRanking = vi.fn();
vi.mock("@/data/officials/useMayorPayRanking", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMayorPayRanking: () => mockRanking(),
}));

import { GovernanceMayorPayScreen } from "./GovernanceMayorPayScreen";

const row = (over: Partial<MayorPayRankingRow> = {}): MayorPayRankingRow =>
  ({
    obshtina: "DOB03",
    name_bg: "Балчик",
    name_en: "Balchik",
    oblast_code: "DOB",
    mayor_name: "Николай Ангелов",
    mayor_slug: "nikolai-angelov",
    declaration_id: 1,
    fiscal_year: 2025,
    source_url: null,
    income_eur: 64_000,
    population: 16_000,
    income_per_1000_residents_eur: 4_000,
    ...over,
  }) as MayorPayRankingRow;

const renderScreen = (rows: MayorPayRankingRow[]) => {
  mockRanking.mockReturnValue({ rows, isPending: false, isError: false });
  return render(
    <MemoryRouter>
      <GovernanceMayorPayScreen />
    </MemoryRouter>,
  );
};

const renderQueryState = (state: {
  rows: MayorPayRankingRow[];
  isPending: boolean;
  isError: boolean;
}) => {
  mockRanking.mockReturnValue(state);
  return render(
    <MemoryRouter>
      <GovernanceMayorPayScreen />
    </MemoryRouter>,
  );
};

describe("GovernanceMayorPayScreen", () => {
  it("replaces the top chart with a KPI dashboard and a table explorer", () => {
    const { container } = renderScreen([
      row(),
      row({
        obshtina: "VAR06",
        name_bg: "Варна",
        fiscal_year: 2024,
        income_eur: null,
        income_per_1000_residents_eur: null,
      }),
    ]);

    expect(container.querySelector("[data-hub-head]")).toBeVisible();
    expect(container.querySelectorAll("[data-kpi-cell]")).toHaveLength(4);
    expect(screen.getByText("mp_kpi_coverage")).toBeVisible();
    expect(screen.getByText("mp_kpi_dominant_year")).toBeVisible();
    expect(screen.getByText("mp_table_title")).toBeVisible();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
    expect(container.querySelector(".max-w-5xl")).toBeNull();
  });

  it("filters the table by declaration year and income availability", () => {
    renderScreen([
      row(),
      row({
        obshtina: "VAR06",
        name_bg: "Варна",
        fiscal_year: 2024,
        income_eur: null,
        income_per_1000_residents_eur: null,
      }),
    ]);

    fireEvent.change(screen.getByLabelText("mp_filter_year"), {
      target: { value: "2024" },
    });
    expect(screen.getByText("Варна")).toBeVisible();
    expect(screen.queryByText("Балчик")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "mp_filter_withoutIncome" }),
    );
    expect(screen.getByText("Варна")).toBeVisible();
    expect(screen.queryByText("Балчик")).toBeNull();
  });

  it("keeps the KPI basis explicit and gives a recoverable no-match state", () => {
    renderScreen([
      row(),
      row({
        obshtina: "VAR06",
        name_bg: "Варна",
        fiscal_year: 2024,
        income_eur: 999_999,
        income_per_1000_residents_eur: 2_000,
      }),
    ]);

    expect(screen.getByText("mp_kpi_median_income_detail")).toBeVisible();
    fireEvent.change(screen.getByLabelText("mp_page_search"), {
      target: { value: "няма такава община" },
    });
    expect(screen.getByText("mp_table_no_matches")).toBeVisible();
  });

  it("finds a mayor by first and family name without requiring the patronymic", () => {
    renderScreen([
      row({
        obshtina: "SOF",
        name_bg: "Столична община",
        mayor_name: "Васил Александров Терзиев",
      }),
    ]);

    fireEvent.change(screen.getByLabelText("mp_page_search"), {
      target: { value: "Васил Терзиев" },
    });
    expect(screen.getByText("Столична община")).toBeVisible();
    expect(screen.getByText("Васил Александров Терзиев")).toBeVisible();
  });

  it("headlines the dominant filing year rather than a tiny newest cohort", () => {
    renderScreen([
      row({ obshtina: "A", fiscal_year: 2025 }),
      row({ obshtina: "B", fiscal_year: 2025 }),
      row({ obshtina: "C", fiscal_year: 2026 }),
    ]);

    const dominantCell = screen
      .getByText("mp_kpi_dominant_year")
      .closest<HTMLElement>("[data-kpi-cell]");
    expect(dominantCell).not.toBeNull();
    expect(within(dominantCell!).getByText("2025")).toBeVisible();
    expect(
      screen.getByText('mp_kpi_dominant_year_detail:{"count":2,"year":2025}'),
    ).toBeVisible();
  });

  it("labels filters, announces result counts, and clears the narrowed state", () => {
    renderScreen([
      row(),
      row({
        obshtina: "VAR06",
        name_bg: "Варна",
        name_en: "Varna",
        mayor_name: "Друг Кмет",
        fiscal_year: 2024,
      }),
    ]);

    expect(screen.getByLabelText("mp_filter_label")).toBeVisible();
    expect(screen.getByLabelText("mp_filter_year")).toBeVisible();
    expect(screen.getByLabelText("mp_filter_coverage")).toBeVisible();

    fireEvent.change(screen.getByLabelText("mp_page_search"), {
      target: { value: "Балчик" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /mp_page_showing.*"shown":1.*"total":2/,
    );
    fireEvent.click(screen.getByRole("button", { name: "mp_filter_clear" }));
    expect(screen.getByLabelText("mp_page_search")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(
      /mp_page_showing.*"shown":2.*"total":2/,
    );
  });

  it("puts the active sort state on the table header", () => {
    renderScreen([row()]);
    const ratioHeader = screen
      .getByRole("button", { name: /mp_col_per_thousand/ })
      .closest("th");
    expect(ratioHeader).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(screen.getByRole("button", { name: "mp_col_income" }));
    const incomeHeader = screen
      .getByRole("button", { name: /mp_col_income/ })
      .closest("th");
    expect(incomeHeader).toHaveAttribute("aria-sort", "descending");
    expect(ratioHeader).toHaveAttribute("aria-sort", "none");
  });

  it("reserves the KPI dashboard while data is loading", () => {
    const { container } = renderQueryState({
      rows: [],
      isPending: true,
      isError: false,
    });

    expect(screen.getByText("loading")).toBeVisible();
    expect(
      container.querySelectorAll("[data-hub-head] div[aria-hidden='true']"),
    ).toHaveLength(4);
  });

  it("renders distinct error and empty states", () => {
    const { rerender } = renderQueryState({
      rows: [],
      isPending: false,
      isError: true,
    });
    expect(screen.getByText("mp_page_error")).toBeVisible();

    mockRanking.mockReturnValue({
      rows: [],
      isPending: false,
      isError: false,
    });
    rerender(
      <MemoryRouter>
        <GovernanceMayorPayScreen />
      </MemoryRouter>,
    );
    expect(screen.getByText("mp_page_empty")).toBeVisible();
  });

  it("names each declaration source link for its mayor", () => {
    renderScreen([row({ source_url: "https://example.com/declaration" })]);

    expect(
      screen.getByRole("link", {
        name: /mp_source_link_label.*Николай Ангелов/,
      }),
    ).toHaveAttribute("target", "_blank");
  });
});
