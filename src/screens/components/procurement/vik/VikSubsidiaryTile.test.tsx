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
// The fix derives the framing from the rows rather than taking a prop, so what
// is worth pinning is the DERIVATION, not the wording: hand it a non-member and
// the group claim must disappear on its own.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VikSubsidiaryTile } from "./VikSubsidiaryTile";
import {
  VIK_HOLDING_EIK,
  VIK_HOLDING_SUB_EIKS,
  SOFIYSKA_VODA_EIK,
  USYA_EIK,
} from "@/lib/vikReferenceData";
import type { VikOperatorAgg } from "@/data/procurement/useVik";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" } }),
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

const renderTile = (operators: VikOperatorAgg[]) =>
  render(
    <MemoryRouter>
      <VikSubsidiaryTile operators={operators} />
    </MemoryRouter>,
  );

const GROUP_CLAIM = /в групата/;
const SECTOR_CLAIM = /във водния сектор/;

describe("VikSubsidiaryTile — group vs sector framing", () => {
  it("claims group membership when every row IS in the holding", () => {
    renderTile([
      row(VIK_HOLDING_EIK, 900),
      row(VIK_HOLDING_SUB_EIKS[0], 500),
      row(VIK_HOLDING_SUB_EIKS[1], 300),
    ]);
    expect(screen.getAllByText(GROUP_CLAIM).length).toBeGreaterThan(0);
    expect(screen.queryByText(SECTOR_CLAIM)).toBeNull();
  });

  it("drops the group claim as soon as one row is the concession", () => {
    // One non-member is enough — the heading is a claim about EVERY row.
    renderTile([
      row(VIK_HOLDING_SUB_EIKS[0], 500),
      row(SOFIYSKA_VODA_EIK, 900),
    ]);
    expect(screen.queryByText(GROUP_CLAIM)).toBeNull();
    expect(screen.getAllByText(SECTOR_CLAIM).length).toBeGreaterThan(0);
  });

  it("drops it for the dams enterprise too", () => {
    // ДП УСЯ is the row that made the old framing indefensible: a dam
    // enterprise is not a ВиК operator under any reading.
    renderTile([row(VIK_HOLDING_SUB_EIKS[0], 500), row(USYA_EIK, 200)]);
    expect(screen.queryByText(GROUP_CLAIM)).toBeNull();
  });

  it("renders nothing below two operators, so a single row cannot claim a group", () => {
    const { container } = renderTile([row(SOFIYSKA_VODA_EIK, 900)]);
    expect(container).toBeEmptyDOMElement();
  });
});
