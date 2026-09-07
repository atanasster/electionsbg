// The one rule this component was extracted to hold, tested where it lives.
//
// ⚠ IT WAS PINNED ONLY THROUGH THE COUNTRY TILE. The component exists so a reader cannot get
// the ranked table on the country page and an untraceable Sankey one level down, about the
// same estimate — and the only assertion of that mounted `PresidentialTransferTile`, while the
// region tile's suite uses a one-node matrix and never reaches the branch at all. Sharing the
// component makes divergence structurally unlikely; testing the shared rule directly is what
// makes it checkable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { PresidentialTransferChart } from "./PresidentialTransferChart";
import { SANKEY_MAX_FROM_NODES } from "./PresidentialTransferTable";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const node = (id: string, votes: number) => ({
  id,
  label: `Кандидат ${id}`,
  labelEn: `Кандидат ${id}`,
  color: "#123456",
  votes,
});

/** A matrix with `n` from-nodes, for straddling the threshold. */
const matrix = (n: number) => ({
  fromNodes: Array.from({ length: n }, (_, i) => node(`t${i}`, 1000 - i)),
  toNodes: [node("t0", 1200)],
  flows: [{ from: "t0", to: "t0", votes: 900 }],
});

beforeEach(() => {
  // ⚠ jsdom HAS NO `matchMedia`, and the chart calls it during the first render. `false` puts
  // the narrow branch on `VoteFlowMobile`, which is the readable one here — jsdom gives the
  // container no width, so the Sankey would render an SVG of zero size and assert nothing.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
});

afterEach(() => vi.restoreAllMocks());

const mount = (n: number) =>
  render(
    <MemoryRouter>
      <PresidentialTransferChart matrix={matrix(n)} />
    </MemoryRouter>,
  );

describe("PresidentialTransferChart", () => {
  it("draws the TABLE once the round-1 side is too wide to trace", () => {
    // The real cycles sit at 8, 9, 20, 24 and 26 from-nodes.
    mount(SANKEY_MAX_FROM_NODES + 1);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps the CHART at the threshold, which is what pins `>` against `>=`", () => {
    mount(SANKEY_MAX_FROM_NODES);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("decides on the FROM side alone", () => {
    // ⚠ THE TO SIDE IS TWO CANDIDATES PLUS THREE LANES ON EVERY CYCLE EVER HELD, so it cannot
    // be what makes a chart unreadable. A rule that counted both sides would flip on a matrix
    // whose from-side is comfortably traceable.
    const wide = matrix(SANKEY_MAX_FROM_NODES);
    wide.toNodes = Array.from({ length: 8 }, (_, i) => node(`u${i}`, 100));
    render(
      <MemoryRouter>
        <PresidentialTransferChart matrix={wide} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();
  });
});
