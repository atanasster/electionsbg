// Three of this component's renderings are editorial claims rather than styling:
//
//   - a row whose comparison ran through a coalition or an older name must SAY so, or it
//     implies a like-for-like the data does not support;
//   - a row must name the parliament it compared against, which is often not the previous
//     one (ПП sat inside ПП-ДБ for three terms);
//   - a pair that did not move must not be painted as a divergence.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PairMovement } from "@/data/parliament/votes/partyPairs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
    i18n: { language: "bg" },
  }),
}));

const { PairMovementStrip } = await import("./PairMovementStrip");

const row = (over: Partial<PairMovement> = {}): PairMovement => ({
  id: "ГЕРБ-СДС|ПП",
  a: "ГЕРБ-СДС",
  b: "ПП",
  aRaw: "ГЕРБ - СДС",
  bRaw: "ПП",
  points: [],
  score: 0.59,
  prevNs: "49",
  prevScore: 0.1,
  delta: 0.49,
  via: null,
  prevVia: null,
  ...over,
});

const renderStrip = (rows: PairMovement[]) =>
  render(
    <PairMovementStrip
      rows={rows}
      selectedId={null}
      onSelect={() => {}}
      labelFor={(s) => s}
      colorFor={() => "hsl(var(--primary))"}
    />,
  );

describe("PairMovementStrip", () => {
  it("names the coalition when the comparison ran through one", () => {
    renderStrip([row({ prevVia: "ПП - ДБ" })]);
    expect(screen.getByText(/ПП - ДБ/)).toBeInTheDocument();
    // ...and the parliament it actually compared against, not "the previous one".
    expect(screen.getByText(/49/)).toBeInTheDocument();
  });

  it("omits the qualifier on a like-for-like comparison", () => {
    // Proves the assertion above discriminates.
    const { container } = renderStrip([row()]);
    expect(container.textContent).not.toContain("corr_history_via");
  });

  it("says a pair with no predecessor is new rather than showing a delta", () => {
    renderStrip([row({ prevNs: null, prevScore: null, delta: null })]);
    expect(screen.getByText("corr_history_new_pair")).toBeInTheDocument();
  });

  it("reports an unmoved pair as unchanged, with no bar", () => {
    // The compound defect: „−0 т." under a red stub, for a pair that held steady.
    const { container } = renderStrip([
      row({ delta: 0.004, prevScore: 0.586 }),
    ]);
    expect(container.textContent).toContain("corr_history_no_change");
    expect(container.textContent).not.toContain("corr_history_delta");
    expect(container.querySelector(".bg-red-600")).toBeNull();
    expect(container.querySelector(".bg-emerald-600")).toBeNull();
  });

  it("still paints a bar for a pair that did move", () => {
    const { container: fell } = renderStrip([row({ delta: -0.43 })]);
    expect(fell.querySelector(".bg-red-600")).not.toBeNull();
    const { container: rose } = renderStrip([row({ delta: 0.49 })]);
    expect(rose.querySelector(".bg-emerald-600")).not.toBeNull();
  });

  it("renders nothing when there are no rows", () => {
    const { container } = renderStrip([]);
    expect(container.firstChild).toBeNull();
  });
});
