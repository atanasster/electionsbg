// The tile's own contract, pinned directly rather than only through PersonScreen.
//
// Two things here are easy to get wrong and invisible from the outside. The tile DROPS
// roles it cannot place, and it does so on two predicates, not one — the second (an
// unparseable date) is the blind spot a caller counting `!added_at` would miss, which is
// why `isPlottableRole` is shared rather than restated. And the `note` prop exists to say
// how many were dropped, so „renders when passed, absent when not" is the contract the
// caller's honesty depends on.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonTimelineTile, type TimelineRole } from "./PersonTimelineTile";
import { isPlottableRole } from "./plottableRole";

const role = (over: Partial<TimelineRole> = {}): TimelineRole => ({
  uic: "123456789",
  company: "АКМЕ ООД",
  role: "manager",
  added_at: "2020-01-01",
  erased_at: null,
  active: true,
  ...over,
});

const show = (roles: TimelineRole[], note?: string) =>
  render(
    <MemoryRouter>
      <PersonTimelineTile roles={roles} note={note} />
    </MemoryRouter>,
  );

const bars = (): number => document.querySelectorAll("[title*='→']").length;

describe("isPlottableRole", () => {
  it("accepts a parseable start date", () => {
    expect(isPlottableRole({ added_at: "2020-01-01" })).toBe(true);
  });

  it("rejects a missing start date", () => {
    expect(isPlottableRole({ added_at: null })).toBe(false);
    expect(isPlottableRole({ added_at: "" })).toBe(false);
  });

  it("rejects an UNPARSEABLE start date — the caller's blind spot", () => {
    // A caller counting `!added_at` would call this plottable and then fail to explain
    // the bar that never appeared.
    expect(isPlottableRole({ added_at: "не се чете" })).toBe(false);
  });
});

describe("PersonTimelineTile", () => {
  it("self-hides when no role can be placed", () => {
    const { container } = show([role({ added_at: null })]);
    expect(container.firstChild).toBeNull();
  });

  it("draws one bar per plottable role", () => {
    show([
      role({ role: "manager" }),
      role({ role: "partner", added_at: "2021-01-01" }),
    ]);
    expect(bars()).toBe(2);
  });

  it("drops an unplottable role but keeps the rest", () => {
    // The tile does NOT hide itself for a partial set — it renders what it can and says
    // nothing, which is precisely why the caller passes a note counting the difference.
    show([role(), role({ role: "partner", added_at: "не се чете" })]);
    expect(bars()).toBe(1);
  });

  it("renders the note when given one", () => {
    show([role()], "Същата фирма, подредена във времето.");
    expect(
      screen.getByText("Същата фирма, подредена във времето."),
    ).toBeInTheDocument();
  });

  it("renders no note block when none is given", () => {
    show([role()]);
    // Only the heading's own subtitle, no caveat paragraph.
    expect(screen.queryByText(/подредена във времето/)).toBeNull();
  });
});
