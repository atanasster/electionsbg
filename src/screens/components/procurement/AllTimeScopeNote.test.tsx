// The note that stops a windowed figure from reading as the whole story.
//
// Every assertion here is about a sentence a reader could otherwise take as false:
// a scoped total presented as the company's procurement, an empty window presented as
// „this company has no contracts", or a count from one basis printed beside a sum from
// another.
//
//   npx vitest run src/screens/components/procurement/AllTimeScopeNote.test.tsx

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AllTimeScopeNote } from "./AllTimeScopeNote";
import type { Scope } from "@/data/scope/useScope";

const show = (over: Partial<Parameters<typeof AllTimeScopeNote>[0]> = {}) =>
  render(
    <AllTimeScopeNote
      side="supplier"
      scope={"ns" as Scope}
      scopedEur={3_969_914}
      allTimeEur={22_424_885}
      allTimeCount={1860}
      onShowAll={() => {}}
      lang="bg"
      {...over}
    />,
  );

describe("AllTimeScopeNote", () => {
  it("names the all-time total beside a windowed one", () => {
    // The reported case: the search advertised €22,4 млн. and the page showed €4 млн.
    show();
    expect(screen.getByText(/22,4/)).toBeTruthy();
    expect(screen.getByText(/за всички периоди/)).toBeTruthy();
  });

  it("the inline note is money-only and self-anchoring", () => {
    // ⚠️ NO COUNT inline. The StatCard it sits under already prints a scoped „Договори"
    // figure; a second count on one card reads as a contradiction rather than as a second
    // window. And the copy must not open with „от": on the supplier card this line follows
    // „средно €X / договор", so „от" would attach to the AVERAGE above it.
    show({ allTimeCount: 1860 });
    expect(screen.queryByText(/1\s*860/)).toBeNull();
    expect(screen.queryByText(/договора на стойност/)).toBeNull();
    expect(screen.getByText(/общо/)).toBeTruthy();
  });

  it("renders NOTHING when the page already shows every period", () => {
    // On ?pscope=all the two figures ARE the same number; repeating it would read as a
    // second, different total.
    const { container } = show({
      scope: "all" as Scope,
      scopedEur: 22_424_885,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders NOTHING when the window happens to hold everything", () => {
    // A company whose whole history sits inside the selected window has nothing to add.
    const { container } = show({ scopedEur: 22_424_885 });
    expect(container.firstChild).toBeNull();
  });

  it("renders NOTHING when there is no all-time figure to state", () => {
    // An absent/zero total must not become „от €0 за всички периоди" — that is a claim.
    const { container } = show({ allTimeEur: 0 });
    expect(container.firstChild).toBeNull();
  });

  it("STILL says the window is empty when there is no all-time figure", () => {
    // ⚠️ The empty-window sentence replaced an UNCONDITIONAL line, so it may not inherit
    // the inline mode's guard. 1,226 supplier EIKs have corpus rows but no positive
    // contract-tag total (23 of them amendment-only); sharing the guard rendered every
    // one of those pages as a bare icon with no text.
    show({ emptyWindow: true, scopedEur: 0, allTimeEur: 0 });
    expect(screen.getByText(/Няма договори за избрания период/)).toBeTruthy();
    expect(screen.queryByText(/За всички периоди/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("STILL says the window is empty on ?pscope=all", () => {
    // Same shape one guard over: on the full corpus there is no wider window to offer,
    // but „this window holds nothing" is still the thing the reader needs told.
    show({ emptyWindow: true, scope: "all" as Scope, scopedEur: 0 });
    expect(screen.getByText(/Няма договори за избрания период/)).toBeTruthy();
    expect(screen.queryByText(/За всички периоди/)).toBeNull();
  });

  it("switches the page to the full corpus on click", async () => {
    const onShowAll = vi.fn();
    show({ onShowAll });
    await userEvent.click(
      screen.getByRole("button", { name: /Виж всички периоди/ }),
    );
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("an EMPTY window says where the money is, not just that this window is empty", () => {
    // 87.7% of contractors have no contract in the default window, so this is the state
    // most readers arriving from a search land in.
    show({ emptyWindow: true, scopedEur: 0 });
    expect(screen.getByText(/Няма договори за избрания период/)).toBeTruthy();
    expect(screen.getByText(/1\s*860/)).toBeTruthy();
    expect(screen.getByText(/22,4/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Виж всички периоди/ }),
    ).toBeTruthy();
  });

  it("the buyer side names the buy-side wording on its empty window", () => {
    show({ emptyWindow: true, side: "buyer", scopedEur: 0 });
    expect(
      screen.getByText(/Няма възложени договори за избрания период/),
    ).toBeTruthy();
  });

  it("omits the COUNT when the serving function did not supply one", () => {
    // ⚠️ The degrade that must not become „0 договора": `contract_rows` arrived with this
    // change, so a `db` function older than the bundle omits it. Money alone is a true,
    // narrower sentence; a zero would be a false one.
    show({ emptyWindow: true, scopedEur: 0, allTimeCount: undefined });
    expect(screen.getByText(/22,4/)).toBeTruthy();
    expect(screen.queryByText(/договора на стойност/)).toBeNull();
    expect(screen.queryByText(/\b0 договора/)).toBeNull();
  });

  it("renders in English too", () => {
    show({ lang: "en" });
    expect(screen.getByText(/across all periods/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Show all periods/ }),
    ).toBeTruthy();
  });
});
