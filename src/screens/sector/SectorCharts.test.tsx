// The „Топ изпълнители" leaderboard is where a sector says who its money went
// to, and it is the one tile that can be right to the euro and false as a
// sentence. Two contractor classes must be labelled rather than silently
// rendered as market vendors:
//
//   „в групата"  the contractor is one of the sector's OWN members;
//   „държавно"   the contractor is a state or municipal body OUTSIDE the sector.
//
// Both were live defects. /sector/administration's #1 „изпълнител" is
// „Информационно обслужване" АД at 25.7% of the sector's all-time money — a
// company whose принципал is the very ministry that leads the sector — and it
// rendered bare, while /sector/social already labelled the same EIK. A reader
// must not meet one company labelled on one page and unlabelled on another.
//
// Neither class is ever FILTERED OUT: excluding a legitimate public contract to
// make a chart look more like a market turns an honest page into a false one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SectorTopContractorsTile } from "./SectorCharts";
import type { AwarderModel } from "@/lib/awarderModel";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

beforeEach(() => {
  lang = "bg";
});

const supplier = (eik: string, name: string, totalEur: number) => ({
  eik,
  name,
  totalEur,
  contractCount: 3,
  category: "all" as const,
  singleBidShare: null,
  bidKnownN: 0,
});

const MEMBER = "180680495";
const STATE_BODY = "831641791";
const PRIVATE = "131468980";
const CARRIER = "obed-369bc7450c81"; // a real e-gov consortium carrier key

const model: AwarderModel<"all"> = {
  supplierCount: 3,
  categories: [],
  suppliers: [
    supplier(STATE_BODY, "Информационно обслужване АД", 800),
    supplier(PRIVATE, "А1 България ЕАД", 500),
    supplier(MEMBER, "Министерство на електронното управление", 200),
  ],
  years: [],
  minYear: null,
  maxYear: null,
  totalEur: 1500,
  contractCount: 9,
  bidKnownN: 0,
  singleBidN: 0,
  singleBidShare: null,
  directEur: 0,
  directShare: 0,
};

const renderTile = (opts?: {
  memberEiks?: readonly string[];
  stateBodyEiks?: readonly string[];
}) =>
  render(
    <MemoryRouter>
      <SectorTopContractorsTile
        model={model}
        memberEiks={opts?.memberEiks}
        stateBodyEiks={opts?.stateBodyEiks}
      />
    </MemoryRouter>,
  );

/** The tile slices `suppliers` to 8, so „is the carrier visible" is a property of
 *  WHERE it sits, not of whether it exists. `at` places the one carrier row at a
 *  given index in an otherwise carrier-free list. */
const renderWithCarrierAt = (at: number, total = 9) => {
  const suppliers = Array.from({ length: total }, (_, i) =>
    i === at
      ? supplier(CARRIER, "Обединение: А1 България ЕАД, Контракс АД", 1000 - i)
      : supplier(`10000000${i}`, `Фирма ${i}`, 1000 - i),
  );
  return render(
    <MemoryRouter>
      <SectorTopContractorsTile model={{ ...model, suppliers }} />
    </MemoryRouter>,
  );
};

describe("SectorTopContractorsTile — labelling non-market contractors", () => {
  it("labels a public-body contractor and explains why in the note", () => {
    renderTile({ stateBodyEiks: [STATE_BODY] });
    expect(screen.getByText("държавно")).toBeInTheDocument();
    expect(screen.getByText(/остават вътре в държавата/)).toBeInTheDocument();
  });

  it("still lists the labelled contractor — labelling is not filtering", () => {
    renderTile({ stateBodyEiks: [STATE_BODY] });
    expect(screen.getByText("Информационно обслужване АД")).toBeInTheDocument();
    expect(screen.getByText("А1 България ЕАД")).toBeInTheDocument();
  });

  // „в групата" is the more specific claim, so an EIK in both sets must not
  // collect two chips saying nearly the same thing.
  it("a member wins the in-group chip and gets no state-body chip", () => {
    renderTile({ memberEiks: [MEMBER], stateBodyEiks: [MEMBER, STATE_BODY] });
    expect(screen.getByText("в групата")).toBeInTheDocument();
    expect(screen.getAllByText("държавно")).toHaveLength(1);
  });

  // The gate is `rows.some(...)` over the top-8 slice, not `stateBodyEiks.length`.
  // A listed EIK outside the visible rows must not produce a footnote explaining
  // a chip nobody can see — and the prop-based version passes every other test.
  it("does not explain a chip that is not on screen", () => {
    renderTile({ stateBodyEiks: ["999999999"] });
    expect(screen.queryByText("държавно")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/остават вътре в държавата/),
    ).not.toBeInTheDocument();
  });

  it("associates each chip with the note that explains it", () => {
    renderTile({ stateBodyEiks: [STATE_BODY] });
    const chip = screen.getByText("държавно");
    const noteId = chip.getAttribute("aria-describedby");
    expect(noteId).toBe("sector-topcontractors-statebody-note");
    expect(document.getElementById(noteId!)).toBeInTheDocument();
  });

  it("labels nothing when the caller passes neither set", () => {
    renderTile();
    expect(screen.queryByText("държавно")).not.toBeInTheDocument();
    expect(screen.queryByText("в групата")).not.toBeInTheDocument();
  });

  // A caption cannot be checked in one language — the sibling ВиК tile shipped a
  // Bulgarian correction while the English text kept asserting the old thing.
  it("carries the same labels and note in English", () => {
    lang = "en";
    renderTile({ stateBodyEiks: [STATE_BODY] });
    expect(screen.getByText("state body")).toBeInTheDocument();
    expect(screen.getByText(/stays inside government/)).toBeInTheDocument();
  });
});

describe("SectorTopContractorsTile — consortium carriers", () => {
  // The euros are right and are NOT double-counted (one carrier per consortium).
  // What the note fixes is the SENTENCE: a member firm can also hold its own row,
  // so the ranking understates whoever competes mainly through consortia.
  it("explains a consortium row that is on screen", () => {
    renderWithCarrierAt(0);
    expect(screen.getByText(/подценява фирмите/)).toBeInTheDocument();
  });

  // Same visible-rows gate as the other two notes, and the one a `suppliers.some`
  // over the WHOLE list would fail: the tile renders 8 rows, so a carrier at
  // index 8 is real, counted, and invisible — explaining it describes nothing.
  it("does not explain a consortium row below the top-8", () => {
    renderWithCarrierAt(8);
    expect(screen.queryByText(/подценява фирмите/)).not.toBeInTheDocument();
  });

  it("says nothing when no row is a consortium", () => {
    renderTile({ stateBodyEiks: [STATE_BODY] });
    expect(screen.queryByText(/подценява фирмите/)).not.toBeInTheDocument();
  });

  // The row must stay listed and keep its full value — filtering a legitimate
  // consortium award to make the chart look more like a market is the one
  // response that turns an honest page into a false one.
  it("still lists the consortium row — the note is not a filter", () => {
    renderWithCarrierAt(0);
    expect(
      screen.getByText("Обединение: А1 България ЕАД, Контракс АД"),
    ).toBeInTheDocument();
  });

  it("associates the consortium row with the note that explains it", () => {
    renderWithCarrierAt(0);
    const row = screen.getByTitle("Обединение: А1 България ЕАД, Контракс АД");
    expect(row.getAttribute("aria-describedby")).toBe(
      "sector-topcontractors-consortium-note",
    );
    expect(
      document.getElementById("sector-topcontractors-consortium-note"),
    ).toBeInTheDocument();
  });

  it("carries the note in English too", () => {
    lang = "en";
    renderWithCarrierAt(0);
    expect(screen.getByText(/understates firms/)).toBeInTheDocument();
  });
});
