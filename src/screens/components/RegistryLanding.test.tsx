// `RegistryLanding` — the two GENERALISATION AXES, which neither page's suite can see.
//
// `PersonsLanding.test.tsx` renders one browse action and a mix bar; `CompaniesLanding.test.tsx`
// renders two actions and no `above`. Between them the three-state count contract is covered
// twice over — but neither can assert what the extraction actually introduced: that `above` is
// OPTIONAL and that `browse` is a LIST rather than a pair of hard-coded slots. A regression
// rendering only `browse[0]`, or requiring `above`, passes one suite and fails the other in a
// way that reads as that page's bug.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  RegistryLanding,
  type BrowseAction,
  type RegistryLandingLabels,
} from "./RegistryLanding";

const LABELS: RegistryLandingLabels = {
  startHere: { key: "x_start", fallback: "ЗАПОЧНЕТЕ" },
  loading: { key: "x_loading", fallback: "ЗАРЕЖДА" },
};

const ACTION = (key: string): BrowseAction => ({
  key,
  label: `LABEL_${key}`,
  hint: `HINT_${key}`,
  onClick: () => {},
});

const renderLanding = (
  props: Partial<Parameters<typeof RegistryLanding>[0]> = {},
) =>
  render(
    <MemoryRouter>
      <RegistryLanding
        cards={[{ key: "a", label: "A", hint: "h", count: 5, to: "/x" }]}
        browse={[ACTION("one")]}
        labels={LABELS}
        idPrefix="x"
        fmtInt={String}
        {...props}
      />
    </MemoryRouter>,
  );

describe("the `above` slot", () => {
  it("renders what it is given", () => {
    renderLanding({ above: <div>МИКС</div> });
    expect(screen.getByText("МИКС")).toBeInTheDocument();
  });

  it("⚠️ is OPTIONAL — /companies passes nothing", () => {
    // Its corpus breakdown is the head's evidence aside, and offering the same partition twice
    // on one screen is the „Бизнес" segment problem /persons had to write a paragraph about.
    // A required slot would have forced a placeholder there.
    const { container } = renderLanding();
    expect(container.querySelector("section")).not.toBeNull();
    expect(screen.queryByText("МИКС")).toBeNull();
  });
});

describe("the `browse` list", () => {
  it("⚠️ renders EVERY action, not just the first", () => {
    // The axis /companies needed: its second action IS the has_signal floor, so a component
    // that rendered only `browse[0]` would silently drop the whole-registry escape and leave
    // the floored view as the only way in.
    renderLanding({ browse: [ACTION("one"), ACTION("two"), ACTION("three")] });
    for (const k of ["one", "two", "three"])
      expect(
        screen.getByRole("button", { name: `LABEL_${k}` }),
      ).toBeInTheDocument();
  });

  it("gives each action its OWN hint, associated with its own button", () => {
    // Two actions promising different things cannot share a hint — one of them would be
    // misdescribed.
    const { container } = renderLanding({
      browse: [ACTION("one"), ACTION("two")],
    });
    for (const k of ["one", "two"]) {
      const b = screen.getByRole("button", { name: `LABEL_${k}` });
      const id = b.getAttribute("aria-describedby")!;
      expect(container.querySelector(`#${CSS.escape(id)}`)!.textContent).toBe(
        `HINT_${k}`,
      );
    }
  });

  it("⚠️ emphasis is EXPLICIT, not positional and not an opt-out", () => {
    // The first draft documented „the first action is the recommended one" and implemented
    // `primary === false`, so `[{…}, {…, primary: true}]` would have rendered two primaries and
    // read as correct at both the call site and the definition.
    const { container } = renderLanding({
      browse: [
        { ...ACTION("one"), emphasis: "secondary" },
        { ...ACTION("two"), emphasis: "primary" },
      ],
    });
    const [first, second] = Array.from(container.querySelectorAll("button"));
    expect(first.className).not.toMatch(/font-semibold/);
    expect(second.className).toMatch(/font-semibold/);
  });

  it("defaults to primary when emphasis is omitted", () => {
    const { container } = renderLanding();
    expect(container.querySelector("button")!.className).toMatch(
      /font-semibold/,
    );
  });
});

describe("the escape hatch survives an empty card set", () => {
  it("renders the browse actions even when every card is suppressed", () => {
    // „No query, no filter, no table" is a rule that can trap a reader who genuinely wants the
    // list, and these pages ARE registers. The hatch is not conditional on anything.
    renderLanding({
      cards: [{ key: "a", label: "A", hint: "h", count: 0, to: "/x" }],
    });
    expect(screen.queryByText("ЗАПОЧНЕТЕ")).toBeNull();
    expect(
      screen.getByRole("button", { name: "LABEL_one" }),
    ).toBeInTheDocument();
  });
});

describe("id scoping", () => {
  it("prefixes both the section heading and every hint", () => {
    const { container } = renderLanding({ idPrefix: "y" });
    expect(
      container.querySelector("section")!.getAttribute("aria-labelledby"),
    ).toMatch(/^y-start-here-/);
    expect(
      container.querySelector("button")!.getAttribute("aria-describedby"),
    ).toMatch(/^y-browse-one-/);
  });
});
