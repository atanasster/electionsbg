// The SHARED half of the registry search field — what `PersonsSearchField.test.tsx` cannot see.
//
// That file renders /persons' wrapper and asserts /persons' strings, which is the right test
// for /persons and is now also, by construction, a test of this component's behaviour. What it
// cannot assert is the thing the extraction introduced: that the strings and the element ids
// are genuinely PARAMETERS, so two registry pages get their own copy of each rather than
// /persons' by accident.
//
// The failure that would produce is silent and reads as correct: /companies shipping „Търси име
// или институция…" over a corpus of a million companies, with every test green.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  RegistrySearchField,
  type RegistrySearchLabels,
} from "./RegistrySearchField";

// There is no i18n instance in unit tests, so every `t(key, { defaultValue })` renders its
// fallback — which is what makes the fallbacks assertable here.
const LABELS: RegistrySearchLabels = {
  label: { key: "x_label", fallback: "ЕТИКЕТ" },
  placeholder: { key: "x_placeholder", fallback: "ПЛЕЙСХОЛДЪР" },
  hint: { key: "x_hint", fallback: "ПОДСКАЗКА" },
  clear: { key: "x_clear", fallback: "ИЗЧИСТИ" },
  examples: { key: "x_examples", fallback: "НАПРИМЕР" },
};

const base = {
  labels: LABELS,
  idPrefix: "x",
  minChars: 3,
  tableVisible: false,
  onChange: () => {},
};

describe("RegistrySearchField — the strings are parameters", () => {
  it("renders every one of the five supplied labels, and none of /persons'", () => {
    render(<RegistrySearchField {...base} value="" examples={["ПРИМЕР"]} />);
    expect(screen.getByLabelText("ЕТИКЕТ")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ПЛЕЙСХОЛДЪР")).toBeInTheDocument();
    expect(screen.getAllByText("ПОДСКАЗКА").length).toBeGreaterThan(0);
    expect(screen.getByText("НАПРИМЕР")).toBeInTheDocument();
    // The leak this test exists for: a hard-coded /persons string surviving the extraction.
    expect(document.body.textContent).not.toMatch(/институция/);
  });

  it("renders the clear button's supplied accessible name", () => {
    render(<RegistrySearchField {...base} value="нещо" />);
    expect(screen.getByRole("button", { name: "ИЗЧИСТИ" })).toBeInTheDocument();
  });

  it("prefixes its element ids, so two pages' fields cannot collide", () => {
    // `htmlFor` and `aria-describedby` both key on the generated id. Two registry pages mounted
    // in one tree (or one page with a mobile/desktop pair) sharing an id silently breaks both.
    const { container } = render(<RegistrySearchField {...base} value="" />);
    const input = container.querySelector("input")!;
    expect(input.id).toMatch(/^x-search-/);
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-hint`);
  });

  it("gives two instances with different prefixes different ids", () => {
    const { container } = render(
      <>
        <RegistrySearchField {...base} value="" />
        <RegistrySearchField {...base} idPrefix="y" value="" />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll("input"));
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^x-search-/);
    expect(b.id).toMatch(/^y-search-/);
  });

  it("⚠️ the sr-only description is present even when the visible hint is not", () => {
    // The permanence rule: the visible hint comes and goes with `tableVisible`, and an
    // association that came and went with it left a screen-reader user hearing „Търсене…,
    // search" and nothing about the floor. Asserted on the SHARED component because both
    // wrappers inherit it.
    const { container } = render(
      <RegistrySearchField {...base} value="нещо" tableVisible />,
    );
    const input = container.querySelector("input")!;
    const hint = container.querySelector(`#${CSS.escape(input.id)}-hint`);
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(/ПОДСКАЗКА/);
    // …while the visible <p> is suppressed, so the sentence is not rendered twice.
    expect(container.querySelector("p")).toBeNull();
  });
});
