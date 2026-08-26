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
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  RegistrySearchField,
  type RegistrySearchLabels,
} from "./RegistrySearchField";
import { QUERY_MAX } from "@/ux/data_table/searchTerm";

// There is no i18n instance in unit tests, so every `t(key, { defaultValue })` renders its
// fallback — which is what makes the fallbacks assertable here.
const LABELS: RegistrySearchLabels = {
  label: { key: "x_label", fallback: "ЕТИКЕТ" },
  placeholder: { key: "x_placeholder", fallback: "ПЛЕЙСХОЛДЪР" },
  hint: { key: "x_hint", fallback: "ПОДСКАЗКА" },
  clear: { key: "x_clear", fallback: "ИЗЧИСТИ" },
  examples: { key: "x_examples", fallback: "НАПРИМЕР" },
  submit: { key: "x_submit", fallback: "ТЪРСИ" },
  pending: { key: "x_pending", fallback: "НАТИСНЕТЕ" },
};

const base = {
  labels: LABELS,
  idPrefix: "x",
  minChars: 3,
  tableVisible: false,
  onChange: () => {},
  onSubmit: () => {},
  // The settled state: the box agrees with the results. Every assertion about the STANDING
  // hint needs it, because a draft that has moved past `applied` legitimately replaces that
  // hint with „натиснете Търси".
  applied: "",
};

describe("RegistrySearchField — the strings are parameters", () => {
  it("renders every one of the five supplied labels, and none of /persons'", () => {
    render(<RegistrySearchField {...base} value="" examples={["ПРИМЕР"]} />);
    // Role-scoped, not `getByLabelText`: the same string now names the `search` LANDMARK as
    // well as the box (deliberately — one string, so the two cannot disagree), so a bare
    // label query is ambiguous.
    expect(
      screen.getByRole("searchbox", { name: "ЕТИКЕТ" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ПЛЕЙСХОЛДЪР")).toBeInTheDocument();
    expect(screen.getAllByText("ПОДСКАЗКА").length).toBeGreaterThan(0);
    expect(screen.getByText("НАПРИМЕР")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ТЪРСИ" })).toBeInTheDocument();
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
    // `applied` matches the box, so the state is SETTLED — otherwise „натиснете Търси" is
    // legitimately on screen and the suppression this asserts is about a different sentence.
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="нещо"
        applied="нещо"
        tableVisible
      />,
    );
    const input = container.querySelector("input")!;
    const hint = container.querySelector(`#${CSS.escape(input.id)}-hint`);
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(/ПОДСКАЗКА/);
    // …while the visible <p> is suppressed, so the sentence is not rendered twice.
    expect(container.querySelector("p")).toBeNull();
  });
});

// ---- the commit ------------------------------------------------------------------------
//
// WHAT THIS PINS. The field holds a DRAFT and reports it on every keystroke; nothing downstream
// sees a term until one of the five commit paths fires. Each of them is a reader saying „this
// one" — and the two that clear (Esc, ×) are as much a commit as the button is, because leaving
// an emptied box uncommitted parks the page in the disagreeing state the × exists to end.
describe("RegistrySearchField — the term is committed, not live", () => {
  it("typing reports the draft and commits nothing", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RegistrySearchField
        {...base}
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "ив");
    // Controlled: the parent owns the value, so each keystroke reports against an unchanged "".
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("the button commits the draft", async () => {
    const onSubmit = vi.fn();
    render(
      <RegistrySearchField {...base} value="иванов" onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ТЪРСИ" }));
    expect(onSubmit).toHaveBeenCalledWith("иванов");
  });

  it("Enter commits the draft", async () => {
    // Through a real <form>, so this is the browser's own behaviour rather than a keydown
    // handler that could be dropped without any assertion noticing.
    const onSubmit = vi.fn();
    render(
      <RegistrySearchField {...base} value="иванов" onSubmit={onSubmit} />,
    );
    screen.getByRole("searchbox").focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("иванов");
  });

  it("the clear button empties the box AND commits the empty term", async () => {
    // Both halves. Clearing the draft alone would leave the previous term's results on screen
    // under an empty box — the reader would have to press a button to finish clearing.
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RegistrySearchField
        {...base}
        value="иванов"
        applied="иванов"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ИЗЧИСТИ" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("Esc empties the box AND commits the empty term", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RegistrySearchField
        {...base}
        value="иванов"
        applied="иванов"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    screen.getByRole("searchbox").focus();
    await userEvent.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledWith("");
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("an example chip commits its whole term", async () => {
    // A chip is a whole question, not the start of one — filling the box and waiting for a
    // second click would make the page's own introduction the slowest way to use it.
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <RegistrySearchField
        {...base}
        value=""
        examples={["ПРИМЕР"]}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ПРИМЕР" }));
    expect(onChange).toHaveBeenCalledWith("ПРИМЕР");
    expect(onSubmit).toHaveBeenCalledWith("ПРИМЕР");
  });

  it("commits a SUB-FLOOR term rather than disabling the button", async () => {
    // The floor is enforced downstream (`queryIsSendable` keeps the table shut, `DbDataTable`
    // suppresses the term on its way to the engine), and it EXPLAINS itself here. A disabled
    // primary action with its explanation suppressed — which is what `tableVisible` does to the
    // hint — is a page that has stopped responding for no stated reason.
    const onSubmit = vi.fn();
    render(<RegistrySearchField {...base} value="ив" onSubmit={onSubmit} />);
    const button = screen.getByRole("button", { name: "ТЪРСИ" });
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    expect(onSubmit).toHaveBeenCalledWith("ив");
  });
});

// ---- the disagreement ------------------------------------------------------------------
//
// Committing on submit buys one problem: the results on screen can legitimately be for a
// different term than the one in the box. The field owes the reader a statement of that, and it
// is the ONLY place on the page that can make it — the head band and the table both describe
// the committed term and have no idea a draft exists.
describe("RegistrySearchField — it says when the box has moved past the results", () => {
  it("says so, even with a table up, where every other hint is suppressed", () => {
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="иванова"
        applied="иванов"
        tableVisible
      />,
    );
    expect(container.textContent).toContain("НАТИСНЕТЕ");
  });

  it("stays quiet once the box and the results agree", () => {
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="иванов"
        applied="иванов"
        tableVisible
      />,
    );
    expect(container.textContent).not.toContain("НАТИСНЕТЕ");
  });

  it("ignores whitespace, which the term reader deliberately does not trim", () => {
    // `readQueryParam` keeps trailing space on purpose — a trimmed „Иван Иванов" becomes one
    // token that matches nothing — so an untrimmed comparison would announce a pending search
    // on a term that has already been applied.
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="иванов "
        applied="иванов"
        tableVisible
      />,
    );
    expect(container.textContent).not.toContain("НАТИСНЕТЕ");
  });

  it("⚠️ cannot hold a draft the URL writer would truncate", () => {
    // The one `dirty` state that CANNOT resolve, and therefore the only one that renders an
    // instruction pointing at an inert control. Both `setQuery`s slice to QUERY_MAX, so a longer
    // draft submits a `?q` that does not change, the seeding effect never fires, and „натиснете
    // Търси" stands for ever beside a button that does nothing.
    //
    // Asserted on the ATTRIBUTE rather than on typing: the cap belongs to the URL hook, so a
    // component test cannot reach the stuck state — what it can pin is that the box refuses to
    // enter it. `maxlength` (lower-case) is how the DOM spells it.
    render(<RegistrySearchField {...base} value={"и".repeat(QUERY_MAX)} />);
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "maxlength",
      String(QUERY_MAX),
    );
  });

  it("prefers the FLOOR warning, which explains an empty page rather than a stale one", () => {
    const { container } = render(
      <RegistrySearchField {...base} value="ив" applied="иванов" />,
    );
    expect(container.textContent).toContain("Въведете поне 3 знака.");
    expect(container.textContent).not.toContain("НАТИСНЕТЕ");
  });
});

// ---- what a screen reader hears --------------------------------------------------------
//
// The live region is the only channel this page has for a search's outcome: `DbDataTable` has
// none of its own (zero `aria-live` in src/ux/data_table/) and its „N реда" is plain text. Under
// the old live-search model there was nothing to confirm; an explicit submit sets the
// expectation that activating it reports something, so silence there is a gap the commit
// created even though neither half is new.
describe("RegistrySearchField — the submit reports its outcome", () => {
  const live = (c: HTMLElement) =>
    c.querySelector('[role="status"]')?.textContent ?? "";

  it("announces the result once the box and the results agree", () => {
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="иванов"
        applied="иванов"
        tableVisible
        resultSummary="Намерени са 10 лица."
      />,
    );
    expect(live(container)).toBe("Намерени са 10 лица.");
  });

  it("says the search is PENDING rather than reporting a stale count", () => {
    // The draft has moved past the results, so the summary describes the previous term. Reading
    // it out the moment the reader types is the one thing worse than saying nothing.
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="иванова"
        applied="иванов"
        tableVisible
        resultSummary="Намерени са 10 лица."
      />,
    );
    expect(live(container)).toContain("НАТИСНЕТЕ");
    expect(live(container)).not.toContain("10");
  });

  it("goes quiet, not wrong, when the page has nothing to report", () => {
    // `resultSummary` is optional: a caller with no count in hand must say nothing rather than
    // announce a placeholder. Before this the region was ALWAYS "" in the settled state, and an
    // emptying live region is not announced — so the submit was silent.
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="иванов"
        applied="иванов"
        tableVisible
      />,
    );
    expect(live(container)).toBe("");
  });

  it("prefers the FLOOR warning over the outcome", () => {
    const { container } = render(
      <RegistrySearchField
        {...base}
        value="ив"
        applied="ив"
        resultSummary="Намерени са 10 лица."
      />,
    );
    expect(live(container)).toContain("Въведете поне 3 знака.");
  });
});

// ---- the landmark ----------------------------------------------------------------------
describe("RegistrySearchField — the search landmark is named", () => {
  it("takes its name from the same string as the visible label", () => {
    // Two instances is a supported arrangement (see `idPrefix`), and two UNNAMED `search`
    // landmarks are indistinguishable in a landmark rota — the one navigation aid a
    // screen-reader user has for reaching the box.
    render(<RegistrySearchField {...base} value="" />);
    expect(screen.getByRole("search", { name: "ЕТИКЕТ" })).toBeInTheDocument();
  });
});
