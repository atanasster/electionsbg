// The picker's filter must accept shliokavitsa — a Latin-typed query against a
// Cyrillic roster. It used to be a plain `toLocaleLowerCase().includes()`, which
// is invisible when it breaks: the list simply comes back empty and reads as
// "no such candidate" rather than "your keyboard layout is wrong".
//
// This is the representative case for the four pickers fixed together (this one
// plus the three НЗОК tiles); they all now route through the same
// `searchMatches`, whose folding rules are unit-tested in translitSearch.test.ts.
// Testing it once at the component level is what proves the component actually
// CALLS it — the part a pure-util test cannot see.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CandidatePicker, type CandidateOption } from "./CandidatePicker";

beforeEach(() => {
  // jsdom lacks it; cmdk observes its list container.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // Radix scrolls the active item into view; jsdom has no layout.
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});

const OPTIONS: CandidateOption[] = [
  { name: "Иван Георгиев Иванов", oblastCodes: [], prefs: [] },
  { name: "Даринка Шуменска", oblastCodes: [], prefs: [] },
  { name: "Петър Червенков", oblastCodes: [], prefs: [] },
];

/** Open the picker and return a `type(query)` bound to its search box.
 *  Both the trigger button and cmdk's input carry role="combobox", so the
 *  input is picked by tag rather than by role alone. */
const open = async () => {
  const user = userEvent.setup();
  render(
    <CandidatePicker
      label="Кандидат"
      options={OPTIONS}
      placeholder="Избери"
      onChange={vi.fn()}
    />,
  );
  await user.click(screen.getAllByRole("combobox")[0]);
  const input = screen
    .getAllByRole("combobox")
    .find((el): el is HTMLInputElement => el.tagName === "INPUT");
  if (!input) throw new Error("cmdk search input did not render");
  return (query: string) => user.type(input, query);
};

describe("CandidatePicker filter", () => {
  it("matches a Cyrillic roster from a Latin query", async () => {
    const type = await open();
    await type("ivanov");
    expect(screen.getByText("Иван Георгиев Иванов")).toBeInTheDocument();
    expect(screen.queryByText("Петър Червенков")).not.toBeInTheDocument();
  });

  it("matches the Latin-side shliokavitsa spellings", async () => {
    const type = await open();
    await type("6umenska");
    expect(screen.getByText("Даринка Шуменска")).toBeInTheDocument();
    expect(screen.queryByText("Иван Георгиев Иванов")).not.toBeInTheDocument();
  });

  it("still matches plain Cyrillic", async () => {
    const type = await open();
    await type("червен");
    expect(screen.getByText("Петър Червенков")).toBeInTheDocument();
    expect(screen.queryByText("Даринка Шуменска")).not.toBeInTheDocument();
  });

  it("shows every option for an empty query", async () => {
    await open();
    for (const o of OPTIONS)
      expect(screen.getByText(o.name)).toBeInTheDocument();
  });
});
