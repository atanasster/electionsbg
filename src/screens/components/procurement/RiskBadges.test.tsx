// The contract detail header — the A–F grade badge, and the check ledger being
// ALWAYS OPEN.
//
// The grade is the letter every OTHER procurement surface leads with — the
// riskiest-contracts board links here with an "F" chip, and `?grade=D,E,F`
// filters the browsers on the same column — and the detail page was the one
// place that dropped it, so an F contract read as a bare "6 of 10" once opened.
// Three properties, all silent when broken:
//
//   1. THE LETTER IS THE SERVER'S. It comes from `risk_grade` (migration 112),
//      not from re-banding the fired count here; a second implementation of
//      contract_risk_grade_letter() would drift from the column the filter queries.
//   2. AN UNRECOGNISED LETTER MUST NOT THROW. `risk_grade` is a text column, and
//      indexing GRADE_TONE with anything outside A–F yields undefined — reading
//      `.chip` off it takes the whole contract page down.
//   3. THE LEDGER NEEDS NO CLICK. It was a closed-by-default disclosure, which
//      hid the only thing on the page that says WHICH checks fired behind a
//      header reading "6 of 10". Re-collapsing it would look like a styling
//      change and lose the whole explanation.
//
//   4. `full` FETCHES THE PER-FLAG DETAIL ON MOUNT and `chips` still does not.
//      The ledger renders the concentration share, firm age and split size, so
//      deferring them to a dwell shows those rows incomplete; deferring is still
//      right for `chips`, where a 100-row table would issue 100 requests.
//
// vitest.setup.ts makes an unstubbed fetch throw. Most renders here pass no
// contractKey, so the detail query is disabled and nothing is issued; the two
// cases that assert fetch behaviour install their own spy.

import type { ComponentProps } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describe, it, expect, vi, beforeAll } from "vitest";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en/translation.json";
import { contractRiskFromMasks } from "@/lib/contractRiskMask";
import { RiskBadges } from "./RiskBadges";

// The SHIPPED bundle, not a stub: the hint's three placeholders live in the
// translation file, and a renamed one there would leave "{{fired}}" on screen
// while every code-side assertion still passed.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

/** 3 fired of 10 available — the shape of a D-graded contract. Bits 1, 2 and 3
 *  fire (mpConnected, pepConnected, awarderConcentration); bit 0 (debarred) is
 *  available and does NOT fire, which is the ledger's `pass` state; bits 10–11
 *  are absent from the available mask, which is its `not applicable` state. */
const result = contractRiskFromMasks({
  riskFiredMask: 0b0000_0000_1110,
  riskAvailableMask: 0b0011_1111_1111,
});

const renderBadges = (props: Partial<ComponentProps<typeof RiskBadges>>) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <RiskBadges result={result} variant="full" {...props} />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

const renderHeader = (grade?: string | null) => renderBadges({ grade });

describe("RiskBadges grade badge", () => {
  it("renders the server's letter beside the fired count", () => {
    renderHeader("D");
    // The letter itself, and the count it is banded on, in one header.
    expect(screen.getByText("D")).toBeTruthy();
    expect(screen.getByText(/3\s+.*\s+10/)).toBeTruthy();
  });

  it("shows the whole band table in the badge's accessible name", () => {
    renderHeader("D");
    // BY ROLE, not by text + toHaveAccessibleName. The bug this guards is a
    // badge with no role: ARIA `generic` is name-prohibited, so a real browser
    // drops the aria-label and the band explanation reaches nobody. jsdom is
    // MORE PERMISSIVE than Chromium here and computes a name for a role-less
    // span anyway — verified by mutation: deleting role="note" leaves a
    // getByText + toHaveAccessibleName pair entirely green. Querying by role is
    // what actually fails when the role goes.
    const badge = screen.getByRole("note", { name: /Risk grade D/ });
    expect(badge).toHaveAccessibleName(/3 of 10/);
    expect(badge).toHaveTextContent("D");
    // Every placeholder resolved — a renamed one in the bundle shows through here.
    expect(badge.getAttribute("aria-label") ?? "").not.toContain("{{");
  });

  it("omits the badge when the row carries no grade", () => {
    renderHeader(null);
    expect(screen.queryByText("D")).toBeNull();
  });

  it("omits — rather than crashes on — a letter outside A–F", () => {
    // A value GRADE_TONE has no entry for: the palette lookup would be
    // undefined and `.chip` would throw, taking the page with it.
    expect(() => renderHeader("Z")).not.toThrow();
    expect(screen.queryByText("Z")).toBeNull();
  });

  it("rejects an inherited Object.prototype key", () => {
    // `in` would accept these — the guard has to be an own-property check, or
    // the badge renders the literal string with an `undefined` class.
    renderHeader("constructor");
    expect(screen.queryByText("constructor")).toBeNull();
  });
});

describe("RiskBadges check ledger", () => {
  it("explains every check on first paint, with no interaction", () => {
    renderHeader("D");
    expect(screen.getByText(/Automated risk indicators/)).toBeTruthy();
    // Fired (bits 1 and 3) and passed (bit 0) both named, not just counted —
    // the passed row is the ledger's whole point over the "N of M" summary.
    expect(screen.getByText("Contractor is connected to an MP")).toBeTruthy();
    expect(
      screen.getByText("Awarder concentrated on this contractor"),
    ).toBeTruthy();
    expect(screen.getByText("On АОП debarred-suppliers register")).toBeTruthy();
    // And a check that could not run (bit 10 absent from the available mask) —
    // "not checked" is the distinction the ledger exists to draw.
    expect(screen.getByText("Direct / no-notice award")).toBeTruthy();
    expect(screen.getAllByText("not applicable").length).toBeGreaterThan(0);
  });

  it("has no expand/collapse control", () => {
    const { container } = renderHeader("D");
    // The header was a <button aria-expanded>. Nothing may gate the ledger again.
    expect(container.querySelector("[aria-expanded]")).toBeNull();
  });
});

describe("RiskBadges detail fetch", () => {
  const stubFetch = () =>
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ detail: null })));

  it("fetches the per-flag detail on mount in the full variant", async () => {
    const fetchSpy = stubFetch();
    // The ledger displays this detail rather than hiding it in a tooltip, so
    // waiting for a dwell would paint those rows incomplete. Re-defaulting
    // wantDetail to false is a one-token regression this is here to catch.
    renderBadges({ contractKey: "abc123456789" });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0][0])).toContain("abc123456789");
  });

  it("still defers the chips variant to a dwell", () => {
    const fetchSpy = stubFetch();
    // The reason the dwell exists: one contracts table renders 100 of these.
    renderBadges({ variant: "chips", contractKey: "abc123456789" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fetch for an unscored contract", async () => {
    const fetchSpy = stubFetch();
    // The detail hook sits above the unscored early return, which renders the
    // "?" mark and none of the detail — so the response would have no reader.
    renderBadges({ result: null, contractKey: "abc123456789" });
    await waitFor(() =>
      expect(screen.getByRole("note", { name: /not scored/i })).toBeTruthy(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("RiskBadges unscored state", () => {
  it("renders a labelled mark, and no grade badge even when one is passed", () => {
    // ContractDetailScreen renders RiskBadges unconditionally so this shows;
    // collapsing it to the "—" of a clean contract is the bug it guards.
    renderBadges({ result: null, grade: "F" });
    expect(screen.getByRole("note", { name: /not scored/i })).toBeTruthy();
    expect(screen.queryByText("F")).toBeNull();
  });
});
