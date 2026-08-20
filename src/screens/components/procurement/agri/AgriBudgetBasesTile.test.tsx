// The reconciliation guard, and the „do not add these" copy.
//
// ⚠ WHY THIS IS FIXTURE-BASED AND NOT READ OFF THE REAL FILES. `data/budget/
// ministries/` is GITIGNORED (bulky regenerable shards, bucket-shipped only), so a
// test importing the two nodes would pass on this machine and fail on every fresh
// clone. That is also precisely why `reconcilingPrograms` guards at RUNTIME rather
// than leaning on a build-time assertion: the only place the real split can be
// checked is the moment it is about to be drawn.
//
// The measured shapes the fixtures stand in for (2026): the MINISTRY's four
// programmes sum to its expenditure exactly (158.04 + 24.26 + 12.84 + 5.19 =
// €200.33M); the PAYER's two sum to €18.99M against a €300.92M line, because most of
// its budget is money it disburses. Rendering the second would put a split
// accounting for 6% of its own header on the page — audit Failure mode I.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import bgDict from "@/locales/bg/translation.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: "bg" };
    },
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

type Node = {
  years: {
    fiscalYear: number;
    expenditure: { amountEur: number };
    expenditureLaw?: { amountEur: number };
    programs?: { nameBg: string; planned: { amountEur: number } }[];
  }[];
};

const MINISTRY_RECONCILING: Node = {
  years: [
    {
      fiscalYear: 2026,
      expenditure: { amountEur: 200_331_600 },
      programs: [
        { nameBg: "Земеделие и селски райони", planned: { amountEur: 158_038_700 } }, // prettier-ignore
        { nameBg: "Гори и дивеч", planned: { amountEur: 24_255_200 } },
        { nameBg: "Администрация", planned: { amountEur: 12_844_200 } },
        {
          nameBg: "Рибарство и аквакултури",
          planned: { amountEur: 5_193_500 },
        },
      ],
    },
  ],
};

// The payer's real shape, with its real programme NAMES — deliberately distinct from
// the ministry's above, so the „never renders the payer's split" test discriminates
// instead of colliding on a shared label. Two programmes totalling €18.99M against a
// €300.92M header (6.3%).
const PAYER: Node = {
  years: [
    {
      fiscalYear: 2026,
      expenditure: { amountEur: 300_917_500 },
      programs: [
        { nameBg: "Бюджетна програма „Администрация“ (ДФЗ)", planned: { amountEur: 18_532_900 } }, // prettier-ignore
        { nameBg: "Политика на МЗХ в областта на земеделието и селските райони", planned: { amountEur: 456_400 } }, // prettier-ignore
      ],
    },
  ],
};

const nodes: Record<string, Node> = {
  "admin-darzhaven-fond-zemedelie": PAYER,
  "admin-ministerstvo-na-zemedelieto-i-hranite": MINISTRY_RECONCILING,
};

vi.mock("@/data/budget/useBudget", () => ({
  useBudgetMinistryRollup: (nodeId: string) => ({ data: nodes[nodeId] }),
}));

const { AgriBudgetBasesTile } = await import("./AgriBudgetBasesTile");

const at = (
  payoutEur: number | null = 1_586_940_416,
  payoutLabel: string | null = "2025",
) =>
  render(
    <AgriBudgetBasesTile payoutEur={payoutEur} payoutLabel={payoutLabel} />,
  );

describe("AgriBudgetBasesTile", () => {
  it("shows all three bases, each with its own year", () => {
    at();
    expect(screen.getByText("Изплатено от ДФЗ")).toBeInTheDocument();
    expect(screen.getByText("Бюджет на ДФЗ")).toBeInTheDocument();
    expect(screen.getByText("Бюджет на МЗХ")).toBeInTheDocument();
    // The years genuinely differ (a closed CAP year vs the enacted law), so each
    // column carries its own rather than the row implying one moment.
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getAllByText("2026")).toHaveLength(2);
  });

  it("says in words that the three do not add up", () => {
    at();
    expect(screen.getByText(/НЕ се събират/)).toBeInTheDocument();
  });

  it("does NOT claim the three are disjoint, and names the overlap", () => {
    at();
    // „нито едно не е дял от друго" shipped here and is not derivable from the
    // source: the national aid the fund pays out is inside the payout column, and
    // nothing here shows which budget line funds it. Asserting either „separate" or
    // „a subset" would be inventing a fact.
    expect(screen.queryByText(/нито едно не е дял от друго/)).not.toBeInTheDocument(); // prettier-ignore
    expect(screen.getByText(/Не са и напълно отделни/)).toBeInTheDocument();
  });

  it("does not call the whole payout European money", () => {
    // Measured on 2025: €125,701,698 (7.92%) is national — акциз газьол, ПНДТ,
    // ПНДЖ, де минимис. „САР" is right for most of it and wrong for all of it.
    at();
    expect(screen.getByText(/не всичко: преходната национална помощ/)).toBeInTheDocument(); // prettier-ignore
    expect(screen.queryByText(/^Европейски пари, изплатени/)).not.toBeInTheDocument(); // prettier-ignore
  });

  it("says the payer's line is mostly not the fund's own running costs", () => {
    at();
    // Without this the €300.9M reads as the cost of running the agency, which is
    // ~16× the truth (its administration programme is €18.5M). The claim stops at
    // what the source shows: it does NOT name what the remainder is.
    expect(
      screen.getByText(/източникът не разбива остатъка/),
    ).toBeInTheDocument();
  });

  it("renders the ministry's split, which reconciles", () => {
    at();
    expect(screen.getByText(/Бюджетът на МЗХ по политики \(2026\)/)).toBeInTheDocument(); // prettier-ignore
    expect(screen.getByText("Гори и дивеч")).toBeInTheDocument();
    expect(screen.getByText("Рибарство и аквакултури")).toBeInTheDocument();
  });

  it("never renders the payer's split, which does not reconcile", () => {
    // ⚠ THIS TEST WAS VACUOUS ONCE: it asserted the absence of „Бюджетът на ДФЗ по
    // политики", a string NO code path can emit — the tile only ever builds a
    // ministry heading — so it passed with the guard deleted. It now asserts on the
    // payer's own programme NAMES, which the tile would really print if it ever
    // started drawing that split, and pins the count of split headings at one.
    at();
    for (const name of PAYER.years[0].programs!.map((x) => x.nameBg))
      expect(screen.queryByText(name), name).not.toBeInTheDocument();
    // …and exactly one split heading on the tile, so the payer cannot grow a second.
    expect(screen.getAllByText(/по политики/)).toHaveLength(1);
  });

  it("drops a non-reconciling ministry split rather than drawing it", () => {
    // The guard, not the fixture: if the ministry's own programmes stop summing —
    // a new unallocated line, a source change — the split must disappear, not
    // silently misrepresent the header.
    const good = nodes["admin-ministerstvo-na-zemedelieto-i-hranite"];
    nodes["admin-ministerstvo-na-zemedelieto-i-hranite"] = {
      years: [
        {
          ...good.years[0],
          programs: good.years[0].programs!.slice(0, 2), // 182.3M vs a 200.3M header
        },
      ],
    };
    at();
    expect(screen.queryByText(/по политики/)).not.toBeInTheDocument();
    // …and the three headline columns survive: the guard drops the breakdown, not
    // the tile.
    expect(screen.getByText("Бюджет на МЗХ")).toBeInTheDocument();
    nodes["admin-ministerstvo-na-zemedelieto-i-hranite"] = good;
  });

  it("omits the payout column while the payload is loading, never a zero", () => {
    at(null, null);
    expect(screen.queryByText("Изплатено от ДФЗ")).not.toBeInTheDocument();
    expect(screen.getByText("Бюджет на ДФЗ")).toBeInTheDocument();
  });

  it("keeps the payout column on the `all` scope, which has NO year", () => {
    // `scopeYear` is NULL by design for `all` (migration 162), one click away, and
    // where the payout is €11.04bn — its largest value. Gating the column on a year
    // dropped the biggest figure on the tile and left two boxes under a heading
    // promising three.
    at(11_037_181_927, "всички години");
    expect(screen.getByText("Изплатено от ДФЗ")).toBeInTheDocument();
    expect(screen.getByText("всички години")).toBeInTheDocument();
  });

  it("reconciles the split against the PRINTED figure, not `expenditure`", () => {
    // The header prints `expenditureLaw ?? expenditure`. The corpus has a
    // ministry-year where those differ by 72.8% (МОСВ 2024) with the programmes
    // summing to the LAW figure — so a guard keyed on `expenditure` would refuse a
    // split that does reconcile with what is on screen.
    const good = nodes["admin-ministerstvo-na-zemedelieto-i-hranite"];
    nodes["admin-ministerstvo-na-zemedelieto-i-hranite"] = {
      years: [
        {
          ...good.years[0],
          expenditure: { amountEur: 111_111_111 },
          expenditureLaw: { amountEur: 200_331_600 },
        },
      ],
    };
    at();
    expect(screen.getByText(/по политики/)).toBeInTheDocument();
    nodes["admin-ministerstvo-na-zemedelieto-i-hranite"] = good;
  });
});
