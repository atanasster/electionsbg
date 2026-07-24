// Component guard for the unified declaration block (audit T3.3). The subtle correctness
// point: when a person filed twice in one year (an annual + a при-напускане vacate), the
// HEADLINE must be the fuller filing (the vacate), matching the 090 wealth matview — a
// list-order pick would show the wrong net worth, disagreeing with the wealth chart on
// the same page (exactly the bug caught in the live preview for Демерджиев). Also: the
// block self-hides when no filing bears assets (the D2 empty-block case), and the caveat
// is mandatory. Hermetic: fetch stubbed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { DeclarationListItem } from "./usePersonDeclarations";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonDeclarations } from "./PersonDeclarations";

const filing = (
  o: Partial<DeclarationListItem> & { id: number },
): DeclarationListItem => ({
  tier: "exec",
  year: 2023,
  fiscalYear: null,
  type: "Annualy",
  institution: "МС",
  positionTitle: null,
  filedAt: null,
  sourceUrl: "https://register.cacbg.bg/2023/x.xml",
  assetsEur: 0,
  debtsEur: 0,
  netEur: 0,
  assetCount: 0,
  stakeCount: 0,
  eventCount: 0,
  ...o,
});

const stub = (rows: DeclarationListItem[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => rows }) as Response),
  );

afterEach(() => vi.unstubAllGlobals());

describe("PersonDeclarations", () => {
  it("headlines the first ASSET-BEARING row of the server's byRecency order", async () => {
    // person_declarations (090) sorts by byRecency, so the representative filing arrives
    // first. Here an assetless incompatibility filing leads the list (it IS the most
    // recent), and the vacate behind it is the wealth snapshot — the client must skip
    // the assetless one and headline the vacate, without re-sorting.
    stub([
      filing({ id: 30, year: 2025, type: "Other", assetCount: 0 }),
      filing({
        id: 10,
        type: "Vacate",
        assetsEur: 627497,
        debtsEur: 332304,
        netEur: 295193,
        assetCount: 25,
      }),
      filing({
        id: 20,
        type: "Annualy",
        assetsEur: 31404,
        debtsEur: 0,
        netEur: 31404,
        assetCount: 1,
      }),
    ]);
    render(<PersonDeclarations slug="mp-5104" />);
    await waitFor(() =>
      expect(screen.getByText("mp_section_assets")).toBeInTheDocument(),
    );
    // Net worth headline = 627497 − 332304 = €295k (the vacate). The assets headline is
    // €627k — a value that appears ONLY when the vacate is the headline (a list-order pick
    // would headline the annual, whose assets are €31k, and €627k would appear nowhere).
    expect(screen.getByText(/627/)).toBeInTheDocument();
    // 295 appears in both the headline card and the vacate's list row.
    expect(screen.getAllByText(/295/).length).toBeGreaterThan(0);
    // The caveat is mandatory.
    expect(screen.getByText("pp_wealth_caveat")).toBeInTheDocument();
    // The assetless incompatibility filing shows a dash, never "€0" (the D2 bug in
    // miniature — a €0 row reads as a collapse in declared wealth).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("self-hides when no filing bears assets (the D2 empty-block case)", async () => {
    stub([filing({ id: 1, type: "Other", assetCount: 0 })]);
    const { container } = render(<PersonDeclarations slug="x" />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("self-hides for a person with no declarations", async () => {
    stub([]);
    const { container } = render(<PersonDeclarations slug="x" />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
