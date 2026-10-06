// Two Sankeys on one page must not share ribbon gradients. SVG ids are document-global, so with
// fixed ids the second chart's ribbons painted with the first chart's colours.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { VoteFlowSankey } from "./VoteFlowSankey";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";

await i18n.use(initReactI18next).init({
  lng: "bg",
  resources: { bg: { translation: {} } },
  react: { useSuspense: false },
});

const matrix = (color: string): VoteFlowMatrix => ({
  fromNodes: [{ id: "a", label: "A", labelEn: "A", color, votes: 10 }],
  toNodes: [{ id: "b", label: "B", labelEn: "B", color, votes: 10 }],
  flows: [{ from: "a", to: "b", votes: 10 }],
});

describe("VoteFlowSankey", () => {
  it("gives each chart its own gradient ids, and each ribbon its own chart's gradient", () => {
    const { container } = render(
      <>
        <div data-chart="1">
          <VoteFlowSankey matrix={matrix("#ff0000")} width={400} height={200} />
        </div>
        <div data-chart="2">
          <VoteFlowSankey matrix={matrix("#0000ff")} width={400} height={200} />
        </div>
      </>,
    );
    const idsOf = (chart: string) =>
      [
        ...container.querySelectorAll(`[data-chart="${chart}"] linearGradient`),
      ].map((g) => g.id);
    const one = idsOf("1");
    const two = idsOf("2");
    expect(one.length).toBeGreaterThan(0);
    expect(two.length).toBeGreaterThan(0);
    expect(one.filter((id) => two.includes(id))).toEqual([]);
    for (const [chart, ids] of [
      ["1", one],
      ["2", two],
    ] as const) {
      const strokes = [
        ...container.querySelectorAll(
          `[data-chart="${chart}"] path[stroke^="url("]`,
        ),
      ].map((p) => (p.getAttribute("stroke") ?? "").slice(5, -1));
      expect(strokes.length).toBeGreaterThan(0);
      for (const s of strokes) expect(ids).toContain(s);
    }
  });
});
