// The /persons active-filter chips.
//
// WHAT THIS PINS. Two of the narrowings this page accepts have NO picker: `?position` and
// `?obshtina` are validated and applied by the hook and have no control of any kind. Nothing
// in the app produces either today, so they arrive by hand-built link or by an AI tool — and
// before these chips the result was a table filtered to one municipality with nothing naming
// the filter and no way to widen it. The chips are the only surface where those two exist,
// which makes "every applied narrowing gets one" a contract rather than a nicety.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { PersonsActiveFilters } from "./PersonsActiveFilters";

const chip = (id: string, label: string, onRemove = () => {}) => ({
  id,
  label,
  onRemove,
});

describe("PersonsActiveFilters", () => {
  it("renders nothing at all when nothing is applied", () => {
    // An empty bar is a row of whitespace between the filters and the table, and a „Изчисти"
    // link offering to clear nothing.
    const { container } = render(
      <PersonsActiveFilters chips={[]} onClearAll={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders when there are no chips but there IS trailing content", () => {
    // The CSV export lives in this row; it must not vanish with the chips.
    render(
      <PersonsActiveFilters chips={[]} onClearAll={() => {}}>
        <span>ЕКСПОРТ</span>
      </PersonsActiveFilters>,
    );
    expect(screen.getByText("ЕКСПОРТ")).toBeInTheDocument();
    // …but the clear-all link stays hidden, because there is nothing to clear.
    expect(screen.queryByText("Изчисти филтрите")).toBeNull();
  });

  it("a chip removes ONLY its own filter", async () => {
    const removeRole = vi.fn();
    const removeParty = vi.fn();
    render(
      <PersonsActiveFilters
        chips={[
          {
            ...chip("role:mp", "Народни представители", removeRole),
            dimension: "Роля",
          },
          { ...chip("party:gerb", "ГЕРБ", removeParty), dimension: "Партия" },
        ]}
        onClearAll={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Роля: Народни представители/ }),
    );
    expect(removeRole).toHaveBeenCalledTimes(1);
    expect(removeParty).not.toHaveBeenCalled();
  });

  it("the WHOLE chip is the control, not just the glyph", async () => {
    // A 12 px × is a poor target on a phone, and there is nothing else a reader could want to
    // do with a chip. Asserted through the accessible name, which only the button carries.
    const onRemove = vi.fn();
    render(
      <PersonsActiveFilters
        chips={[chip("decl", "само с декларация", onRemove)]}
        onClearAll={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /само с декларация/ });
    expect(btn.tagName).toBe("BUTTON");
    await userEvent.click(btn);
    expect(onRemove).toHaveBeenCalled();
  });

  it("names the dimension in the accessible label, not only in the visible text", () => {
    // „Бургас ×" alone tells a screen-reader user a value and not which axis it filters — and
    // this page has two axes (oblast, obshtina) whose values look alike.
    render(
      <PersonsActiveFilters
        chips={[{ ...chip("oblast:BGS", "Бургас"), dimension: "Област" }]}
        onClearAll={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Област: Бургас/ }),
    ).toBeInTheDocument();
  });

  it("a toggle chip carries no dimension prefix", () => {
    // „само с декларация" is already a whole sentence; „Филтър: само с декларация" is worse.
    //
    // ⚠️ ASSERTED ON THE CHIP ITSELF. An earlier version checked the page for a „:" — which
    // the „Показани са само:" lead-in supplies, so it passed whether or not the chip had a
    // prefix, i.e. it could not fail on the behaviour it names.
    render(
      <PersonsActiveFilters
        chips={[chip("decl", "само с декларация")]}
        onClearAll={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /само с декларация/ });
    expect(btn.textContent).toBe("само с декларация");
    expect(btn.getAttribute("aria-label")).not.toContain(":");
  });

  it("clear-all is offered once there is something to clear", async () => {
    const onClearAll = vi.fn();
    render(
      <PersonsActiveFilters
        chips={[chip("role:mp", "Народни представители")]}
        onClearAll={onClearAll}
      />,
    );
    await userEvent.click(screen.getByText("Изчисти филтрите"));
    expect(onClearAll).toHaveBeenCalled();
  });
});
