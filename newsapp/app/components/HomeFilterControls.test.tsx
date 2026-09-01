import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaxonomyCategory } from "../data";
import { HomeFilterControls } from "./HomeFilterControls";

const category = {
  id: "society",
  label: { bg: "Общество", en: "Society" },
} as TaxonomyCategory;

const categoryNamed = (id: string, label: string): TaxonomyCategory =>
  ({ id, label: { bg: label, en: label } }) as TaxonomyCategory;

describe("HomeFilterControls", () => {
  afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));
  it("exposes pressed state and exact faceted counts", () => {
    render(
      <HomeFilterControls
        categories={[category]}
        categoryCounts={new Map([["society", 2]])}
        category="society"
        days={7}
        defaultDays={1}
        query=""
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Общество · 2" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7 дни" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows reset only for active filters and delegates the full reset", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const onReset = vi.fn();
    const { rerender } = render(
      <HomeFilterControls
        categories={[]}
        categoryCounts={new Map()}
        category="all"
        days={30}
        defaultDays={30}
        query=""
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={onReset}
      />,
    );
    expect(screen.queryByRole("button", { name: "Изчисти" })).toBeNull();
    rerender(
      <HomeFilterControls
        categories={[]}
        categoryCounts={new Map()}
        category="all"
        days={30}
        defaultDays={30}
        query="тест"
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={onReset}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Изчисти" }));
    expect(onReset).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "home_filter",
        filter: "reset",
        active: false,
      }),
    );
  });

  it("tracks only category and period state, never labels or query text", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <HomeFilterControls
        categories={[category]}
        categoryCounts={new Map([["society", 2]])}
        category="all"
        days={30}
        defaultDays={30}
        query="частно търсене"
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Общество · 2" }));
    fireEvent.click(screen.getByRole("button", { name: "7 дни" }));
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(sink.mock.calls).toEqual([
      [{ name: "home_filter", filter: "category", active: true }],
      [{ name: "home_filter", filter: "period", active: true }],
    ]);
    expect(JSON.stringify(sink.mock.calls)).not.toContain("частно");
  });

  it("reports period activity against the adaptive default", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <HomeFilterControls
        categories={[]}
        categoryCounts={new Map()}
        category="all"
        days={1}
        defaultDays={1}
        query=""
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "24 часа" }));
    fireEvent.click(screen.getByRole("button", { name: "30 дни" }));
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(sink.mock.calls).toEqual([
      [{ name: "home_filter", filter: "period", active: false }],
      [{ name: "home_filter", filter: "period", active: true }],
    ]);
  });

  it("keeps four high-volume topics visible and discloses the full taxonomy", () => {
    const categories = [
      categoryNamed("one", "Едно"),
      categoryNamed("two", "Две"),
      categoryNamed("three", "Три"),
      categoryNamed("four", "Четири"),
      categoryNamed("five", "Пет"),
      categoryNamed("six", "Шест"),
    ];
    render(
      <HomeFilterControls
        categories={categories}
        categoryCounts={
          new Map([
            ["one", 12],
            ["two", 10],
            ["three", 8],
            ["four", 6],
            ["five", 4],
            ["six", 2],
          ])
        }
        category="all"
        days={7}
        defaultDays={7}
        query=""
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Едно · 12" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Пет · 4" })).not.toBeVisible();
    fireEvent.click(
      screen.getByText("Всички теми и филтри", { selector: "summary" }),
    );
    expect(screen.getByRole("button", { name: "Пет · 4" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Шест · 2" })).toBeVisible();
  });

  it("exposes the anchored search and a compact active-filter summary", () => {
    render(
      <HomeFilterControls
        categories={[category]}
        categoryCounts={new Map([["society", 2]])}
        category="society"
        days={7}
        defaultDays={1}
        query="пример"
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByRole("searchbox", { name: "Търсене" })).toHaveAttribute(
      "id",
      "news-search",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Показваме: Общество · 7 дни · търсене",
    );
  });

  it("keeps the top four topics when a lower-volume topic is selected", () => {
    const categories = [
      categoryNamed("one", "Едно"),
      categoryNamed("two", "Две"),
      categoryNamed("three", "Три"),
      categoryNamed("four", "Четири"),
      categoryNamed("five", "Пет"),
      categoryNamed("six", "Шест"),
    ];
    render(
      <HomeFilterControls
        categories={categories}
        categoryCounts={
          new Map(categories.map((item, index) => [item.id, 12 - index * 2]))
        }
        category="six"
        days={7}
        defaultDays={7}
        query=""
        onCategoryChange={vi.fn()}
        onDaysChange={vi.fn()}
        onQueryChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    for (const name of ["Едно · 12", "Две · 10", "Три · 8", "Четири · 6"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Шест · 2" })).toBeVisible();
  });
});
