// The /persons landing.
//
// WHAT THIS PINS. The landing replaces a 137,461-row table that answered nobody's question, so
// what it publishes instead has to be honest about what it does not yet know:
//
//   · a count that has not arrived renders „—", never 0 — a zero is a claim about the corpus;
//   · a card whose count IS zero does not render, because it promises rows a click cannot show;
//   · the escape hatch always renders, because the rule that hides the table must never trap
//     a reader who genuinely wants the register.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { PersonsLanding, type LandingCard } from "./PersonsLanding";

const card = (key: string, count?: number): LandingCard => ({
  key,
  label: `Етикет ${key}`,
  hint: `Пояснение ${key}`,
  count,
  to: `/persons?${key}=1`,
});

const renderLanding = (
  cards: LandingCard[],
  onClick = () => {},
  mix: ReactNode = <div>МИКС</div>,
) =>
  render(
    <MemoryRouter>
      <PersonsLanding
        cards={cards}
        mix={mix}
        browseAll={{ label: "Разгледай всички 137 461 лица", onClick }}
        fmtInt={(n) => n.toLocaleString("bg-BG")}
      />
    </MemoryRouter>,
  );

describe("the cards", () => {
  it("renders a dash, not a zero, while a count is in flight", () => {
    // „Сменили партия 0" is a statement about the corpus. „—" is the truth.
    renderLanding([card("switch", undefined)]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("keeps an unresolved card in the grid rather than dropping and re-adding it", () => {
    // `undefined` is not-loaded and `0` is none. Filtering on falsiness collapses the two, so
    // the grid would paint four cards and then drop to two as the facets land — the reflow a
    // placeholder exists to prevent.
    renderLanding([card("a", undefined), card("b", 5)]);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("marks an unresolved count as busy, not as an em dash nobody hears", () => {
    renderLanding([card("a", undefined)]);
    expect(screen.getByLabelText("зарежда се")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("suppresses a card whose count is genuinely zero", () => {
    // A card is a promise of rows. `is_donor` is 0 corpus-wide today, and a „Дарители 0" tile
    // is a link to an empty table.
    renderLanding([card("switch", 0), card("decl", 5)]);
    expect(screen.queryByText("Етикет switch")).toBeNull();
    expect(screen.getByText("Етикет decl")).toBeInTheDocument();
  });

  it("drops the whole section when every card is suppressed", () => {
    renderLanding([card("switch", 0), card("decl", 0)]);
    expect(screen.queryByText("Започнете оттук")).toBeNull();
    // …but never the escape hatch.
    expect(
      screen.getByText("Разгледай всички 137 461 лица"),
    ).toBeInTheDocument();
  });

  it("each card links to the query it names", () => {
    renderLanding([card("switch", 5_146)]);
    expect(screen.getByRole("link", { name: /Етикет switch/ })).toHaveAttribute(
      "href",
      "/persons?switch=1",
    );
  });

  it("formats the count through the caller's locale formatter", () => {
    renderLanding([card("switch", 5_146)]);
    // bg-BG groups with a non-breaking space; asserting on the formatter's own output rather
    // than on a literal keeps this from being a claim about Intl.
    expect(
      screen.getByText((5146).toLocaleString("bg-BG")),
    ).toBeInTheDocument();
  });
});

describe("the escape hatch", () => {
  it("always renders, even with no cards at all", () => {
    // The rule is "no query, no filter, no table". Without a way to say „show me anyway" that
    // rule can trap a reader — and this page IS a register, so wanting the list is legitimate.
    renderLanding([]);
    expect(
      screen.getByText("Разгледай всички 137 461 лица"),
    ).toBeInTheDocument();
  });

  it("calls back rather than navigating", async () => {
    // It sets `?browse=1` through the URL hook, so the screen owns the transition — a bare
    // <Link> would drop every other param the reader has set.
    const onClick = vi.fn();
    renderLanding([], onClick);
    await userEvent.click(screen.getByText("Разгледай всички 137 461 лица"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("the mix bar", () => {
  it("is rendered by the caller, not rebuilt here", () => {
    // The same element serves the landing and the results view; two copies would drift.
    renderLanding([card("decl", 5)], () => {}, <div>МИКС-ЕЛЕМЕНТ</div>);
    expect(screen.getByText("МИКС-ЕЛЕМЕНТ")).toBeInTheDocument();
  });
});
