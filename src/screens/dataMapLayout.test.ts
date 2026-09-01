// The /data map's layout rests on two facts that live in files which cannot
// see each other, and both fail silently when they drift: the shell's width
// budget (Layout.tsx + tailwind.config.js) and the canvas cap (DataMapScreen +
// viewport.ts). A drift shows up as a map that is quietly smaller than it
// could be — no error, no failing render.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../scripts/lib/strip_comments";
import { dataMapExtent, DATA_MAP_FIT_MAX_ZOOM } from "@/data/dataMap/viewport";
import { DATA_MAP_FRESH_DAYS } from "@/data/dataMap/useDataMap";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
/**
 * Source with its comments removed — the shared primitive, plus JSX `{/* … *\/}`
 * blocks, which `stripComments` deliberately does not touch (it anchors on
 * comments that OWN their line, and a JSX comment is an expression inside
 * markup). All five in this screen survive it, and several DISCUSS the very
 * patterns these gates forbid: prose that mentions a pattern is not an
 * occurrence of it.
 *
 * The JSX strip is deliberately narrow — `{/*` to the matching `*\/}` — because
 * an unanchored block strip is the failure `scripts/lib/strip_comments.ts`
 * documents in both directions.
 */
const code = (p: string): string =>
  stripComments(read(p)).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const screen = () => read("src/screens/DataMapScreen.tsx");
const screenCode = () => code("src/screens/DataMapScreen.tsx");

/** The overlay's positioning ancestor. `relative` gives the absolute column a
 *  box to span; `isolate` keeps the card's z-10 out of the root stacking
 *  context, where the fixed header also sits at z-10. */
const WRAPPER = /className="relative isolate flex flex-col gap-4"/;

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
  it("never turns the row into a column pair", () => {
    // A docked rail would be a flex item beside the map. The panel is either
    // below it (< lg) or absolutely positioned OVER it (>= lg) — never a
    // sibling column at any breakpoint. T4 gives it `lg:w-[320px]`, and that
    // width is spent on an absolute box, so it takes nothing from the canvas.
    const src = screenCode();
    expect(src).toMatch(WRAPPER);
    for (const utility of ["flex-row", "shrink-0", "basis-", "flex-1"]) {
      expect(src).not.toMatch(new RegExp(`(lg|xl|2xl):${utility}`));
    }
    // A breakpointed width on the panel is only safe out of the flow. Asserted
    // unconditionally in both directions: `if (width) expect(absolute)` passes
    // vacuously the day the width is dropped, which is exactly when the rule
    // stops being checked.
    expect(src).toMatch(/lg:w-\[320px\] xl:w-\[360px\]/);
    expect(src).toMatch(/lg:absolute/);
  });
});

describe("the canvas cap and the framing ceiling are one number", () => {
  // The hoist's whole purpose: the box stops growing exactly where the framing
  // stops magnifying. Two literals would drift, and the symptom would be empty
  // space around the graph (cap too high) or a graph drawn below its ceiling
  // (cap too low) — neither of which fails anything.
  it("derives both bounds from DATA_MAP_FIT_MAX_ZOOM", () => {
    const src = screenCode();
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
  // panel is 0px when idle and 431px on a selection; page height 2576 -> 2114.
  it("renders nothing at all with no selection", () => {
    const panel = read("src/screens/components/datamap/DataMapPanel.tsx");
    expect(panel).toMatch(/if \(!node\) return null;/);
    // A null child still spends the flex row's gap without this.
    expect(screenCode()).toMatch(/"empty:hidden/);
    // The id is the contract between the scroll-nudge's getElementById and the
    // JSX. Renaming either half silently stops the nudge — a click that never
    // visibly answers, below `lg` where the card is off-screen.
    expect(screenCode()).toMatch(/id="datamap-panel"/);
    expect(screenCode()).toMatch(/getElementById\("datamap-panel"\)/);
  });

  it("counts the tiers in the head instead", () => {
    const src = screenCode();
    expect(src).toMatch(/data_map_tier_sources/);
    expect(src).toMatch(/data_map_tier_datasets/);
    expect(src).toMatch(/data_map_tier_features/);
    expect(read("src/screens/components/datamap/DataMapPanel.tsx")).not.toMatch(
      /data_map_tier_/,
    );
  });

  it("keeps the stories with the lens pills, not in the panel", () => {
    const src = screenCode();
    expect(src).toMatch(/aria-label=\{t\("data_map_stories"\)\}/);
    expect(read("src/screens/components/datamap/DataMapPanel.tsx")).not.toMatch(
      /onStartTour|data_map_stories/,
    );
  });

  it("bleeds the story scroller by exactly the shell's own padding", () => {
    // `-mx-2 … px-2` runs the row to the page edge so a chip is never clipped
    // mid-row. It is Layout.tsx's `p-2` mirrored — a drift either overflows the
    // page or leaves a visible notch.
    expect(screenCode()).toMatch(/-mx-2[^"]*px-2/);
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
    expect(screenCode()).toMatch(/days: DATA_MAP_FRESH_DAYS/);
    for (const corpus of [bg, en] as Record<string, string>[]) {
      expect(corpus.data_map_hint).toContain("{{days}}");
    }
    expect(DATA_MAP_FRESH_DAYS).toBeGreaterThan(0);
  });
});

describe("the detail overlays the map from lg up", () => {
  // Measured 2026-09-02. 1440: the column is absolute, the card sticky, 360px
  // wide, hanging off the canvas's right edge into the gutter the width cap
  // leaves. 1024: 320px, flush to the canvas edge. 768: static, 737px, stacked
  // below the map. Nothing is spent when no node is selected.
  it("takes the panel out of the flow at lg and leaves it in below", () => {
    const src = screenCode();
    expect(src).toMatch(/lg:absolute lg:inset-y-0/);
    // inset-y-0 needs a positioned ancestor spanning the canvas, or the card
    // has no column to be sticky within.
    expect(src).toMatch(WRAPPER);
    expect(src).toMatch(/lg:sticky lg:top-20/);
  });

  it("hangs the card off an edge that does not reach the selected node", () => {
    // Features are the right-hand column and sources the left, so each takes
    // the opposite edge. Datasets are the MIDDLE column — no edge reaches them,
    // so the rule is not "opposite" for them and the card simply stays put
    // (see the hysteresis test below).
    const src = screenCode();
    expect(src).toMatch(/overlaySide === "left" \? "lg:left-0" : "lg:right-0"/);
  });

  it("lets the empty column pass clicks through to the map", () => {
    // The column spans the canvas's whole height; without this, its empty area
    // would swallow every pan and node click outside the card itself.
    const src = screenCode();
    expect(src).toMatch(/lg:pointer-events-none/);
    expect(src).toMatch(/lg:pointer-events-auto/);
  });

  it("suppresses the scroll-nudge exactly where the card overlays", () => {
    // Below lg the card lands off-screen and the nudge is what makes a click
    // visibly answer; at lg and up it is already in view, so nudging would
    // scroll the page out from under the reader. matchMedia, not innerWidth —
    // the latter counts the scrollbar and disagrees with the CSS breakpoint by
    // ~15px.
    const src = screenCode();
    expect(src).toMatch(/useMediaQueryMatch\("lg"\)/);
    expect(src).toMatch(/if \(!selectedId \|\| story \|\| overlays\) return;/);
    expect(src).not.toMatch(/window\.innerWidth/);
    // The comment above that line NAMES window.innerWidth, so this assertion
    // only means anything against the stripped source.
    expect(screen()).toMatch(/window\.innerWidth/);
  });
});

describe("the two things that float over the canvas stay off each other", () => {
  // The card and React Flow's zoom/fit controls are the only two, and BOTH
  // defaulted to bottom-right. A sticky card unpins at the bottom of its column
  // and pins its own bottom edge to the canvas's, which is 15px from where the
  // controls sit — so the overlap was persistent at the bottom of a 4,237px
  // map, on the 82 of 108 nodes that put the card on the right, over the
  // bespoke fit button T1 built.
  it("derives both sides from one value", () => {
    const src = screenCode();
    expect(src).toMatch(
      /controlsSide=\{overlaySide === "left" \? "right" : "left"\}/,
    );
    const canvas = code("src/screens/components/datamap/DataMapCanvas.tsx");
    expect(canvas).toMatch(
      /position=\{controlsSide === "left" \? "bottom-left" : "bottom-right"\}/,
    );
    // No hard-coded corner survives beside it.
    expect(canvas).not.toMatch(/position="bottom-(left|right)"/);
  });

  it("moves the card only when staying put would cover the new node", () => {
    // Recomputing the side from every selection flipped it on 216 of 364
    // neighbour traversals and mid-tour in 3 of 4 stories — a ~1,000px jump
    // with no transition. Datasets are the middle column, which neither edge
    // reaches, so they must leave the card alone.
    const src = screenCode();
    expect(src).toMatch(
      /if \(selectedKind === "feature"\) setOverlaySide\("left"\)/,
    );
    expect(src).toMatch(
      /else if \(selectedKind === "source"\) setOverlaySide\("right"\)/,
    );
    expect(src).not.toMatch(/=== "feature"\s*\?\s*"left"\s*:\s*"right"/);
  });

  it("anchors the overlay to the map rather than to the content box", () => {
    // The wrapper takes the full 1384px content width while the canvas is
    // capped at ~1203, so without this a right-hand card hangs 181px off the
    // map at >=1400 while a left-hand one is flush.
    const src = screenCode();
    expect(src).toMatch(
      /maxWidth: Math\.round\(extent\.w \* DATA_MAP_FIT_MAX_ZOOM\)/,
    );
  });

  it("keeps the card scrollable rather than letting it outgrow the viewport", () => {
    // The richest nodes carry upstream + downstream + links + sources; without
    // a ceiling the card runs past the bottom of the screen with no way down.
    expect(screenCode()).toMatch(/lg:max-h-\[74vh\] lg:overflow-y-auto/);
  });

  it("announces the overlay and gives it a keyboard exit", () => {
    // At lg+ the scroll-nudge is suppressed, so a selection produces no
    // viewport movement at all — the card just materialises.
    const src = screenCode();
    expect(src).toMatch(/role="region"/);
    expect(src).toMatch(/aria-live="polite"/);
    expect(src).toMatch(/e\.key === "Escape"/);
  });
});

describe("the JS breakpoint and the CSS one are the same number", () => {
  // The whole tier rests on `useMediaQueryMatch("lg")` firing exactly where
  // `lg:` does. The hook keeps its own table, and it already disagrees with
  // Tailwind on `2xl` (1440 vs 1536) — so this pairing is worth pinning rather
  // than assuming.
  it("maps lg to (min-width: 1024px), as Tailwind does", () => {
    const hook = code("src/ux/useMediaQueryMatch.tsx");
    expect(hook).toMatch(/case "lg":\s*\n?\s*return "\(min-width: 1024px\)";/);
  });

  it("uses that hook rather than a width comparison", () => {
    expect(screenCode()).toMatch(/useMediaQueryMatch\("lg"\)/);
  });
});
