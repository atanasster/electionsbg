import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaxonomyCategory } from "../data";
import { HomeFilterControls } from "./HomeFilterControls";

const category = {
  id: "society",
  label: { bg: "Общество", en: "Society" },
} as TaxonomyCategory;

describe("HomeFilterControls", () => {
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

  it("shows reset only for active filters and delegates the full reset", () => {
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
  });
});
