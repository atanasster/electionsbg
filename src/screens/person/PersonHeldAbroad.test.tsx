// Component guard for the „Пари в чужбина" block on /person/:slug.
//
// Every test here is about a way the block could publish a claim the filing did not make.
// The corpus shape that makes each one live is in the comment above it; the numbers come
// from docs/plans/declaration-held-abroad-v1.md.
//
// Hermetic: no fetch, no database — the block is pure over the rows it is handed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DeclaredAsset } from "./assetRowText";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o?.countries ? `${k}:${o.countries}` : o?.count ? `${k}:${o.count}` : k,
    i18n: { language: "bg" },
  }),
}));

import { PersonHeldAbroad } from "./PersonHeldAbroad";

const row = (o: Partial<DeclaredAsset>): DeclaredAsset =>
  ({
    category: "bank",
    description: null,
    detail: null,
    location: null,
    municipality: null,
    areaSqm: null,
    acquiredYear: null,
    share: null,
    valueEur: null,
    holderName: null,
    isSpouse: false,
    currency: null,
    quantity: null,
    quantityUnit: null,
    isCrypto: false,
    tableNum: "5",
    isHolding: true,
    legalBasis: null,
    heldScope: null,
    heldCountry: null,
    ...o,
  }) as DeclaredAsset;

describe("PersonHeldAbroad", () => {
  // 95% of filings declare nothing abroad. The block must add no heading to any of them.
  it("renders nothing when the filing declares nothing abroad", () => {
    const { container } = render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "domestic", valueEur: 100 }),
          // A property row: the pair does not exist on its table at all, so heldScope is
          // NULL. NULL must not be read as anything.
          row({ category: "real_estate", heldScope: null, valueEur: 500 }),
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  // The whole point of the change: Иво Христов Петков's 228,100 EUR account is „Белгия"
  // at source and was byte-identical to his five domestic ones in every column we stored.
  it("shows an abroad row and names the country when the filing did", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "domestic", valueEur: 205 }),
          row({ heldScope: "abroad", heldCountry: "Белгия", valueEur: 228100 }),
        ]}
      />,
    );
    expect(screen.getByText("pp_decl_abroad")).toBeInTheDocument();
    expect(screen.getByText("Белгия")).toBeInTheDocument();
    // Twice, and that is the assertion: once as the block total and once on the row. The
    // total is the abroad rows ONLY, so the domestic 205 must not be folded into it —
    // 228 305 appearing anywhere would mean it was.
    expect(screen.getAllByText(/228[  ]?100/)).toHaveLength(2);
    expect(screen.queryByText(/228[  ]?305/)).not.toBeInTheDocument();
  });

  // ⚠️ THE DEFECT THIS BLOCK IS MOST LIKELY TO ACQUIRE. „да" in the „В чужбина" column
  // says abroad and names nowhere — corpus-wide that is 2,767 of 3,288 abroad rows, 88.4%
  // of them and 88.4% of the money. Keying the block on `heldCountry != null` would hide
  // almost all of it, so this asserts a country-less row still renders.
  it("shows an abroad row that names no country", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "abroad", heldCountry: null, valueEur: 50000 }),
        ]}
      />,
    );
    expect(screen.getByText("pp_decl_abroad")).toBeInTheDocument();
    // Block total + the row itself.
    expect(screen.getAllByText(/50[  ]?000/)).toHaveLength(2);
    // …and says WHY there is no country, rather than looking like a lookup we failed.
    expect(screen.getByText("pp_decl_abroad_note")).toBeInTheDocument();
  });

  it("lists the named countries once each when there are some", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "abroad", heldCountry: "Белгия", valueEur: 1 }),
          row({ heldScope: "abroad", heldCountry: "Белгия", valueEur: 2 }),
          row({ heldScope: "abroad", heldCountry: "Швейцария", valueEur: 3 }),
        ]}
      />,
    );
    expect(
      screen.getByText("pp_decl_abroad_note_where:Белгия, Швейцария"),
    ).toBeInTheDocument();
  });

  // „Not listed here" must not silently mean „in Bulgaria". A row whose two cells
  // contradict each other (both blank, both ticked, or one amount split across them) is
  // 'unknown' — 296 rows corpus-wide — and is counted rather than dropped, the same
  // principle as excludedAssetRows on the totals.
  it("counts an unresolved row instead of dropping it", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "abroad", valueEur: 10 }),
          row({ heldScope: "unknown", valueEur: 99999 }),
        ]}
      />,
    );
    expect(screen.getByText("pp_decl_abroad_unresolved:1")).toBeInTheDocument();
    // …and is NOT added to the abroad total, which would assert it is foreign.
    expect(screen.queryByText(/100[  ]?009/)).not.toBeInTheDocument();
  });

  // ⚠️ declaration_id 30124 (Маргарита Димова Бурлакова, 2024) is this shape live: one
  // abroad bank row with no euro figure. `valueEur ?? 0` published „€0" — a number the
  // filing does not state, while the row beneath it correctly showed „—". One filing is
  // that shape today and the class is permanent (8 rows remain unvalued as declared
  // residue), so this is a recurring ingest hazard, not a one-off.
  it("does not publish a €0 total when no abroad row is valued", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[row({ heldScope: "abroad", valueEur: null })]}
      />,
    );
    expect(screen.getByText("pp_decl_abroad")).toBeInTheDocument();
    expect(screen.queryByText(/€\s*0|0\s*€/)).not.toBeInTheDocument();
    // …and the omission is COUNTED rather than silently absorbed.
    expect(screen.getByText("pp_decl_abroad_unvalued:1")).toBeInTheDocument();
  });

  // A partly-valued filing still totals the rows it CAN value, and still says how many it
  // could not — the total must not vanish just because one row is unvalued.
  it("totals the valued rows and counts the rest", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "abroad", valueEur: 1000 }),
          row({ heldScope: "abroad", valueEur: null }),
        ]}
      />,
    );
    expect(screen.getAllByText(/1[  ]?000/).length).toBeGreaterThan(0);
    expect(screen.getByText("pp_decl_abroad_unvalued:1")).toBeInTheDocument();
  });

  // 089 carries no CHECK on held_scope on purpose, so a value a future parser adds must
  // land in the counted residue rather than render nowhere and be counted nowhere —
  // which would leave the filing looking like a clean domestic sheet.
  it("counts a scope value outside the three rather than dropping it", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[
          row({ heldScope: "offshore" as unknown as "unknown", valueEur: 5 }),
        ]}
      />,
    );
    expect(
      screen.getByText("pp_decl_abroad_unresolved_only:1"),
    ).toBeInTheDocument();
  });

  // A filing whose ONLY foreign-looking row was unreadable must still say so, rather than
  // rendering as a clean domestic sheet.
  it("mounts for an unresolved row even with nothing confirmed abroad", () => {
    render(
      <PersonHeldAbroad
        locale="bg-BG"
        assets={[row({ heldScope: "unknown" })]}
      />,
    );
    // The STANDALONE key: with no abroad row above it, „Още N записа" would refer to a list
    // that is not there. Which key fires is pinned by the two tests below.
    expect(
      screen.getByText("pp_decl_abroad_unresolved_only:1"),
    ).toBeInTheDocument();
  });
});
