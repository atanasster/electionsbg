// The /persons hero search field.
//
// WHAT THIS PINS. The field is the page's primary control, so three of its behaviours are
// contracts rather than polish:
//
//   · IT REPORTS EVERY KEYSTROKE UNDEBOUNCED. Two debounces already sit downstream (250 ms to
//     the engine, 350 ms to the URL); a third here would make the box lag the keyboard.
//   · IT EXPLAINS A SUB-FLOOR TERM. On this page there is no table under two characters, so
//     `DbDataTable`'s own body hint has nowhere to render and this is the only explanation a
//     reader gets for why nothing happened.
//   · IT SHOWS THAT HINT ONLY WHEN THE TABLE IS ABSENT. With the table up, the same sentence
//     renders in the table body, and two copies read as two different problems.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { PersonsSearchField } from "./PersonsSearchField";

// There is no i18n instance in unit tests, so every `t(key, { defaultValue })` renders its
// DEFAULT — which is the Bulgarian source of truth for each string. Asserting on those rather
// than on key names therefore pins the sentence a reader actually sees.
const FLOOR_HINT = "Въведете поне 3 знака.";
const GUIDANCE = "Търсете по име, институция или община.";
const FIELD_LABEL = "Търсене на човек или институция";

/** Each sentence now exists up to three times — the visible <p>, the permanent sr-only
 *  description, and the live region — so a plain `getByText` is ambiguous. These ask about the
 *  half a sighted reader actually sees. */
const visibleText = (c: HTMLElement, text: string): boolean =>
  [...c.querySelectorAll("p")].some(
    (el) => !el.classList.contains("sr-only") && el.textContent === text,
  );

const base = {
  onChange: () => {},
  minChars: 3,
  tableVisible: false,
};

describe("the term", () => {
  it("reports every keystroke, undebounced", async () => {
    const onChange = vi.fn();
    render(<PersonsSearchField {...base} value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole("searchbox"), "яв");
    // Controlled: the parent owns the value, so the box never advances on its own and each
    // keystroke reports the SAME single character against an unchanged "" value.
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("Esc clears", async () => {
    const onChange = vi.fn();
    render(<PersonsSearchField {...base} value="явор" onChange={onChange} />);
    screen.getByRole("searchbox").focus();
    await userEvent.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("the clear button clears", async () => {
    const onChange = vi.fn();
    render(<PersonsSearchField {...base} value="явор" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Изчисти/ }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("offers no clear button when there is nothing to clear", () => {
    render(<PersonsSearchField {...base} value="" />);
    expect(screen.queryByRole("button", { name: /Изчисти/ })).toBeNull();
  });

  it("Enter does not submit", async () => {
    // Results are live. Letting Enter through would reload the page out from under a query that
    // has already run.
    //
    // ⚠️ ASSERTED ON `defaultPrevented`, not on `onChange`. Enter never fires onChange in any
    // implementation, so an assertion on that passes whether or not the key is handled — the
    // test would be green on a component that had dropped the handler entirely.
    let prevented: boolean | null = null;
    render(
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter") prevented = e.defaultPrevented;
        }}
      >
        <PersonsSearchField {...base} value="явор" />
      </div>,
    );
    screen.getByRole("searchbox").focus();
    await userEvent.keyboard("{Enter}");
    expect(prevented).toBe(true);
  });
});

describe("the hint", () => {
  it("explains a sub-floor term when there is no table to explain it", () => {
    // The whole reason this hint exists here: with the table hidden, `DbDataTable`'s body hint
    // has nowhere to render, so two characters would produce silence.
    const { container } = render(<PersonsSearchField {...base} value="яв" />);
    expect(visibleText(container, FLOOR_HINT)).toBe(true);
  });

  it("stays quiet about the floor once the table is up", () => {
    // The table body carries the same sentence; two copies read as two problems.
    const { container } = render(
      <PersonsSearchField {...base} value="яв" tableVisible />,
    );
    expect(visibleText(container, FLOOR_HINT)).toBe(false);
  });

  it("shows guidance rather than the floor warning on an empty box", () => {
    const { container } = render(<PersonsSearchField {...base} value="" />);
    expect(visibleText(container, FLOOR_HINT)).toBe(false);
    expect(visibleText(container, GUIDANCE)).toBe(true);
  });

  it("shows guidance rather than the floor warning on a sendable term", () => {
    const { container } = render(<PersonsSearchField {...base} value="явор" />);
    expect(visibleText(container, FLOOR_HINT)).toBe(false);
  });
});

describe("the examples", () => {
  it("appear only on the truly empty landing state", () => {
    const { rerender } = render(
      <PersonsSearchField {...base} value="" examples={["Явор"]} />,
    );
    expect(screen.getByRole("button", { name: "Явор" })).toBeInTheDocument();

    // Typed into → gone. They are an introduction, not a permanent toolbar.
    rerender(<PersonsSearchField {...base} value="я" examples={["Явор"]} />);
    expect(screen.queryByRole("button", { name: "Явор" })).toBeNull();

    // Table up → gone, even with an empty box (a filter is doing the work).
    rerender(
      <PersonsSearchField
        {...base}
        value=""
        examples={["Явор"]}
        tableVisible
      />,
    );
    expect(screen.queryByRole("button", { name: "Явор" })).toBeNull();
  });

  it("a chip sets the term", async () => {
    const onChange = vi.fn();
    render(
      <PersonsSearchField
        {...base}
        value=""
        onChange={onChange}
        examples={["Окръжен съд - Варна"]}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Окръжен съд - Варна" }),
    );
    expect(onChange).toHaveBeenCalledWith("Окръжен съд - Варна");
  });
});

describe("autofocus", () => {
  /** jsdom's `matchMedia` is undefined by default, which would make every autofocus assertion
   *  pass by accident — the effect returns early on the missing API rather than on the width.
   *  Stubbing it is what makes the gate observable at all. */
  const stubMedia = (desktop: boolean) =>
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: desktop && q.includes("min-width"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  afterEach(() => vi.unstubAllGlobals());

  it("focuses the landing on desktop", () => {
    stubMedia(true);
    render(<PersonsSearchField {...base} value="" autoFocus />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("does NOT focus on a phone", () => {
    // Focusing an input opens the keyboard over most of the page — the opposite of a landing
    // built to be read.
    stubMedia(false);
    render(<PersonsSearchField {...base} value="" autoFocus />);
    expect(document.activeElement).not.toBe(screen.getByRole("searchbox"));
  });

  it("does NOT focus an arrival that already asked for something", () => {
    // /persons is reached far more often by deep link (?role=mp, ?court=, ?q=…&decl=1) than by
    // a bare landing, and those readers wanted a list. For a screen-reader user the cost is
    // concrete: focus jumps past the h1 and the deck, so they never hear which page they are
    // on or that the corpus includes name-matched private owners.
    stubMedia(true);
    render(<PersonsSearchField {...base} value="явор" autoFocus={false} />);
    expect(document.activeElement).not.toBe(screen.getByRole("searchbox"));
  });

  it("survives a browser with no matchMedia at all", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() =>
      render(<PersonsSearchField {...base} value="" autoFocus />),
    ).not.toThrow();
  });
});

describe("accessibility", () => {
  it("has an accessible name that is not just its value", () => {
    // The trigger otherwise announces only what has been typed, with no indication of what
    // the field searches.
    render(<PersonsSearchField {...base} value="явор" />);
    expect(
      screen.getByRole("searchbox", { name: FIELD_LABEL }),
    ).toBeInTheDocument();
  });

  it("ALWAYS carries a description, table or no table", () => {
    // The visible hint comes and goes with `tableVisible`; the description must not. Tying the
    // association to it shipped the page's primary control with none at all in the state that
    // is live in production — a screen-reader user heard „Търсене…, search" and nothing about
    // the three-character floor, whose only other explanation is 400 px down the page and not
    // associated with this input.
    for (const tableVisible of [false, true]) {
      const { unmount } = render(
        <PersonsSearchField {...base} value="яв" tableVisible={tableVisible} />,
      );
      const id = screen.getByRole("searchbox").getAttribute("aria-describedby");
      expect(id, `tableVisible=${tableVisible}`).toBeTruthy();
      // …and it must POINT AT SOMETHING. A dangling id reads to a screen reader exactly like
      // no description, while looking correct in the DOM.
      expect(document.getElementById(id!)?.textContent).toContain(FLOOR_HINT);
      unmount();
    }
  });

  it("gives each instance its own ids", () => {
    // Module-level constants collide the moment a second field mounts (a mobile/desktop pair,
    // a repeat below the fold), silently breaking both `htmlFor` and `aria-describedby`.
    const { container } = render(
      <>
        <PersonsSearchField {...base} value="" />
        <PersonsSearchField {...base} value="" />
      </>,
    );
    const ids = [...container.querySelectorAll("input")].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    // Each label still resolves to its own input.
    for (const id of ids)
      expect(container.querySelector(`label[for="${id}"]`)).not.toBeNull();
  });

  it("announces the floor through a live region that was already mounted", () => {
    // A `role="status"` ADDED in the same commit as its text is typically not announced, so
    // the one sentence that exists because nothing else explains the silence would be the one
    // least likely to be spoken. The region is permanent; only its contents change.
    const { rerender, container } = render(
      <PersonsSearchField {...base} value="" />,
    );
    const live = container.querySelector('[role="status"]');
    expect(live).not.toBeNull();
    expect(live!.textContent).toBe("");

    rerender(<PersonsSearchField {...base} value="яв" />);
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      FLOOR_HINT,
    );
  });
});
