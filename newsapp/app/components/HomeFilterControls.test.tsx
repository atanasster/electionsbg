import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaxonomyCategory } from "../data";
import { HomeFilterControls } from "./HomeFilterControls";

const category = {
  id: "society",
  label: { bg: "Общество", en: "Society" },
} as TaxonomyCategory;

describe("HomeFilterControls", () => {
  afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));
  it("exposes pressed state and exact faceted counts", () => {
    render(
      <HomeFilterControls
        categories={[category]}
        categoryCounts={new Map([["society", 2]])}
        category="society"
        days={7}
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
});
