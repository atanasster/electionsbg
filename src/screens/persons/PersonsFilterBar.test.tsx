// The /persons filter bar.
//
// WHAT THIS PINS. The bar exists so the filters survive Tier 5, where the table stops rendering
// until there is something to show — so "it renders its controls independently of any table" is
// the whole point rather than an incidental property. The rest is the labelling this tier was
// for: a Radix trigger's only text is whatever is selected, so without an associated label the
// control announces „Кмет" and never says which axis that narrows.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PersonsFilterBar } from "./PersonsFilterBar";

const select = (key: string, label: string, value = "__all__") => ({
  key,
  label,
  allLabel: `Всички ${label}`,
  value,
  options: [
    { value: "a", label: "Опция А" },
    { value: "b", label: "Опция Б" },
  ],
  onChange: () => {},
});

const toggle = (
  key: string,
  label: string,
  checked = false,
  onChange = () => {},
) => ({
  key,
  label,
  checked,
  onChange,
});

describe("PersonsFilterBar", () => {
  it("names each control after its DIMENSION, not its value", () => {
    // The failure this closes: five Radix triggers strung along a toolbar, whose only text is
    // the selection — so „Всички роли" and „Всички партии" are distinguishable and „Кмет" and
    // „ГЕРБ" are not.
    render(
      <PersonsFilterBar
        selects={[select("role", "Роля", "a"), select("party", "Партия", "a")]}
        toggles={[]}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Роля" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Партия" }),
    ).toBeInTheDocument();
  });

  it("associates the VISIBLE label with the control", () => {
    // `aria-labelledby` pointing at the on-screen span, not a second `aria-label` string: a
    // screen reader then announces the dimension once instead of twice, and the visible and
    // announced labels cannot drift apart.
    render(
      <PersonsFilterBar selects={[select("role", "Роля")]} toggles={[]} />,
    );
    const id = screen.getByRole("combobox").getAttribute("aria-labelledby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe("Роля");
  });

  it("gives two mounted bars different label ids", () => {
    // Module-level ids collide the moment a second bar mounts, silently pointing both controls
    // at one label.
    const { container } = render(
      <>
        <PersonsFilterBar selects={[select("role", "Роля")]} toggles={[]} />
        <PersonsFilterBar selects={[select("role", "Роля")]} toggles={[]} />
      </>,
    );
    const ids = [...container.querySelectorAll("[aria-labelledby]")].map((el) =>
      el.getAttribute("aria-labelledby"),
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("a toggle's label is clickable — an implicit association, not an adjacent span", () => {
    const onChange = vi.fn();
    render(
      <PersonsFilterBar
        selects={[]}
        toggles={[toggle("decl", "само с декларация", false, onChange)]}
      />,
    );
    // getByLabelText resolves through the <label> wrapper; a bare adjacent span would not.
    const box = screen.getByLabelText("само с декларация");
    expect(box).toHaveAttribute("type", "checkbox");
  });

  it("renders with no toggles at all", () => {
    render(
      <PersonsFilterBar selects={[select("role", "Роля")]} toggles={[]} />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders trailing children beside the controls", () => {
    render(
      <PersonsFilterBar selects={[]} toggles={[]}>
        <span>ДЕЙСТВИЕ</span>
      </PersonsFilterBar>,
    );
    expect(screen.getByText("ДЕЙСТВИЕ")).toBeInTheDocument();
  });
});
