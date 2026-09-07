// The estimated half. One claim, and it is the reason this tile exists rather than a bare
// `<VoteFlowSankey>`: the caveat comes from the DATA and is rendered every time the chart is.
//
// ⚠ A TRANSLATION KEY WOULD NOT DO. `basis` travels inside the artifact so that a producer
// change — a different method, a narrower corpus — reaches the reader with the chart rather
// than waiting for somebody to remember to update a locale file. Rendering it from `t()` is
// the failure this file pins.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PresidentialTransferTile } from "./PresidentialTransferTile";
import { SANKEY_MAX_FROM_NODES } from "./PresidentialTransferTable";
import { MARGIN_GAP_LOUD } from "./PresidentialTransferCard";
import type { RunoffTransfer } from "@/data/presidential/useRunoffTransfer";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const node = (id: string, label: string, votes: number) => ({
  id,
  label,
  labelEn: label,
  color: "#123456",
  votes,
});

const transfer = (over: Partial<RunoffTransfer> = {}): RunoffTransfer =>
  ({
    cycle: "2021_11_14_pvr",
    basis: "БЪЛГАРСКАТА ОГРАДА",
    basisEn: "THE ENGLISH CAVEAT",
    finalists: [
      { number: 6, president: "Румен Радев", votes: 1451755 },
      { number: 15, president: "Анастас Герджиков", votes: 692640 },
    ],
    national: {
      matrix: {
        fromNodes: [node("t6", "Румен Радев", 1000), node("t17", "Друг", 400)],
        toNodes: [node("t6", "Румен Радев", 1200)],
        flows: [
          { from: "t6", to: "t6", votes: 900 },
          { from: "t17", to: "t6", votes: 300 },
        ],
      },
      sections: 12479,
      droppedVotes: 80,
      marginGap: 0.0281,
    },
    oblasts: [],
    coverage: {
      basis: "ОБХВАТ БГ",
      basisEn: "COVERAGE EN",
      domesticSections: 12479,
      abroadVotes: 127572,
      settlementsJoined: 4184,
      sectionsWithEkatte: 10878,
      sectionsWithoutEkatte: 1601,
      votesWithoutEkatte: 406128,
    },
    residue: {
      round1Only: [],
      round2Only: [],
      round1OnlyVotes: 0,
      round2OnlyVotes: 0,
    },
    ...over,
  }) as RunoffTransfer;

// ⚠ THE PROVIDER IS PART OF THE MOUNT, because `Hint` is a Radix tooltip and Radix throws
// („`Tooltip` must be used within `TooltipProvider`") rather than degrading. In the app it
// comes from `main.tsx`; a test that omitted it would report a missing provider as a broken
// tile.
const mount = (t: RunoffTransfer) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PresidentialTransferTile transfer={t} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await i18n.changeLanguage("bg");
  // ⚠ jsdom HAS NO `matchMedia`, and `useMediaQueryMatch` calls it during the first render —
  // so without this the tile throws before any assertion runs. `matches: false` puts the tile
  // on its MOBILE branch, which is the readable one here: jsdom gives the container no width,
  // so the desktop Sankey would render an SVG of zero size and assert nothing.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
});

describe("PresidentialTransferTile", () => {
  it("renders the caveat the ARTIFACT carries, not one of its own", () => {
    mount(transfer());
    expect(screen.getByText("БЪЛГАРСКАТА ОГРАДА")).toBeTruthy();
    expect(screen.getByText(/ОБХВАТ БГ/)).toBeTruthy();
  });

  it("switches to the artifact's ENGLISH caveat, so an EN reader is not left without one", async () => {
    await i18n.changeLanguage("en");
    mount(transfer());
    expect(screen.getByText("THE ENGLISH CAVEAT")).toBeTruthy();
    expect(screen.queryByText("БЪЛГАРСКАТА ОГРАДА")).toBeNull();
  });

  it("makes the precision line LOUD once the estimate stops being a footnote", () => {
    // ⚠⚠ THE SAME KEY AT 2.8% AND AT 70% IS THE PROBLEM. Nationally `marginGap` is 0.012-0.047
    // — a genuine footnote — but the region shards it now shares this card with run to 0.70
    // (2011/S23), with 16 of 155 at or above 0.30. Rendered identically, a page where the
    // ribbons miss their labels by two thirds looks exactly like one where they miss by 3%.
    const caption = (gap: number) => {
      cleanup();
      mount(
        transfer({
          national: { ...transfer().national, marginGap: gap },
        }),
      );
      return screen.getByText(/лентите се разминават/).className;
    };
    expect(caption(MARGIN_GAP_LOUD - 0.01)).toContain("text-muted-foreground");
    expect(caption(MARGIN_GAP_LOUD)).toContain("text-foreground");
    // ⚠ THE THRESHOLD IS PINNED TOO, so it cannot silently drift above every shard the corpus
    // has and stop discriminating. Measured: 16 of 155 shards are ≥ 0.30, 8 are ≥ 0.50.
    expect(MARGIN_GAP_LOUD).toBeGreaterThan(0.05);
    expect(MARGIN_GAP_LOUD).toBeLessThan(0.5);
    cleanup();
  });

  it("states how far the ribbons fall short of the column labels", () => {
    // ⚠ THE ESTIMATE'S OWN IMPRECISION, PRINTED. RAS converges geometrically and a nearly
    // degenerate oblast does not get there — so a reader who adds the ribbons into a node and
    // gets a different number than its label has been told why, in advance.
    mount(transfer());
    expect(screen.getByText(/2,8\s*%/)).toBeTruthy();
  });

  it("names the votes it does NOT cover", () => {
    // Abroad is outside the matrix entirely: published by country rather than by section, and
    // with no roll for „did not vote" to be measured against.
    mount(transfer());
    expect(screen.getByText(/127\s*572/)).toBeTruthy();
  });

  it("draws the flow itself", () => {
    // The chart is mounted through `VoteFlowSankey`; on jsdom the container has no width, so
    // this asserts the mobile twin's node list rather than the SVG's geometry.
    // ⚠ IT DOES NOT PIN WHICH RENDERER RAN. The table prints these same names in its row
    // headers, so this passes under both — which is why the two branch tests below exist.
    mount(transfer());
    expect(screen.getAllByText("Румен Радев").length).toBeGreaterThan(0);
  });

  /** A matrix with `n` from-nodes, for straddling `SANKEY_MAX_FROM_NODES`. */
  const wideMatrix = (n: number) => ({
    fromNodes: Array.from({ length: n }, (_, i) =>
      node(`t${i}`, `Кандидат ${i}`, 1000 - i),
    ),
    toNodes: [node("t0", "Кандидат 0", 1200)],
    flows: [{ from: "t0", to: "t0", votes: 900 }],
  });
  const withMatrix = (n: number) =>
    transfer({
      national: { ...transfer().national, matrix: wideMatrix(n) },
    });

  it("switches to the TABLE once the round-1 side is too wide to trace", () => {
    // ⚠⚠ THE LINE THE WHOLE CHANGE TURNS ON, and nothing exercised it: both fixtures in this
    // file and in `PresidentialCycleScreen.test.tsx` carry 2 and 1 from-nodes, so every test
    // ran the Sankey branch. Inverting the condition kept them all green, because the table
    // renders the same candidate names the chart's mobile twin does.
    mount(withMatrix(SANKEY_MAX_FROM_NODES + 1));
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("keeps the CHART at the threshold, so 2001 (8) and 2006 (9) are unaffected", () => {
    // ⚠ THE BOUNDARY CASE, which is what pins `>` against `>=`. The real cycles sit at 8, 9,
    // 20, 24 and 26 from-nodes.
    mount(withMatrix(SANKEY_MAX_FROM_NODES));
    expect(screen.queryByRole("table")).toBeNull();
  });
});
