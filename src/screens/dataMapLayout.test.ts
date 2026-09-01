// The /data map's layout rests on two facts that live in files which cannot
// see each other, and both fail silently when they drift: the shell's width
// budget (Layout.tsx + tailwind.config.js) and the canvas cap (DataMapScreen +
// viewport.ts). A drift shows up as a map that is quietly smaller than it
// could be — no error, no failing render.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dataMapExtent, DATA_MAP_FIT_MAX_ZOOM } from "@/data/dataMap/viewport";
import { DATA_MAP_FRESH_DAYS } from "@/data/dataMap/useDataMap";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const screen = () => read("src/screens/DataMapScreen.tsx");

/**
 * The block a `key: { … }` opens, matched by counting braces rather than with a
 * lazy `[\s\S]*?` — which stops at the FIRST `}` and so swallows the sibling
 * block whole, making every assertion over it pass on the drift it is meant to
 * catch.
 */
const blockAfter = (src: string, key: string): string | null => {
  const at = src.indexOf(key);
  if (at < 0) return null;
  const open = src.indexOf("{", at + key.length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
};

describe("the detail rail never takes width from the map", () => {
  // It used to dock from `lg` (1024) up, which left the canvas 617px — a 0.575
  // zoom — and INVERTED the sizing: a 768px tablet got a 737px map and a
  // 1024px one got 617. Docking is not affordable in this shell at any
  // breakpoint (see the container-clamp test below), so it is gone rather than
  // moved wider.
  it("stacks the panel at every breakpoint", () => {
    const src = screen();
    expect(src).toMatch(/className="flex flex-col gap-4"/);
    for (const utility of [
      "flex-row",
      "w-\\[360px\\]",
      "shrink-0",
      "sticky",
      "top-20",
      "max-h-\\[74vh\\]",
      "overflow-y-auto",
    ]) {
      expect(src).not.toMatch(new RegExp(`(lg|xl|2xl):${utility}`));
    }
  });

  it("nudges the panel into view at every width, since it is always below", () => {
    const src = screen();
    expect(src).toMatch(/if \(!selectedId \|\| story\) return;/);
    // A width comparison here was the old dock's companion and is now a bug:
    // `window.innerWidth` includes the scrollbar, so it disagrees with any
    // media query by ~15px — and there is no breakpoint left to compare to.
    expect(src).not.toMatch(/window\.innerWidth >=/);
  });
});

describe("the canvas cap and the framing ceiling are one number", () => {
  // The hoist's whole purpose: the box stops growing exactly where the framing
  // stops magnifying. Two literals would drift, and the symptom would be empty
  // space around the graph (cap too high) or a graph drawn below its ceiling
  // (cap too low) — neither of which fails anything.
  it("derives both bounds from DATA_MAP_FIT_MAX_ZOOM", () => {
    const src = screen();
    expect(src).toMatch(
      /maxWidth: Math\.round\(extent\.w \* DATA_MAP_FIT_MAX_ZOOM\)/,
    );
    expect(src).toMatch(
      /maxHeight: Math\.round\(extent\.h \* DATA_MAP_FIT_MAX_ZOOM\)/,
    );
    // No hand-written multiplier survives beside them. `1.2` was the old
    // maxHeight, and with a 1.15 width cap it had become unreachable for any
    // manifest — dead, and a tripwire if the ceiling were ever raised past it.
    expect(src).not.toMatch(/extent\.[wh] \* 1\.\d/);
  });

  it("caps at a width the current manifest can actually use", () => {
    // Sanity on the real geometry rather than on a fixture: the cap must sit
    // above the graph's own width, or the map could never reach 1:1 anywhere.
    const extent = dataMapExtent({
      tiers: [
        {
          kind: "source",
          label: { bg: "", en: "" },
          x: 0,
          y: 0,
          w: 1030,
          h: 3668,
        },
      ],
      nodes: [],
    });
    expect(extent.w * DATA_MAP_FIT_MAX_ZOOM).toBeGreaterThan(extent.w);
  });
});

describe("the shell's width budget is what rules out docking", () => {
  // Measured 2026-09-01: content = min(viewport, 1400) − 16, frozen at 1384px
  // however wide the screen. A docked rail would leave 1384 − 360 − 16 = 1008px
  // — below the ~1046px this graph needs for 1:1, and a 16% step DOWN from the
  // 1203px a stacked canvas gets. If either input below changes, docking may
  // become affordable again and this decision is worth revisiting.
  it("wraps every screen in a padded container", () => {
    expect(read("src/layout/Layout.tsx")).toMatch(/container[^"]*\bp-2\b/);
  });

  it("clamps the container to 1400px, and only the container", () => {
    const config = read("tailwind.config.js");
    const container = blockAfter(config, "container:");
    expect(container).toMatch(/"2xl":\s*"1400px"/);
    // A `screens:` block outside the container one would redefine every
    // breakpoint in the project, not just the container's max-width.
    expect(config.replace(container ?? "", "")).not.toMatch(/screens:\s*\{/);
  });

  it("brace-matches the container block rather than stopping at the first }", () => {
    // Mutation check on blockAfter itself: with a lazy `[\s\S]*?` the sibling
    // `screens` block is swallowed and BOTH assertions above pass on the exact
    // drift they exist to catch.
    const drifted = `theme: { container: { center: true }, screens: { "2xl": "1600px" } }`;
    expect(blockAfter(drifted, "container:")).toBe("{ center: true }");
    expect(
      drifted.replace(blockAfter(drifted, "container:") ?? "", ""),
    ).toMatch(/screens:\s*\{/);
  });
});

describe("the head carries what the panel's empty state used to", () => {
  // Those four blocks — hint, tier counts, freshness legend, stories —
  // described the PAGE, not a selection, and on a narrow screen they sat below
  // a 1264px map where nobody reached them. Measured 2026-09-02 at 375px: the
  // panel is 0px when idle and 431px on a selection; page height 2576 -> 2146.
  it("renders nothing at all with no selection", () => {
    const panel = read("src/screens/components/datamap/DataMapPanel.tsx");
    expect(panel).toMatch(/if \(!node\) return null;/);
    // A null child still spends the flex row's gap without this.
    expect(screen()).toMatch(/id="datamap-panel" className="empty:hidden"/);
  });

  it("counts the tiers in the head instead", () => {
    const src = screen();
    expect(src).toMatch(/data_map_tier_sources/);
    expect(src).toMatch(/data_map_tier_datasets/);
    expect(src).toMatch(/data_map_tier_features/);
    expect(read("src/screens/components/datamap/DataMapPanel.tsx")).not.toMatch(
      /data_map_tier_/,
    );
  });

  it("keeps the stories with the lens pills, not in the panel", () => {
    const src = screen();
    expect(src).toMatch(/aria-label=\{t\("data_map_stories"\)\}/);
    expect(read("src/screens/components/datamap/DataMapPanel.tsx")).not.toMatch(
      /onStartTour|data_map_stories/,
    );
  });

  it("bleeds the story scroller by exactly the shell's own padding", () => {
    // `-mx-2 … px-2` runs the row to the page edge so a chip is never clipped
    // mid-row. It is Layout.tsx's `p-2` mirrored — a drift either overflows the
    // page or leaves a visible notch.
    expect(screen()).toMatch(/-mx-2[^"]*px-2/);
    expect(read("src/layout/Layout.tsx")).toMatch(/\bp-2\b/);
  });
});

describe("one definition per shared rule", () => {
  it("has a single KIND_DOT", () => {
    // Three readers: the node card (the graph itself), the panel's chips, and
    // the head strip. The node card carried a byte-identical private copy until
    // 2026-09-02, which is the disagreement kindDot.ts exists to prevent.
    for (const f of [
      "src/screens/components/datamap/DataMapNodeCard.tsx",
      "src/screens/components/datamap/DataMapPanel.tsx",
      "src/screens/DataMapScreen.tsx",
    ]) {
      expect(read(f)).toMatch(/KIND_DOT/);
      expect(read(f)).not.toMatch(/const KIND_DOT/);
    }
    expect(read("src/screens/components/datamap/kindDot.ts")).toMatch(
      /export const KIND_DOT/,
    );
  });

  it("quotes the reader the same freshness window the canvas applies", () => {
    // The hint used to say "the last few days" against a 7-day constant. It
    // interpolates now, so the copy cannot outlive a change to the number.
    expect(read("src/screens/components/datamap/DataMapCanvas.tsx")).toMatch(
      /DATA_MAP_FRESH_DAYS \* 24 \* 3600 \* 1000/,
    );
    expect(screen()).toMatch(/days: DATA_MAP_FRESH_DAYS/);
    for (const corpus of [bg, en] as Record<string, string>[]) {
      expect(corpus.data_map_hint).toContain("{{days}}");
    }
    expect(DATA_MAP_FRESH_DAYS).toBeGreaterThan(0);
  });
});
