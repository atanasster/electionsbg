// The A–F grade badge on the contract detail header.
//
// The grade is the letter every OTHER procurement surface leads with — the
// riskiest-contracts board links here with an "F" chip, and `?grade=D,E,F`
// filters the browsers on the same column — and the detail page was the one
// place that dropped it, so an F contract read as a bare "6 of 10" once opened.
// Two properties, both silent when broken:
//
//   1. THE LETTER IS THE SERVER'S. It comes from `risk_grade` (migration 112),
//      not from re-banding the fired count here; a second implementation of
//      contract_risk_grade_letter() would drift from the column the filter queries.
//   2. AN UNRECOGNISED LETTER MUST NOT THROW. `risk_grade` is a text column, and
//      indexing GRADE_TONE with anything outside A–F yields undefined — reading
//      `.chip` off it takes the whole contract page down.
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw); the header
// arms its detail fetch on hover only, so no request is issued by these renders.

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no fetch expected");
    }),
  );
});

/** 3 fired of 10 available — the shape of a D-graded contract. */
const result = contractRiskFromMasks({
  riskFiredMask: 0b0000_0000_1110,
  riskAvailableMask: 0b0011_1111_1111,
});

const renderHeader = (grade?: string | null) =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <RiskBadges result={result} variant="full" grade={grade} />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("RiskBadges grade badge", () => {
  it("renders the server's letter beside the fired count", () => {
    renderHeader("D");
    // The letter itself, and the count it is banded on, in one header.
    expect(screen.getByText("D")).toBeTruthy();
    expect(screen.getByText(/3\s+.*\s+10/)).toBeTruthy();
  });

  it("shows the whole band table in the badge's accessible name", () => {
    renderHeader("D");
    const badge = screen.getByText("D");
    const label = badge.getAttribute("aria-label") ?? "";
    // Names this contract's own numbers AND what the letter means, so the
    // letter is not an unexplained mark.
    expect(label).toContain("Risk grade D");
    expect(label).toContain("3 of 10");
    // Every placeholder resolved — a renamed one in the bundle shows through here.
    expect(label).not.toContain("{{");
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
});
