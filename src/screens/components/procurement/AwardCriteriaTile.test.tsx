// Component guard for the award-criterion tile.
//
// What it locks is the "not stated" band. The field does not exist before 2020
// and is ~0.1–0.3% blank after it, so the honest rendering keeps those rows
// VISIBLE as their own segment rather than dropping them or spreading them over
// the stated criteria. A tile that silently renormalised to the stated rows
// would show a MEAT share that is arithmetically right and false as a sentence.
//
// It also locks the null case: the route degrades a missing migration 164 to
// null, and the tile must then render nothing at all — an empty chart would read
// as "no criterion is ever recorded".
//
// Hermetic: `t` returns the key, the data hook is mocked, fetch is never
// reached (vitest.setup throws on an unstubbed one).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AwardCriteriaFile } from "@/data/procurement/useAwardCriteria";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

const hookData: { current: AwardCriteriaFile | null } = { current: null };
vi.mock("@/data/procurement/useAwardCriteria", () => ({
  useAwardCriteria: () => ({
    data: hookData.current,
    isLoading: false,
    isError: false,
  }),
  AWARD_CRITERION_BUCKETS: [
    "meat",
    "lcc",
    "combined",
    "price",
    "other",
    "unknown",
  ],
}));

import { AwardCriteriaTile } from "./AwardCriteriaTile";

const file = (over: Partial<AwardCriteriaFile> = {}): AwardCriteriaFile => ({
  firstYear: "2020",
  coverage: {
    total: 1000,
    competitive: 800,
    noCall: 200,
    preCriterionTenders: 400,
  },
  byYear: [
    {
      year: "2020",
      total: 100,
      price: 60,
      meat: 25,
      lcc: 5,
      combined: 2,
      other: 0,
      unknown: 8,
      estimatedEur: 1234,
    },
  ],
  byType: [
    {
      contractType: "works",
      total: 50,
      price: 20,
      meat: 28,
      lcc: 1,
      combined: 1,
      other: 0,
      unknown: 0,
    },
  ],
  ...over,
});

describe("AwardCriteriaTile", () => {
  it("renders nothing when the migration has not reached this database", () => {
    hookData.current = null;
    const { container } = render(<AwardCriteriaTile />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the not-stated rows as their own visible band", () => {
    hookData.current = file();
    render(<AwardCriteriaTile />);
    // The segment carries its count and share in the title attribute; 8 of 100.
    const band = document.querySelector('[title^="award_crit_unknown"]');
    expect(band).not.toBeNull();
    expect(band?.getAttribute("title")).toContain("8");
    // …and it is drawn at its true width, not renormalised away.
    expect((band as HTMLElement).style.width).toBe("8%");
  });

  it("reports the MEAT share against the FULL total, blanks included", () => {
    hookData.current = file();
    render(<AwardCriteriaTile />);
    // 25/100 = 25%, not 25/92 = 27.2% — the blank rows stay in the denominator.
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("renders the coverage note that names the gap and the exclusions", () => {
    hookData.current = file();
    render(<AwardCriteriaTile />);
    // With `t` stubbed to echo the key there is no {{year}} placeholder to fill,
    // so assert the note is present by key. The substitution itself is exercised
    // against the real strings by the i18n placeholder check below.
    expect(screen.getByText("award_crit_note")).toBeInTheDocument();
  });

  it("the real note string carries every placeholder the tile substitutes", async () => {
    // Guards the other half: the component replaces {{year}}, {{n}} and {{nc}},
    // so a translation that drops one would render a literal placeholder to
    // users — invisible to the stubbed-`t` tests above.
    //
    // BG only, deliberately: src/locales/parity.test.ts already asserts bg↔en
    // interpolate the SAME variables, so checking one bundle here covers both.
    // Do not "fix" this by trusting only the local test — the pair is what makes
    // it sufficient.
    const bg = (
      await import("@/locales/bg/translation.json", {
        with: { type: "json" },
      })
    ).default as Record<string, string>;
    for (const token of ["{{year}}", "{{n}}", "{{nc}}"]) {
      expect(bg.award_crit_note).toContain(token);
    }
  });

  it("renders the by-type block with mapped labels", () => {
    hookData.current = file();
    render(<AwardCriteriaTile />);
    expect(screen.getByText("award_crit_by_type")).toBeInTheDocument();
    expect(screen.getByText("award_crit_type_works")).toBeInTheDocument();
  });

  it("degrades an unrecognised contract type to the 'unspecified' label", () => {
    // The server emits goods|services|works today. If it ever emitted something
    // else, every such row would silently collapse to one bucket — worth
    // knowing that is the behaviour rather than discovering it on the page.
    hookData.current = file({
      byType: [
        {
          contractType: "concession",
          total: 10,
          price: 4,
          meat: 5,
          lcc: 0,
          combined: 1,
          other: 0,
          unknown: 0,
        },
      ],
    });
    render(<AwardCriteriaTile />);
    expect(screen.getByText("award_crit_type_other")).toBeInTheDocument();
  });

  it("names the gap instead of vanishing when the scope predates the field", () => {
    // ?pscope=y:2018 yields no years. The repo convention (/subsidies) is to
    // keep the scope and say why it is empty, not to disappear.
    hookData.current = file({ byYear: [] });
    render(<AwardCriteriaTile />);
    expect(screen.getByText("award_crit_no_years")).toBeInTheDocument();
  });

  it("drops the pre-2020 clause when the window contains no such tenders", () => {
    // Every recent parliament scope returns preCriterionTenders: 0, where the
    // long sentence reads as boilerplate.
    hookData.current = file({
      coverage: {
        total: 100,
        competitive: 100,
        noCall: 5,
        preCriterionTenders: 0,
      },
    });
    render(<AwardCriteriaTile />);
    expect(screen.getByText("award_crit_note_short")).toBeInTheDocument();
    expect(screen.queryByText("award_crit_note")).toBeNull();
  });

  it("omits a zero-width segment entirely", () => {
    hookData.current = file();
    render(<AwardCriteriaTile />);
    // `other` is 0 in the fixture and must not render a 0%-wide div.
    expect(document.querySelector('[title^="award_crit_other"]')).toBeNull();
  });
});
