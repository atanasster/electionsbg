// The card renders at its final size before macro.json arrives.
//
// This is what lets /governments render it with the rest of the body instead of
// inserting it when the second payload lands. Gated on `macro` it arrived ~208px
// tall above an already-painted page: 0.2016 CLS on the built dist (Pixel 5,
// 150ms RTT, 1.6Mbps, 4x CPU), in every run where macro.json landed after
// governments.json — which is every run that is not artificially reordered.
// Re-measure with `npm run perf:cls -- /governments`.
//
// The property asserted is STRUCTURAL EQUALITY between the two states, not a
// pixel count: same cell count, same labels, values swapped for em-dashes. A
// height assertion would pass against a placeholder that merely happened to be
// the right size once, and jsdom computes no layout anyway.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Government } from "@/data/governments/useGovernments";
import type { MacroPayload } from "@/data/macro/useMacro";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
vi.mock("@/data/parties/useCanonicalParties", () => ({
  useCanonicalParties: () => ({ colorFor: () => "#123456" }),
}));
vi.mock("@/data/governments/useGovernments", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useGovernments: () => ({ data: undefined }),
}));

import { CabinetScoreDetail } from "./CabinetScoreCard";

const GOV: Government = {
  id: "denkov",
  pmBg: "Николай Денков",
  pmEn: "Nikolai Denkov",
  startDate: "2023-06-06",
  endDate: "2024-03-05",
  type: "regular",
  parties: ["ПП-ДБ", "ГЕРБ-СДС"],
  partiesEn: ["PP-DB", "GERB-SDS"],
  endReason: "resignation",
  endReasonBg: "",
  endReasonEn: "",
  source: "",
};

// Enough of the payload for cabinetMetricsFor to produce real numbers for the
// tenure window above — quarterly points inside it, one per series it reads.
const MACRO = {
  sources: {},
  fetchedAt: "",
  country: "BG",
  indicators: {},
  series: {
    gdpGrowth: [{ year: 2023, quarter: 3, value: 1.8 }],
    inflation: [{ year: 2023, quarter: 3, value: 8.7 }],
    unemployment: [{ year: 2023, quarter: 3, value: 4.2 }],
    govDebt: [
      { year: 2023, quarter: 3, value: 21.2 },
      { year: 2024, quarter: 1, value: 22.6 },
    ],
    budgetBalance: [{ year: 2023, quarter: 3, value: -2.1 }],
  },
} as unknown as MacroPayload;

const cellsOf = (c: HTMLElement) => {
  const grid = c.querySelector("div.grid");
  expect(grid, "the metric grid did not render").not.toBeNull();
  return [...grid!.children].map((cell) => cell.textContent ?? "");
};

const renderCard = (macro?: MacroPayload) =>
  render(
    <MemoryRouter>
      <CabinetScoreDetail government={GOV} macro={macro} />
    </MemoryRouter>,
  );

describe("CabinetScoreDetail without macro", () => {
  it("renders the same cells, labelled, with em-dashes instead of values", () => {
    const waiting = cellsOf(renderCard(undefined).container);
    const loaded = cellsOf(renderCard(MACRO).container);

    expect(waiting).toHaveLength(loaded.length);
    expect(waiting.length).toBeGreaterThan(0);
    // Labels are translation keys and come from neither payload, so they must
    // be identical; only the value part differs.
    for (const [i, cell] of waiting.entries()) {
      expect(loaded[i]).toContain(cell.replace("—", ""));
      expect(cell).toContain("—");
    }
    // Prove the loaded side is genuinely populated — otherwise the assertion
    // above is satisfied by two identical empty cards.
    expect(loaded.join(" ")).toMatch(/\d/);
  });

  it("still names the cabinet, its type and its tenure", () => {
    // The half of the card that never needed macro. If this regressed, the
    // not-yet state would be a blank box of the right height, which is a worse
    // thing to show than the numbers being late.
    const { container } = renderCard(undefined);
    expect(container.textContent).toContain("Николай Денков");
    expect(container.textContent).toContain("gov_type_regular");
    expect(container.textContent).toContain("ПП-ДБ");
  });
});
