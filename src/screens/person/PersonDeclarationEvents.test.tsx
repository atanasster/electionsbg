// Component guard for the disposals / third-party-expenses block (audit T3.4). Two of
// these are correctness controls on claims about a named person:
//
//   · an UNPRICED row (0 in this corpus) must render a dash, never "€0" — printing €0
//     asserts the person transferred a property for nothing;
//   · the year column shows the period the register states, or the filing year — never a
//     computed "event year", which is only valid for annual filings.
//
// Hermetic: fetch stubbed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { DeclarationEventRow } from "./usePersonDeclarationEvents";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonDeclarationEvents } from "./PersonDeclarationEvents";

const row = (o: Partial<DeclarationEventRow> = {}): DeclarationEventRow => ({
  kind: "disposal_vehicle",
  year: 2025,
  fiscalYear: 2024,
  declarationType: "Annualy",
  institution: null,
  positionTitle: null,
  description: "лек автомобил",
  detail: "Mercedes Brabus",
  location: null,
  municipality: null,
  areaSqm: null,
  valueEur: 260000,
  legalBasis: "продажба",
  sourceUrl: "https://register.cacbg.bg/2025/a.xml",
  ...o,
});

const stub = (rows: DeclarationEventRow[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => rows }) as Response),
  );

afterEach(() => vi.unstubAllGlobals());

describe("PersonDeclarationEvents", () => {
  it("renders a priced disposal with its value and source", async () => {
    stub([row()]);
    render(<PersonDeclarationEvents slug="x" />);
    await waitFor(() =>
      expect(screen.getByText("pp_events_title")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Mercedes Brabus/)).toBeInTheDocument();
    expect(screen.getByText("pp_events_caveat")).toBeInTheDocument();
  });

  // An unpriced row must NOT read as "sold for nothing".
  it("renders a zero-valued row as a dash, never €0", async () => {
    stub([row({ valueEur: 0 })]);
    render(<PersonDeclarationEvents slug="x" />);
    await waitFor(() =>
      expect(screen.getByText("pp_events_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/€0(?!\d)/)).not.toBeInTheDocument();
  });

  it("renders a null-valued row as a dash", async () => {
    stub([row({ valueEur: null })]);
    render(<PersonDeclarationEvents slug="x" />);
    await waitFor(() =>
      expect(screen.getByText("pp_events_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // The register's stated period wins; with none, the FILING year is shown — the component
  // must never subtract one to invent an event year.
  it("shows the stated period, falling back to the filing year", async () => {
    stub([row({ year: 2023, fiscalYear: null })]);
    render(<PersonDeclarationEvents slug="x" />);
    await waitFor(() =>
      expect(screen.getByText("pp_events_title")).toBeInTheDocument(),
    );
    expect(screen.getByText("2023")).toBeInTheDocument();
    expect(screen.queryByText("2022")).not.toBeInTheDocument();
  });

  it("self-hides when the person has no such rows", async () => {
    stub([]);
    const { container } = render(<PersonDeclarationEvents slug="x" />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
