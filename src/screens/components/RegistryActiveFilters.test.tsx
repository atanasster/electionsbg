// `RegistryActiveFilters` — the chip row, and the two things about it that are not cosmetic.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  RegistryActiveFilters,
  type RegistryChipLabels,
} from "./RegistryActiveFilters";

const LABELS: RegistryChipLabels = {
  intro: { key: "x_intro", fallback: "ПОКАЗАНИ:" },
  remove: { key: "x_remove", fallback: "ПРЕМАХНИ" },
  clearAll: { key: "x_clear", fallback: "ИЗЧИСТИ" },
};
const base = { labels: LABELS, idPrefix: "x", onClearAll: () => {} };

describe("RegistryActiveFilters", () => {
  it("renders nothing with no chips and no children", () => {
    const { container } = render(
      <RegistryActiveFilters {...base} chips={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders children even with no chips, and then shows no framing or clear link", () => {
    // The trailing slot carries a CSV button / a count on some pages; the framing sentence and
    // the clear link would both be describing an empty set.
    render(
      <RegistryActiveFilters {...base} chips={[]}>
        <span>ДЕЙСТВИЕ</span>
      </RegistryActiveFilters>,
    );
    expect(screen.getByText("ДЕЙСТВИЕ")).toBeInTheDocument();
    expect(screen.queryByText("ПОКАЗАНИ:")).toBeNull();
    expect(screen.queryByText("ИЗЧИСТИ")).toBeNull();
  });

  it("⚠️ puts the DIMENSION in the accessible name, not just the value", () => {
    // „Бургас ×" alone tells a screen-reader user a value and not which axis it filters, and
    // both pages have two place axes whose values look alike (oblast, obshtina).
    render(
      <RegistryActiveFilters
        {...base}
        chips={[
          {
            id: "oblast",
            dimension: "Област",
            label: "Бургас",
            onRemove: () => {},
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "ПРЕМАХНИ Област: Бургас" }),
    ).toBeInTheDocument();
  });

  it("omits the dimension for a toggle, whose label is already a sentence", () => {
    render(
      <RegistryActiveFilters
        {...base}
        chips={[
          { id: "money", label: "с публични средства", onRemove: () => {} },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "ПРЕМАХНИ с публични средства" }),
    ).toBeInTheDocument();
  });

  it("the WHOLE chip removes, not just the glyph", () => {
    // A 12px × is a poor target on a phone, and there is nothing else a reader could want to
    // do with a chip.
    const onRemove = vi.fn();
    render(
      <RegistryActiveFilters
        {...base}
        chips={[{ id: "a", label: "Варна", onRemove }]}
      />,
    );
    screen.getByRole("button", { name: /ПРЕМАХНИ/ }).click();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("clears everything from the trailing link", async () => {
    const onClearAll = vi.fn();
    render(
      <RegistryActiveFilters
        {...base}
        onClearAll={onClearAll}
        chips={[{ id: "a", label: "Варна", onRemove: () => {} }]}
      />,
    );
    await userEvent.click(screen.getByText("ИЗЧИСТИ"));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("is a LABELLED group, so the framing is announced with the chips", () => {
    const { container } = render(
      <RegistryActiveFilters
        {...base}
        chips={[{ id: "a", label: "Варна", onRemove: () => {} }]}
      />,
    );
    const group = container.querySelector('[role="group"]')!;
    const labelId = group.getAttribute("aria-labelledby")!;
    expect(labelId).toMatch(/^x-active-filters-/);
    expect(
      container.querySelector(`#${CSS.escape(labelId)}`)!.textContent,
    ).toBe("ПОКАЗАНИ:");
  });
});
