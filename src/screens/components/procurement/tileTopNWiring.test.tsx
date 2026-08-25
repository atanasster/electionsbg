// `TileTopNNote`'s own tests pass over the component in ISOLATION — and every defect the
// review found was in the WIRING: which count each tile hands it, and whether that count
// describes the rows the tile actually renders. A perfect component fed the wrong number
// is exactly what shipped (`contractCount` = 4 beside 25 rendered rows, note silent).
//
// So this file drives each tile with a rollup whose totals and arrays disagree the way
// the real payloads do, and asserts what a reader sees.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { n?: number }) =>
      k === "pp_breakdown_top_n"
        ? `Топ ${o?.n}`
        : k === "procurement_tile_see_all"
          ? "Виж всички"
          : k,
    i18n: { language: "bg" },
  }),
}));

import type {
  ProcurementContractorRollup,
  ProcurementRollupContractRow,
} from "@/data/dataTypes";
import { CompanyTopContractsTile } from "./CompanyTopContractsTile";
import { CompanyTopAwardersTile } from "./CompanyTopAwardersTile";

const contract = (i: number): ProcurementRollupContractRow => ({
  key: `k${i}`,
  ocid: `ocid-${i}`,
  date: "2024-01-01",
  amountEur: 1000 - i,
  partyEik: "000695089",
  partyName: "АПИ",
  bundleUuid: `b${i}`,
  sourceUrl: `https://example.invalid/${i}`,
  title: `Договор ${i}`,
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** The fields both tiles require, so each test states only the counts it is ABOUT. Typed
 *  through the real rollup so a schema change breaks this file rather than letting it
 *  drift into asserting a shape production no longer sends. */
const base = (
  over: Partial<ProcurementContractorRollup>,
): ProcurementContractorRollup => ({
  eik: "1",
  name: "АКМЕ",
  totalEur: 1000,
  totalOther: {},
  contractCount: 0,
  awardCount: 0,
  byAwarder: [],
  byYear: [],
  topContracts: [],
  generatedAt: "2026-01-01",
  ...over,
});

describe("CompanyTopContractsTile wiring", () => {
  it("still links when contractCount is SMALLER than the rows it renders", () => {
    // The shipped regression. `contractCount` excludes the €0 consortium-member rows
    // that `topContracts` includes AND renders, so `total < shown` is reachable —
    // measured on 146 entities, e.g. /company/206773326 ships 25 rows against a
    // contractCount of 4. Wired as a denominator that hid the link entirely.
    wrap(
      <CompanyTopContractsTile
        eik="206773326"
        rollup={base({
          topContracts: Array.from({ length: 25 }, (_, i) => contract(i)),
          contractCount: 4,
        })}
        seeAllHref="/company/206773326/contracts"
      />,
    );
    const link = screen.getByRole("link", { name: /Виж всички/ });
    expect(link).toHaveAttribute("href", "/company/206773326/contracts");
    // ...and it must NOT publish the wrong number.
    expect(link.textContent).not.toContain("4");
  });

  it("says nothing when the rendered rows ARE everything", () => {
    // The other half: before this the link rendered whenever a href existed, so three
    // contracts got „Виж всички →" to a page holding the same three.
    wrap(
      <CompanyTopContractsTile
        eik="1"
        rollup={base({
          topContracts: [contract(1), contract(2), contract(3)],
          contractCount: 3,
        })}
        seeAllHref="/company/1/contracts"
      />,
    );
    expect(screen.queryByRole("link", { name: /Виж всички/ })).toBeNull();
  });

  it("links when the corpus count exceeds what is rendered", () => {
    wrap(
      <CompanyTopContractsTile
        eik="1"
        rollup={base({
          topContracts: [contract(1), contract(2)],
          contractCount: 90,
        })}
        seeAllHref="/company/1/contracts"
      />,
    );
    expect(
      screen.getByRole("link", { name: /Виж всички/ }),
    ).toBeInTheDocument();
  });
});

const awarder = (i: number) => ({
  eik: `awd${i}`,
  name: `Възложител ${i}`,
  totalEur: 1000 - i,
  totalOther: {},
  contractCount: 2,
});

describe("CompanyTopAwardersTile wiring", () => {
  it("discloses the cap as a chip when there is NO page to link to", () => {
    // The person page passes `seeAllHref={null}` because no per-person awarders route
    // exists. Before this the tile then said NOTHING — measured live, 10 of 270.
    wrap(
      <CompanyTopAwardersTile
        eik=""
        rollup={base({
          byAwarder: Array.from({ length: 10 }, (_, i) => awarder(i)),
          awarderCount: 270,
        })}
        seeAllHref={null}
      />,
    );
    expect(screen.queryByRole("link", { name: /Виж всички/ })).toBeNull();
    expect(screen.getByText(/Топ 10 \/ 270/)).toBeInTheDocument();
  });

  it("reads awarderCount, not the already-truncated array", () => {
    // `byAwarder` is a server-side slice, so using its length would report „10 / 10" on
    // a company with 270 awarders — the cap presented as the complete list.
    wrap(
      <CompanyTopAwardersTile
        eik=""
        rollup={base({
          byAwarder: Array.from({ length: 10 }, (_, i) => awarder(i)),
          awarderCount: 270,
        })}
        seeAllHref={null}
      />,
    );
    expect(screen.queryByText(/Топ 10 \/ 10/)).toBeNull();
  });

  it("says nothing when the awarder list is complete", () => {
    wrap(
      <CompanyTopAwardersTile
        eik=""
        rollup={base({ byAwarder: [awarder(1)], awarderCount: 1 })}
        seeAllHref={null}
      />,
    );
    expect(screen.queryByText(/Топ 1/)).toBeNull();
  });
});
