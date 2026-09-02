// The /data map's layout rests on two facts that live in files which cannot
// see each other, and both fail silently when they drift: the shell's width
// budget (Layout.tsx + tailwind.config.js) and the canvas cap (DataMapScreen +
// viewport.ts). A drift shows up as a map that is quietly smaller than it
// could be — no error, no failing render.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../scripts/lib/strip_comments";
import { cn } from "@/lib/utils";
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

/** Every .tsx under src/, for the repo-wide bans below. */
const globSrc = (dir = "src"): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? globSrc(`${dir}/${e.name}`)
      : e.name.endsWith(".tsx")
        ? [`${dir}/${e.name}`]
        : [],
  );

/** H1's own base classes, read from the component so this cannot go stale. */
const H1_BASE = /cn\(\s*"([^"]+)"/.exec(read("src/ux/H1.tsx"))![1];

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

  it("counts what the map DRAWS, not the whole corpus", () => {
    // Since the `?view=` filter reflows rather than dims, a corpus-wide
    // 46/36/26 beside a 9-node prices view would caption a different graph.
    const src = screenCode();
    expect(src).toMatch(/const nodes = graph\?\.nodes \?\? \[\];/);
    expect(src).toMatch(/nodes\.filter\(\(n\) => n\.kind === kind\)/);
    expect(src).not.toMatch(/manifest\.nodes\.filter\(\(n\) => n\.kind/);
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

  it("keeps the stories in the toolbar, not in the panel", () => {
    // A menu rather than a row of chips: starting a story is an ACTION, and
    // four chips cost a whole row of head to sit in.
    const src = screenCode();
    expect(src).toMatch(/DropdownMenuTrigger/);
    expect(src).toMatch(/onSelect=\{\(\) => onStartTour\(tour\.id\)\}/);
    // modal={false} — a modal menu locks body scroll, and this page IS a scroll.
    expect(src).toMatch(/<DropdownMenu modal=\{false\}>/);
    expect(read("src/screens/components/datamap/DataMapPanel.tsx")).not.toMatch(
      /onStartTour|data_map_stories/,
    );
  });

  it("bleeds the toolbar once, from the one place the value lives", () => {
    // The bleed cancels Layout's `p-2` so a chip is never clipped mid-scroll.
    // It used to be written out twice — here and inside PillGroup — and applied
    // NESTED, which looked right only because both were 0.5rem.
    const shell = read("src/layout/shellPadding.ts");
    expect(shell).toMatch(/SHELL_PAD = "p-2"/);
    expect(read("src/layout/Layout.tsx")).toMatch(/\bp-2\b/);
    expect(screenCode()).toMatch(/SHELL_BLEED/);
    // Nothing hand-writes it any more.
    expect(screenCode()).not.toMatch(/-mx-2/);
    expect(read("src/components/ui/Pill.tsx")).not.toMatch(/-mx-2/);
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
    // Sticky BELOW the toolbar, and both terms MEASURED: the toolbar's second
    // row wraps once a lens legend renders, so a literal offset was right in
    // the default state and wrong the moment a lens was picked — with the
    // toolbar painting over the card's own title and close button.
    expect(src).toMatch(
      /lg:sticky lg:top-\[calc\(var\(--header-height,70px\)\+var\(--datamap-toolbar,88px\)\)\]/,
    );
    expect(src).toMatch(/--datamap-toolbar/);
    expect(src).toMatch(/new ResizeObserver\(update\)/);
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

describe("the view filter reflows rather than dims", () => {
  // It DIMMED until v3: whichever view was picked the graph stayed 108 nodes at
  // full size, so a reader who asked for „Цени" scrolled 3,684px past 99 greyed
  // cards. Measured 2026-09-02 after: prices draws 9 cards, 0 dimmed, and the
  // page is 1,264px instead of 5,015px, at the same 1.13x zoom.
  it("draws the resolved view graph, never the whole manifest", () => {
    const src = screenCode();
    expect(src).toMatch(/dataMapView\(manifest, viewId\)/);
    expect(src).toMatch(/graph=\{graph!\}/);
    const canvas = code("src/screens/components/datamap/DataMapCanvas.tsx");
    // Every read inside the canvas goes through the resolved graph. A stray
    // `manifest.` there would draw the full node set at view positions.
    expect(canvas).not.toMatch(/manifest\./);
  });

  it("frames the view's own extent", () => {
    // dataMapExtent over the manifest would size the box for all 108 nodes and
    // leave a 9-node view floating in a 3,684px column.
    expect(screenCode()).toMatch(/dataMapExtent\(graph\)/);
  });

  it("only dims on the fallback path", () => {
    // With a baked layout the non-members are absent, so computing viewIds
    // would grey out the whole view.
    const canvas = code("src/screens/components/datamap/DataMapCanvas.tsx");
    expect(canvas).toMatch(
      /if \(!viewTag \|\| !graph\.dimNonMembers\) return null;/,
    );
  });

  it("keeps the panel on the FULL manifest", () => {
    // The map is a window; a node's „Built from" / „Used by" chips are claims
    // about the DATA. Narrowing them to the view would tell a reader that
    // ds:demographics has no sources, which is false — and the panel is also
    // the only route back to a neighbour the view cut, via the widen effect
    // below.
    const src = screenCode();
    expect(src).toMatch(/<DataMapPanel[\s\S]{0,200}manifest=\{manifest\}/);
    const panel = code("src/screens/components/datamap/DataMapPanel.tsx");
    expect(panel).toMatch(/manifest\.edges/);
    expect(panel).not.toMatch(/dataMapView|graph\./);
  });

  it("says on the card when the view cut a connection", () => {
    // A card that loses every arrow in one direction reads as an answer on a
    // page whose subject is provenance. Measured on ?view=prices: src:eurostat
    // draws with a „+3" badge instead of feeding nothing.
    expect(screenCode()).toMatch(
      /hiddenLabel=\{\(n\) => t\("data_map_hidden_edges"/,
    );
    const canvas = code("src/screens/components/datamap/DataMapCanvas.tsx");
    expect(canvas).toMatch(/hidden: graph\.hidden\.get\(n\.id\)/);
  });

  it("widens the view when the selection is not in it", () => {
    // A neighbour chip, a deep link or a tour step can name a node the view
    // does not contain; without this the panel describes a node the map does
    // not draw. Verified live: /data?view=prices&node=src:cik drops the view.
    expect(screenCode()).toMatch(
      /if \(!graph\.nodes\.some\(\(n\) => n\.id === selectedId\)\) setParam\("view", null\);/,
    );
  });
});

describe("the head is a title line and one sticky toolbar", () => {
  // Measured 2026-09-02 at 1280px, the map used to start 654px down — 510px of
  // it this page's own: an 80px H1 whose words the active DataNav pill repeated
  // 34px below it, a 72px deck, then FOUR stacked control rows (view pills,
  // counts, lens, stories).
  it("puts the title and the section nav on one line", () => {
    const src = screenCode();
    expect(src).toMatch(/<DataNav active="map" \/>/);
    expect(src).not.toMatch(
      /<Title description=\{t\("data_map_description"\)\}>/,
    );
  });

  it("actually overrides H1's size and padding, not just passes a string", () => {
    // twMerge only drops a base utility when the override names the SAME
    // variant. The first cut passed `py-1 text-xl md:text-2xl`, and both
    // `sm:text-3xl` and `md:py-5` survived — so the title was 30px at 640-767
    // (LARGER than the 24px above it) and kept all 40px of the padding this was
    // meant to remove, at exactly the width it was measured at. Asserting the
    // input string cannot see that; asserting the RESOLVED class can.
    const src = screenCode();
    const passed = /<Title[\s\S]{0,200}className="([^"]+)"/.exec(src)?.[1];
    expect(passed).toBeTruthy();
    const resolved = cn(H1_BASE, passed!);
    for (const survivor of [/\bsm:text-3xl\b/, /\bmd:py-5\b/, /\bpy-3\b/]) {
      expect(resolved).not.toMatch(survivor);
    }
    expect(resolved).toMatch(/\bleading-tight\b/);
  });

  it("no longer renders the deck paragraph", () => {
    // It survives as the SEO description, which is where a restatement of the
    // page title earns its keep.
    const src = screenCode();
    expect(src).toMatch(/description=\{t\("data_map_description"\)\}/);
    expect(src).not.toMatch(/<p[^>]*>\s*\{t\("data_map_description"\)\}/);
  });

  it("sticks the toolbar under the site header", () => {
    // The map is 4,237px tall: without this, scrolling into it left the reader
    // with no way to change view or lens but to scroll all the way back.
    const src = screenCode();
    expect(src).toMatch(/sm:sticky sm:top-\[var\(--header-height,70px\)\]/);
    // A literal 70px here would drift from the header it sits under.
    expect(src).not.toMatch(/sticky top-\[70px\]/);
    // Not on a phone: the utility line wraps there and the bar is 159px, 28%
    // of an 812px viewport to hold permanently.
    expect(src).not.toMatch(/[^:]sticky top-\[var/);
  });

  it("draws the hint on the canvas, not in the head", () => {
    // Guidance about the map, placed where the action is, and gone on first
    // selection. pointer-events-none so it never eats a pan.
    const src = screenCode();
    expect(src).toMatch(
      /\{!selectedId && !story \? \([\s\S]{0,240}data_map_hint/,
    );
    expect(src).toMatch(/pointer-events-none absolute inset-x-4 top-3/);
  });
});

describe("the selected pill is one component", () => {
  // Its hand-rolled selected state rendered 4.77:1 at 14px/500 in light mode —
  // past AA (4.5) by 0.27 and nowhere near AAA. `--accent-strong` is white on
  // 41% coral, 5.45:1, while decorative `--accent` keeps the brand hue.
  it("routes every pill through Pill/PillLink", () => {
    for (const f of [
      "src/screens/DataMapScreen.tsx",
      "src/screens/components/DataNav.tsx",
      "src/screens/AbroadRegistryScreen.tsx",
      "src/screens/components/declarations/AssetsByGroup.tsx",
      "src/screens/person/PersonElectoralSection.tsx",
    ]) {
      expect(read(f)).toMatch(/from "@\/components\/ui\/Pill"/);
      // The hand-rolled pairs, in any spelling.
      expect(code(f)).not.toMatch(/bg-accent text-accent-foreground/);
      expect(code(f)).not.toMatch(/bg-primary text-primary-foreground/);
    }
  });

  it("leaves no 4.77:1 pair anywhere in src/", () => {
    // The pair this work replaced. It is cheap to reintroduce by copy-paste,
    // which is exactly how it reached three screens — so the ban is repo-wide
    // rather than per-file. `--accent` stays the DECORATIVE token; what is
    // forbidden is a LABEL sitting on it.
    const hits = globSrc()
      .filter((f) => /bg-accent\s+text-accent-foreground/.test(code(f)))
      .map((f) => f.replace(/^src\//, ""));
    expect(hits).toEqual([]);
  });

  it("defines the interactive coral in both themes", () => {
    const css = read("src/App.css");
    expect(css).toMatch(/--accent-strong: 16 75% 41%;/);
    expect(css).toMatch(/--accent-strong-foreground: 0 0% 100%;/);
    // Dark needs no correction — mint on near-black is already 11.81:1 — but
    // the pair must EXIST there or the pill falls back to an undefined var.
    const dark = css.slice(css.indexOf(".dark {"));
    expect(dark).toMatch(/--accent-strong:/);
    expect(dark).toMatch(/--accent-strong-foreground:/);
  });

  it("exposes it to Tailwind", () => {
    expect(read("tailwind.config.js")).toMatch(
      /"accent-strong":\s*\{[\s\S]{0,120}hsl\(var\(--accent-strong\)\)/,
    );
  });

  it("keeps the decorative accent where it was", () => {
    // Node dots, borders and the freshness pulse want the brand hue at full
    // chroma; only the label-on-a-solid-fill case needed correcting.
    expect(read("src/App.css")).toMatch(/--accent: 16 75% 55%;/);
  });
});

describe("sticky positioning is possible at all", () => {
  it("does not make <main> a scroll container", () => {
    // Tailwind's overflow-y utility makes overflow-x compute to `auto` too, so
    // `overflow-y-auto` here turned <main> into the scroll container for every
    // descendant — and since its height is content-driven it never scrolls
    // itself, leaving `position: sticky` inside it with nothing to stick to.
    // Measured 2026-09-02: the /data toolbar AND the detail card both computed
    // `position: sticky` and scrolled away with the page; five other components
    // use `sticky top-*` and were affected the same way. `flow-root` keeps the
    // block formatting context without the scroll container.
    const layout = read("src/layout/Layout.tsx");
    expect(layout).toMatch(
      /<main className="min-h-\[100vh\] bg-card flow-root">/,
    );
    expect(layout).not.toMatch(/<main[^>]*overflow-[xy]-(auto|scroll)/);
  });
});

describe("the source cards carry a last-updated footer", () => {
  // Freshness is a property of the REGISTER we poll, so only sources have one:
  // 42 of 46 baked, 43 of 46 once the live data-changes overlay is applied, and
  // the other three get no line rather than an invented date.
  const canvas = () => code("src/screens/components/datamap/DataMapCanvas.tsx");
  const card = () => code("src/screens/components/datamap/DataMapNodeCard.tsx");

  it("shows it on sources only", () => {
    expect(canvas()).toMatch(/n\.kind === "source" && freshAt/);
  });

  it("formats the RESOLVED date, the one the pulse uses", () => {
    // `freshAt` is `freshness.get(n.id) ?? n.freshness` — the live overlay wins
    // over the baked stamp. Formatting `n.freshness` instead would let a card
    // print one date while pulsing about another.
    expect(canvas()).toMatch(/updated:[\s\S]{0,80}formatDate\(freshAt, lang\)/);
    expect(canvas()).not.toMatch(/formatDate\(n\.freshness/);
  });

  it("keeps the greyed line readable", () => {
    // 10px is normal text and needs 4.5:1. `--muted-foreground` on the card is
    // 4.55:1 in light mode, so ANY further fade fails — /80 measured 3.16:1.
    expect(card()).toMatch(
      /text-\[10px\] leading-tight text-muted-foreground"/,
    );
    expect(card()).not.toMatch(/text-muted-foreground\/\d+">/);
  });

  it("names the date for a screen reader", () => {
    // A bare number under a card says nothing without the visual context.
    expect(card()).toMatch(/sr-only">\{updatedLabel\}/);
  });

  it("leaves the +n badge its corner", () => {
    // The badge is absolute bottom-right; without the reserved padding the date
    // would run under it.
    expect(card()).toMatch(/pl-3\.5 pr-8 text-\[10px\]/);
  });
});
