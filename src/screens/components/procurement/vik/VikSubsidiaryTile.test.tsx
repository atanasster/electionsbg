// Gate for the one claim this tile makes that it can get WRONG about a named
// legal entity: whether the operators it lists are companies in Български ВиК
// холдинг.
//
// The tile is fed TWO universes — the holding group on /awarder/206086428, and
// the whole water sector on /water and /procurement/contracts?sector=water — and
// until 2026-08-13 it rendered both under "Дружествата в групата". So the sector
// view asserted that Софийска вода (a Veolia concession the reference data says
// in capitals is never a subsidiary) and ДП „Управление и стопанисване на
// язовири" (a dam enterprise) belonged to the holding.
//
// Two things are worth pinning, and BOTH IN BOTH LANGUAGES. The sibling HHI
// tile's Bulgarian caption was corrected while its English one kept saying "the
// group's contracted value" for a commit, because every assertion here was
// Bulgarian-only — a page can assert holding membership over a concession in one
// language and not the other, and a single-language test cannot see it.
//
//   1. The framing is DERIVED, so a caller cannot assert the wrong one.
//   2. It derives from the universe the caller AGGREGATED, not from the rows that
//      survived the scope window — otherwise a narrow ?pscope in which only
//      holding members traded silently flips /water back to the group claim.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VikSubsidiaryTile } from "./VikSubsidiaryTile";
import {
  VIK_HOLDING_EIK,
  VIK_HOLDING_SUB_EIKS,
  WATER_SECTOR_EIKS,
  SOFIYSKA_VODA_EIK,
  NAPOITELNI_EIK,
  USYA_EIK,
} from "@/lib/vikReferenceData";
import type { VikOperatorAgg } from "@/data/procurement/useVik";

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

const row = (eik: string, totalEur: number): VikOperatorAgg => ({
  eik,
  name: `оператор ${eik}`,
  oblast: "",
  totalEur,
  contractCount: 3,
  singleBidShare: null,
  bidKnownN: 0,
});

const renderTile = (
  operators: VikOperatorAgg[],
  universeEiks?: readonly string[],
) =>
  render(
    <MemoryRouter>
      <VikSubsidiaryTile operators={operators} universeEiks={universeEiks} />
    </MemoryRouter>,
  );

// Both languages' wording for "these rows are companies in the holding group".
const GROUP_CLAIM = { bg: /в групата/, en: /in the group/ };
const SECTOR_CLAIM = { bg: /във водния сектор/, en: /in the water sector/ };

const HOLDING_ONLY = [VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS];

describe.each(["bg", "en"])("VikSubsidiaryTile framing — %s", (l) => {
  const group = GROUP_CLAIM[l as "bg" | "en"];
  const sector = SECTOR_CLAIM[l as "bg" | "en"];
  const setLang = () => {
    lang = l;
  };

  it("claims group membership when the aggregated universe IS the holding", () => {
    setLang();
    renderTile(
      [
        row(VIK_HOLDING_EIK, 900),
        row(VIK_HOLDING_SUB_EIKS[0], 500),
        row(VIK_HOLDING_SUB_EIKS[1], 300),
      ],
      HOLDING_ONLY,
    );
    expect(screen.getAllByText(group).length).toBeGreaterThan(0);
    expect(screen.queryByText(sector)).toBeNull();
  });

  it("drops the group claim as soon as the universe includes the concession", () => {
    setLang();
    renderTile(
      [row(VIK_HOLDING_SUB_EIKS[0], 500), row(SOFIYSKA_VODA_EIK, 900)],
      WATER_SECTOR_EIKS,
    );
    expect(screen.queryByText(group)).toBeNull();
    expect(screen.getAllByText(sector).length).toBeGreaterThan(0);
  });

  it("keeps the sector framing when the SCOPE leaves only holding rows visible", () => {
    setLang();
    // The window hid every non-holding operator — /water under a narrow ?pscope,
    // or the y:2020 corpus-gap year. The page is still the sector, so the tile
    // must not quietly re-attribute those rows to the holding.
    renderTile(
      [row(VIK_HOLDING_SUB_EIKS[0], 500), row(VIK_HOLDING_SUB_EIKS[1], 300)],
      WATER_SECTOR_EIKS,
    );
    expect(screen.queryByText(group)).toBeNull();
    expect(screen.getAllByText(sector).length).toBeGreaterThan(0);
  });

  it("falls back to the rows when no universe is declared", () => {
    setLang();
    renderTile([row(VIK_HOLDING_SUB_EIKS[0], 500), row(USYA_EIK, 200)]);
    expect(screen.queryByText(group)).toBeNull();
  });
});

describe("VikSubsidiaryTile — links and thresholds", () => {
  it("links the holding row in the sector view, where it is not the current page", () => {
    lang = "bg";
    const { container } = renderTile(
      [row(VIK_HOLDING_EIK, 900), row(NAPOITELNI_EIK, 500)],
      WATER_SECTOR_EIKS,
    );
    const links = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links.some((h) => h?.includes(VIK_HOLDING_EIK))).toBe(true);
  });

  it("does NOT link the holding row on the holding's own page", () => {
    lang = "bg";
    const { container } = renderTile(
      [row(VIK_HOLDING_EIK, 900), row(VIK_HOLDING_SUB_EIKS[0], 500)],
      HOLDING_ONLY,
    );
    const links = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(links.some((h) => h?.includes(VIK_HOLDING_EIK))).toBe(false);
  });

  it("renders nothing below two operators, so a single row cannot claim a group", () => {
    lang = "bg";
    const { container } = renderTile([row(SOFIYSKA_VODA_EIK, 900)]);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the overflow with the same noun the framing chose", () => {
    lang = "bg";
    // 14 rows, TOP_N = 12 → "+ още 2 оператора" in the sector view. The tail
    // there holds ДП УСЯ and Напоителни, which are not дружества in a holding.
    const many = WATER_SECTOR_EIKS.slice(0, 14).map((e, i) => row(e, 100 - i));
    const { container } = renderTile(many, WATER_SECTOR_EIKS);
    expect(within(container).getByText(/\+ още 2 оператора/)).toBeTruthy();
  });
});
