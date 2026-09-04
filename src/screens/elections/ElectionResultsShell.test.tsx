// Render gates for the shared result surface (Phase 0 item 5 + its gate list).
//
// These assert against the RENDERED DOM rather than the source, because every rule they hold is
// about what a reader — or a screen reader — actually gets:
//
//   - the ranked result precedes the map IN THE DOM, so the mobile order and the reading order
//     are the same thing (grid PLACEMENT, never `order`);
//   - every region is a named landmark, and no two share an id;
//   - a map always has a text equivalent, and names the question it answers;
//   - at most four facts and three standouts, one standout per category;
//   - the digest's floor, its order, and the figure/link split;
//   - an absent ballot renders "not held", never a zero.
//
// ⚠ EVERY CAP AND ORDER ASSERTION IS DRIVEN BY AN INPUT THAT VIOLATES IT. Until 2026-09-02 they
// were driven by the fixtures, every one of which already sat inside every bound — so all three
// "the caps hold" assertions passed against a component with no cap at all, and the digest-order
// expectation was satisfied by deleting the sort. A gate that cannot fail is worse than none,
// because it reports the rule as held. Where the input is over the bound, the assertion is
// EQUALITY: `toBeLessThanOrEqual` on an over-cap input is satisfied by rendering nothing.
//
// ⚠ WHAT THESE CANNOT COVER, stated so nobody reads them as more than they are: the axe pass
// and the contrast check are BROWSER assertions and belong to `tests/a11y.spec.ts` (§10.0);
// and §6's real map requirement — that an `interactive` adapter passes both `ariaLabel` and
// `onClick` for every selectable feature — is an ADAPTER gate for Phase 2. The prototype
// renders a placeholder, so there is no map to assert against here.

import { render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { EDGE, REPO_ROOT, SRC_DIR, walk } from "@/../scripts/lib/module_graph";
// The WHOLE corpus — core plus every deferred bundle — so that moving a key into a bundle
// cannot quietly turn an assertion on real copy into one on a raw identifier.
import { bgCorpus as bg } from "@/locales/allKeys";
import { ElectionResultsShell } from "./ElectionResultsShell";
import {
  descriptorFor,
  descriptorCopyKeys,
  type ElectionLevelDescriptor,
} from "./electionSurfaceDescriptors";
import { PLACE_VIEW_META } from "@/screens/components/placeViewMeta";
import {
  CANVAS_GRID_CLASS,
  CANVAS_MAP_SLOT_CLASS,
  CANVAS_RANKED_SLOT_CLASS,
} from "./electionSurfaceLayout";
import {
  ALL_SURFACE_FIXTURES,
  digestAllFourViews,
  digestNoLocalCycle,
  localMunicipalityRunoffSplit,
  localSectionMultipleBallots,
  localSettlementNoMayoralBallot,
  parliamentaryAbroad,
  parliamentaryCountry,
} from "@/data/elections/fixtures/surfaceFixtures";
import type { ElectionSurfaceV1 } from "@/data/elections/surfaceTypes";
import {
  MAX_SURFACE_FACTS,
  MAX_SURFACE_STANDOUTS,
  PLACE_DIGEST_ORDER,
} from "@/data/elections/surfaceTypes";

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "bg",
    fallbackLng: "bg",
    resources: { bg: { translation: bg } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

/** ⚠ THE SHELL RESOLVES LABELS, so it needs the corpora the resolvers read. They are SEEDED,
 *  never fetched — an unstubbed fetch throws in this project's jsdom setup, which is also what
 *  proves the shell issues no request of its own to draw a party name (§5.3, §6.2).
 *
 *  The fixture is deliberately PARTIAL: `p_20` and `gerb` resolve, and every other id in the
 *  fixtures does not — so the "an id that resolves to nothing is shown, not blanked" gate has
 *  something real to fire on. */
const PARTIES = {
  parties: [
    {
      id: "p_20",
      displayName: "ПрБ",
      displayNameEn: "PrB",
      color: "rgb(1,2,3)",
      history: [],
    },
    {
      id: "gerb",
      displayName: "ГЕРБ",
      displayNameEn: "GERB",
      color: "rgb(4,5,6)",
      history: [],
    },
  ],
  byNickName: {},
  consolidationByNickName: {},
};

const draw = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["canonical_parties"], PARTIES);
  qc.setQueryData(["settlements"], []);
  qc.setQueryData(["municipalities"], []);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

/** The level descriptor for a fixture, already narrowed. Every fixture in the set is an
 *  available kind × level; the throw is what stops that assumption going silent. */
const levelOf = (s: ElectionSurfaceV1): ElectionLevelDescriptor => {
  const d = descriptorFor(s.kind, s.place.level);
  if (!d.available)
    throw new Error(`${s.kind}/${s.place.level} is unavailable`);
  return d;
};

describe("shell — DOM order is the mobile order", () => {
  it("puts the ranked result BEFORE the map in the DOM", () => {
    // ⚠ The rule §2 decision 7 states. A `lg:col-start-1` on the map is what moves it left on
    // desktop; using CSS `order` instead would make the screen and the reading order disagree.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const canvas = container.querySelector("[data-outcome-canvas]")!;
    const slots = [...canvas.querySelectorAll("[data-canvas-slot]")].map((n) =>
      n.getAttribute("data-canvas-slot"),
    );
    expect(slots).toEqual(["ranked", "map"]);
  });

  it("never uses CSS `order` to rearrange the canvas", () => {
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const canvas = container.querySelector("[data-outcome-canvas]")!;
    for (const el of [canvas, ...canvas.querySelectorAll("*")])
      expect(
        el.className.toString(),
        "an `order-*` class would decouple the visual order from the DOM",
      )
        // ⚠ `order-[3]` is what someone reaching past `order-12` writes, and Tailwind's
        // arbitrary syntax escaped the previous `\border-\d` form entirely. No word boundary
        // between `b` and `order`, so `border` still does not match.
        .not.toMatch(/\border-(?:\d|\[|first\b|last\b)/);
  });

  it("gives the map a text equivalent in the same section", () => {
    // §2 decision 8: a map always has a complete text/list equivalent, and colour is never the
    // only encoding. The ranked result is that equivalent.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const canvas = container.querySelector("[data-outcome-canvas]")!;
    expect(canvas.querySelector("[data-canvas-slot='map']")).toBeTruthy();
    expect(canvas.querySelector("[data-ranked-result]")).toBeTruthy();
  });

  it("names the question every rendered map answers", () => {
    // A map region announcing nothing is not "a map with a text equivalent", it is an empty
    // div beside a table — so the declared `questionKey` is what makes §2 decision 8 checkable.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const maps = [...container.querySelectorAll("[data-canvas-slot='map']")];
    expect(maps.length).toBeGreaterThan(0);
    for (const m of maps) {
      const q = m.querySelector("[data-map-question]");
      expect(q, "a map slot with no declared question").toBeTruthy();
      expect(q!.textContent?.trim()).not.toBe("");
    }
  });

  it("names the BALLOT every map colours, on a multi-ballot surface", () => {
    // §2 decision 9: a map that cannot name its ballot leaves a reader unable to tell mayor
    // control from council support.
    const multi = Object.entries(ALL_SURFACE_FIXTURES).filter(
      ([, s]) => s.ballots.filter((b) => b.map).length > 1,
    );
    // Non-vacuity: "no multi-ballot fixture exists" must never read as "the rule holds".
    expect(
      multi.length,
      "no multi-ballot-with-map fixture to test",
    ).toBeGreaterThan(0);
    for (const [name, s] of multi) {
      const { container } = draw(<ElectionResultsShell surface={s} />);
      const named = [...container.querySelectorAll("[data-map-ballot]")].map(
        (n) => n.getAttribute("data-map-ballot"),
      );
      expect(named.length, name).toBe(s.ballots.filter((b) => b.map).length);
      for (const v of named)
        expect(v, `${name}: unnamed map ballot`).toBeTruthy();
    }
  });

  it("draws no map at a polling section, and still ranks the result", () => {
    const { container } = draw(
      <ElectionResultsShell surface={localSectionMultipleBallots} />,
    );
    expect(container.querySelector("[data-canvas-slot='map']")).toBeNull();
    expect(container.querySelectorAll("[data-ranked-result]").length).toBe(2);
  });
});

describe("shell — landmarks and headings", () => {
  // ⚠ EVERY FIXTURE, not the one that happens to render every region. Driven by
  // `localMunicipalityRunoffSplit` alone, these two never reached the `empty` region — the one
  // whose entire job is the "not held here" message.
  it.each(Object.entries(ALL_SURFACE_FIXTURES))(
    "names every region it renders — %s",
    (_name, surface) => {
      const { container } = draw(
        <ElectionResultsShell surface={surface} digest={digestAllFourViews} />,
      );
      const regions = [...container.querySelectorAll("section")];
      expect(regions.length).toBeGreaterThan(0);
      for (const r of regions)
        expect(
          r.getAttribute("aria-labelledby"),
          `an unnamed region: ${r.getAttribute("data-surface-region")}`,
        ).toBeTruthy();
    },
  );

  it.each(Object.entries(ALL_SURFACE_FIXTURES))(
    "points every aria-labelledby at a heading that exists — %s",
    (_name, surface) => {
      // An aria-labelledby referencing a missing node names the section "" rather than leaving
      // it unnamed, which is worse — it looks named to a checker and is silent to a reader.
      const { container } = draw(
        <ElectionResultsShell surface={surface} digest={digestAllFourViews} />,
      );
      for (const r of container.querySelectorAll("section")) {
        const id = r.getAttribute("aria-labelledby")!;
        expect(container.querySelector(`#${CSS.escape(id)}`), id).toBeTruthy();
      }
    },
  );

  it("covers every region the shell can emit, across the fixture set", () => {
    // Otherwise "names every region it renders" is satisfied by a fixture set that reaches
    // only three of them.
    const seen = new Set<string>();
    for (const surface of Object.values(ALL_SURFACE_FIXTURES)) {
      const { container } = draw(
        <ElectionResultsShell surface={surface} digest={digestAllFourViews} />,
      );
      for (const r of container.querySelectorAll("[data-surface-region]"))
        seen.add(r.getAttribute("data-surface-region")!);
    }
    for (const region of [
      "scope",
      "digest",
      "facts",
      "canvas",
      "empty",
      "standouts",
      "source",
    ])
      expect([...seen], `no fixture renders the ${region} region`).toContain(
        region,
      );
  });

  it("gives every heading a unique id, including two rounds of one ballot", () => {
    // ⚠ THE CASE THE CORPUS ACTUALLY PRODUCES. A runoff municipality carries the same ballot
    // KIND on two rounds; with the round only in the React key both sections announced the
    // round-1 heading, and a `querySelector`-based check reported the reference as resolved
    // because it returns the FIRST of the duplicates.
    const mayor = localMunicipalityRunoffSplit.ballots.find(
      (b) => b.kind === "municipality_mayor",
    )!;
    const twoRounds: ElectionSurfaceV1 = {
      ...localMunicipalityRunoffSplit,
      ballots: [
        { ...mayor, round: 1 },
        { ...mayor, round: 2 },
      ],
    };
    const { container } = draw(<ElectionResultsShell surface={twoRounds} />);
    const ids = [...container.querySelectorAll("[id]")].map((n) => n.id);
    expect(ids.length).toBeGreaterThan(3);
    expect(new Set(ids).size, `duplicate ids: ${ids.join(", ")}`).toBe(
      ids.length,
    );
  });

  it("scopes its ids so two shells on one page do not collide", () => {
    // §4.1's premise is that a reader wants this place's parliamentary AND local result, so
    // two shells is the expected case — and `document.getElementById` resolves to the first.
    const { container } = draw(
      <>
        <ElectionResultsShell surface={parliamentaryCountry} />
        <ElectionResultsShell surface={localMunicipalityRunoffSplit} />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((n) => n.id);
    expect(
      new Set(ids).size,
      `duplicate ids across shells: ${ids.join(", ")}`,
    ).toBe(ids.length);
  });

  it("renders no h1 — the page's heading belongs to PlaceHeader", () => {
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(0);
  });

  it("gives the ranked table a caption and row headers", () => {
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const table = container.querySelector("table")!;
    expect(
      within(table as HTMLElement).getByRole("caption", { hidden: true }),
    ).toBeTruthy();
    expect(table.querySelectorAll("th[scope='col']").length).toBeGreaterThan(1);
    expect(table.querySelectorAll("th[scope='row']").length).toBeGreaterThan(0);
  });
});

describe("shell — the caps hold at render time", () => {
  it("shows at most four facts when the surface offers more", () => {
    const over: ElectionSurfaceV1 = {
      ...parliamentaryCountry,
      facts: [
        ...parliamentaryCountry.facts,
        {
          code: "valid_votes",
          value: 3_240_000,
          unit: "votes",
          basis: "valid_votes",
        },
        {
          code: "votes_cast",
          value: 3_300_000,
          unit: "votes",
          basis: "votes_cast",
        },
        { code: "wasted_vote", value: 8.1, unit: "pct", basis: "valid_votes" },
      ],
    };
    const { container } = draw(<ElectionResultsShell surface={over} />);
    // EQUALITY — the input is over the cap by construction, so `<=` would be satisfied by a
    // component that renders no facts at all.
    expect(container.querySelectorAll("[data-fact]")).toHaveLength(
      MAX_SURFACE_FACTS,
    );
  });

  it("shows at most three standouts when the surface offers more", () => {
    // ⚠ THE CAP WAS UNENFORCED until 2026-09-02 and this assertion passed anyway, because no
    // fixture carries more than two. A standout is a review LEAD about a named place; an
    // uncapped list is the shape in which a generator bug publishes ten under a heading that
    // promises three.
    const base = localMunicipalityRunoffSplit.standouts;
    const over: ElectionSurfaceV1 = {
      ...localMunicipalityRunoffSplit,
      standouts: [0, 1, 2, 3, 4].map((i) => ({
        ...base[i % base.length],
        id: `over-${i}`,
        // distinct categories, so this measures the COUNT cap rather than the per-category one
        category: (["outcome", "participation", "review"] as const)[i % 3],
      })),
    };
    const { container } = draw(<ElectionResultsShell surface={over} />);
    expect(container.querySelectorAll("[data-standout]")).toHaveLength(
      MAX_SURFACE_STANDOUTS,
    );
  });

  it("shows at most ONE standout per category (§7)", () => {
    // A blind `.slice(0, 3)` satisfies the count cap and not this one, so a place with three
    // close contests would spend the whole strip on one signal.
    const base = localMunicipalityRunoffSplit.standouts[0];
    const over: ElectionSurfaceV1 = {
      ...localMunicipalityRunoffSplit,
      standouts: [0, 1, 2, 3].map((i) => ({
        ...base,
        id: `same-cat-${i}`,
        category: "outcome" as const,
      })),
    };
    const { container } = draw(<ElectionResultsShell surface={over} />);
    expect(container.querySelectorAll("[data-standout]")).toHaveLength(1);
  });

  it("truncates at the LEVEL's maxFacts where that bound actually binds", () => {
    // ⚠ THE LEVEL PICKED HERE IS THE POINT. The bound only binds where the level's own
    // `factPriority` is LONGER than its `maxFacts`; on a level where the two coincide, the
    // priority filter alone caps the strip and this assertion would pass against a component
    // with no slice at all. parliamentary/country declares 6 priorities against 4 facts.
    const level = levelOf(parliamentaryCountry);
    expect(
      level.factPriority.length,
      "this level no longer over-declares, so the cap is untestable through it",
    ).toBeGreaterThan(level.maxFacts);
    // Offer every priority the level declares, so only the cap can cut the list down.
    const over: ElectionSurfaceV1 = {
      ...parliamentaryCountry,
      facts: level.factPriority.map((code) => ({
        code,
        value: 1,
        unit: "count" as const,
      })),
    };
    const { container } = draw(<ElectionResultsShell surface={over} />);
    expect(container.querySelectorAll("[data-fact]")).toHaveLength(
      level.maxFacts,
    );
  });

  it("bounds a section at its own priority list, which is shorter than the global cap", () => {
    // ⚠ WHAT THIS CAN AND CANNOT PROVE, stated rather than implied. local/section declares
    // maxFacts 3 AND exactly three priorities, so the two bounds are indistinguishable from
    // the outside: replacing `level.maxFacts` with the literal 4 leaves this green. It is the
    // only level in the matrix below the global cap, so today NO input separates "the level's
    // maxFacts" from "the global cap". What is provable — and what fails if the priority
    // FILTER is removed — is that a section never renders a fact its level does not declare.
    const level = levelOf(localSectionMultipleBallots);
    expect(level.maxFacts).toBeLessThan(MAX_SURFACE_FACTS);
    const over: ElectionSurfaceV1 = {
      ...localSectionMultipleBallots,
      facts: [
        ...localSectionMultipleBallots.facts,
        { code: "votes_cast", value: 207, unit: "votes", basis: "votes_cast" },
        {
          code: "turnout",
          value: 36.06,
          unit: "pct",
          basis: "registered_voters",
        },
        {
          code: "margin",
          value: 12.44,
          unit: "pct_point",
          basis: "valid_votes",
        },
      ],
    };
    const { container } = draw(<ElectionResultsShell surface={over} />);
    const codes = [...container.querySelectorAll("[data-fact]")].map((n) =>
      n.getAttribute("data-fact"),
    );
    expect(codes).toHaveLength(level.maxFacts);
    expect(codes).not.toContain("turnout"); // offered, not declared at this level
    expect(codes).not.toContain("margin");
  });

  it("renders a separate canvas per ballot, never merged", () => {
    // §2 decision 4: mayor and council are two answers with two denominators.
    const { container } = draw(
      <ElectionResultsShell surface={localMunicipalityRunoffSplit} />,
    );
    const canvases = [...container.querySelectorAll("[data-outcome-canvas]")];
    expect(canvases.map((c) => c.getAttribute("data-outcome-canvas"))).toEqual([
      "municipality_mayor",
      "municipal_council",
    ]);
  });
});

describe("shell — the level's descriptor governs what is drawn", () => {
  it.each(Object.entries(ALL_SURFACE_FIXTURES))(
    "renders no fact outside the level's own factPriority — %s",
    (name, surface) => {
      const level = levelOf(surface);
      const { container } = draw(<ElectionResultsShell surface={surface} />);
      const codes = [...container.querySelectorAll("[data-fact]")].map((n) =>
        n.getAttribute("data-fact"),
      );
      for (const c of codes)
        expect(level.factPriority, `${name} renders ${c}`).toContain(c);
    },
  );

  it("orders the facts by the level's priority, not the producer's order", () => {
    // The producer's emission order decided which facts a level showed until 2026-09-02.
    const level = levelOf(parliamentaryCountry);
    const reversed: ElectionSurfaceV1 = {
      ...parliamentaryCountry,
      facts: [...parliamentaryCountry.facts].reverse(),
    };
    const codes = (s: ElectionSurfaceV1) =>
      [
        ...draw(
          <ElectionResultsShell surface={s} />,
        ).container.querySelectorAll("[data-fact]"),
      ].map((n) => n.getAttribute("data-fact")!);
    const shown = codes(reversed);
    expect(shown).toEqual(codes(parliamentaryCountry));
    // …and that order really is the descriptor's.
    expect(shown).toEqual(
      [...shown].sort(
        (a, b) =>
          level.factPriority.indexOf(a as never) -
          level.factPriority.indexOf(b as never),
      ),
    );
  });

  it.each(Object.entries(ALL_SURFACE_FIXTURES))(
    "draws exactly the level's declared ranked columns — %s",
    (name, surface) => {
      const level = levelOf(surface);
      const { container } = draw(<ElectionResultsShell surface={surface} />);
      for (const table of container.querySelectorAll("[data-ranked-result]")) {
        const cols = [...table.querySelectorAll("th[data-ranked-col]")].map(
          (n) => n.getAttribute("data-ranked-col"),
        );
        expect(cols, name).toEqual([...level.rankedColumns]);
      }
    },
  );

  it("says who was elected on a runoff, rather than leaving it to be inferred", () => {
    // The substantive loss when `rankedColumns` was ignored: the table showed 53.94% against
    // 43.95% and never said which of the two took the mayoralty.
    const level = levelOf(localMunicipalityRunoffSplit);
    expect(level.rankedColumns).toContain("elected");
    const { container } = draw(
      <ElectionResultsShell surface={localMunicipalityRunoffSplit} />,
    );
    const mayor = container.querySelector(
      "[data-ranked-result='municipality_mayor']",
    )!;
    const marked = [
      ...mayor.querySelectorAll("td[data-ranked-cell='elected']"),
    ].filter((n) => (n.textContent ?? "").trim() !== "");
    expect(marked, "no row is marked elected on a decided runoff").toHaveLength(
      1,
    );
    // …and it is the winner's row, not merely some row.
    const winner = localMunicipalityRunoffSplit.ballots
      .find((b) => b.kind === "municipality_mayor")!
      .preview.find((r) => r.isElected)!;
    expect(marked[0].closest("tr")!.textContent).toContain(
      winner.candidateName,
    );
  });
});

describe("shell — absence is not zero", () => {
  it("says an office was not elected here rather than showing zeroes", () => {
    const { container } = draw(
      <ElectionResultsShell surface={localSettlementNoMayoralBallot} />,
    );
    // ⚠ STRUCTURAL, not a prose regex. The previous form matched `/\b0\s*(гласа|votes)\b/i`,
    // which this component cannot emit under any input: the value and the unit live in
    // separate cells (so `textContent` yields `p_15100.00%`), and the corpus word is
    // `Гласове`. It asserted nothing.
    expect(container.querySelector("[data-empty-state]")).toBeTruthy();
    expect(container.querySelectorAll("[data-outcome-canvas]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-ranked-result]")).toHaveLength(0);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    // …and the copy is the LEVEL's own, not a shared "no data" string.
    expect(container.querySelector("[data-empty-state]")!.textContent).toBe(
      bg[levelOf(localSettlementNoMayoralBallot).emptyStateKey],
    );
  });

  it("renders the DESCRIPTOR's reason on a kind × level that does not exist", () => {
    // `local` × `abroad`: local elections are not held abroad. The shell hardcoded the one
    // reason key that exists today, so the second `available: false` entry added to the matrix
    // would have rendered the wrong reason at a 200.
    const d = descriptorFor("local", "abroad");
    expect(d.available).toBe(false);
    const surface: ElectionSurfaceV1 = {
      ...localSettlementNoMayoralBallot,
      place: { ...localSettlementNoMayoralBallot.place, level: "abroad" },
      facts: [],
      ballots: [],
    };
    const { container } = draw(<ElectionResultsShell surface={surface} />);
    expect(container.querySelector("[data-empty-state]")!.textContent).toBe(
      bg[(d as { available: false; reasonKey: string }).reasonKey],
    );
    // An unavailable level has no maxFacts, so it must not render a named but empty strip.
    expect(container.querySelector("[data-surface-region='facts']")).toBeNull();

    // ⚠ THE DOM CANNOT SEPARATE THESE TWO IMPLEMENTATIONS TODAY, so the source must. There is
    // exactly one `available: false` entry in the matrix, so hardcoding its reason renders the
    // identical string and every assertion above stays green; the SECOND entry added would
    // render the first one's reason at a 200. This is what fails in the meantime.
    const shellSrc = stripComments(
      fs.readFileSync(
        path.join(SRC_DIR, "screens/elections/ElectionResultsShell.tsx"),
        "utf8",
      ),
    );
    expect(
      shellSrc.match(/"election_unavailable_[a-z_]+"/g) ?? [],
      "the shell names an unavailable reason as a literal — read descriptor.reasonKey",
    ).toEqual([]);
  });

  it("publishes no turnout figure abroad", () => {
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryAbroad} />,
    );
    const facts = [...container.querySelectorAll("[data-fact]")].map((n) =>
      n.getAttribute("data-fact"),
    );
    expect(facts).not.toContain("turnout");
    // …and it still says how many people voted.
    expect(facts).toContain("votes_cast");
  });
});

describe("shell — a standout carries its baseline", () => {
  it("states what every claim is measured against", () => {
    // §7 forbids emitting a standout whose baseline is missing — which is why
    // `ElectionStandout.baseline` is not optional — and dropping it at render publishes a
    // review lead about a named municipality with its measurement withheld.
    const { container } = draw(
      <ElectionResultsShell surface={localMunicipalityRunoffSplit} />,
    );
    const items = [...container.querySelectorAll("[data-standout]")];
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) {
      expect(li.getAttribute("data-standout-baseline")).toBeTruthy();
      const basis = li.querySelector("[data-standout-basis]");
      expect(basis, "a standout with no rendered baseline").toBeTruthy();
      expect(basis!.textContent?.trim()).not.toBe("");
    }
  });
});

describe("shell — the place digest", () => {
  it("renders one cell per reachable view, in PlaceViewNav's order", () => {
    // ⚠ SHUFFLED AT THE CALL SITE. `digestAllFourViews` is authored in order, so the previous
    // form was satisfied by deleting the sort outright.
    const shuffled = [3, 1, 0, 2].map((i) => digestAllFourViews[i]);
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} digest={shuffled} />,
    );
    const cells = [...container.querySelectorAll("[data-digest-cell]")].map(
      (n) => n.getAttribute("data-digest-cell"),
    );
    // Derived from the constant, so the two cannot drift apart silently.
    expect(cells).toEqual([...PLACE_DIGEST_ORDER]);
  });

  it("drops the cell for the view the reader is already on (§7.1)", () => {
    const { container } = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestAllFourViews}
        currentView="parliamentary"
      />,
    );
    const cells = [...container.querySelectorAll("[data-digest-cell]")].map(
      (n) => n.getAttribute("data-digest-cell"),
    );
    expect(cells).not.toContain("parliamentary");
    expect(cells).toHaveLength(3);
  });

  it("renders NO number in a link cell", () => {
    // §4.1/§5.1: Управление and Потребление have no bucket producer, so their cells make no
    // claim. A number appearing here would be one nothing can keep current.
    const { container } = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestAllFourViews}
      />,
    );
    const links = [...container.querySelectorAll("[data-digest-kind='link']")];
    // Non-vacuity: a zero-length NodeList passes every loop body ever written.
    expect(links.length).toBe(
      digestAllFourViews.filter((c) => c.kind === "link").length,
    );
    for (const cell of links)
      expect(
        cell.textContent ?? "",
        `${cell.getAttribute("data-digest-cell")} shows a number`,
      ).not.toMatch(/\d/);
  });

  it("renders a number in every figure cell", () => {
    const { container } = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestAllFourViews}
      />,
    );
    const figures = [
      ...container.querySelectorAll("[data-digest-kind='figure']"),
    ];
    expect(figures.length).toBe(
      digestAllFourViews.filter((c) => c.kind === "figure").length,
    );
    // The parliamentary cell shows a share; the local cell shows the mayor's name, which is
    // the fact that view leads with — so only the former is asserted numeric.
    const parl = figures.find(
      (f) => f.getAttribute("data-digest-cell") === "parliamentary",
    )!;
    expect(parl.textContent).toMatch(/\d/);
  });

  it("renders NOTHING below the two-cell floor", () => {
    // §4.1: one or two cells in a four-column grid restate the pills directly above them.
    const { container } = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestNoLocalCycle}
        currentView="parliamentary"
      />,
    );
    // 3 cells minus the current view = 2, which is exactly the floor — still rendered.
    expect(container.querySelectorAll("[data-digest-cell]")).toHaveLength(2);

    const single = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestNoLocalCycle.slice(0, 2)}
        currentView="parliamentary"
      />,
    );
    // 2 cells minus the current view = 1, below the floor — no digest at all.
    expect(
      single.container.querySelectorAll("[data-digest-cell]"),
    ).toHaveLength(0);
  });

  it("omits the digest entirely when none is supplied", () => {
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    expect(
      container.querySelector("[data-surface-region='digest']"),
    ).toBeNull();
  });

  it("omits the digest on a SECTION even when one is handed to it (§4.1)", () => {
    // ⚠ ENFORCED IN THE COMPONENT, not left to the caller. "Every call site remembers" is not
    // a rule anything can fail on — and this suite was itself passing a digest to the section
    // fixture, i.e. rendering the thing the plan forbids.
    const { container } = draw(
      <ElectionResultsShell
        surface={localSectionMultipleBallots}
        digest={digestAllFourViews}
      />,
    );
    expect(
      container.querySelector("[data-surface-region='digest']"),
    ).toBeNull();
  });
});

describe("shell — no raw identifier reaches the DOM", () => {
  /** Every key the shell can name — the descriptors' whole vocabulary plus the view labels the
   *  digest reuses. DERIVED rather than a restated prefix: the previous regex guarded
   *  `place_view_*`, a prefix nothing emits (the digest renders `cross_to_*`), so a pruned view
   *  label would have rendered as visible text with the gate still green. */
  const NAMEABLE = [
    ...descriptorCopyKeys(),
    ...Object.values(PLACE_VIEW_META).map((m) => m.labelKey),
  ];

  it("has a non-empty set of keys to look for", () => {
    expect(NAMEABLE.length).toBeGreaterThan(40);
    expect(NAMEABLE).toContain("cross_to_governance");
  });

  it.each(Object.entries(ALL_SURFACE_FIXTURES))(
    "renders no untranslated i18n key — %s",
    (name, surface) => {
      // A missing key renders as its own identifier at a 200 — the `votes_outcome_undefined`
      // shape. Every key this shell names must resolve in the loaded corpus.
      const { container } = draw(
        <ElectionResultsShell surface={surface} digest={digestAllFourViews} />,
      );
      const text = container.textContent ?? "";
      for (const k of NAMEABLE)
        expect(text, `${name} renders the raw key ${k}`).not.toContain(k);
      // An unresolved PLACEHOLDER is the same failure one layer down, and the key regex cannot
      // see it: `labelParams` is declared, populated by the fixtures and passed to `t()`, so
      // the first `{{…}}` added to the copy would otherwise ship as literal braces.
      expect(text, `${name} renders an unresolved placeholder`).not.toMatch(
        /\{\{\s*\w+\s*\}\}/,
      );
    },
  );
});

describe("shell — the vendor-chunk rule (§Phase 2 item 4)", () => {
  // The shell must not import Leaflet, d3 or recharts: it is what keeps the section route —
  // which draws no map at all — off the heavy vendor chunks (§10.1). The rule was documented
  // in the file header and guarded by nothing, and the file that documents it is not the file
  // a Phase 2 adapter author will edit.
  //
  // `walk` resolves only relative and `@/` specifiers — a bare `leaflet` resolves to null and
  // is dropped — so the closure gives the local modules and the bare specifiers are read back
  // out of each one.
  const FORBIDDEN = [
    "leaflet",
    "react-leaflet",
    "d3",
    "recharts",
    "react-d3-library",
  ];
  const entry = path.join(
    SRC_DIR,
    "screens/elections/ElectionResultsShell.tsx",
  );
  const { seen } = walk([entry]);

  const bareSpecs = new Map<string, string[]>();
  for (const file of seen) {
    const src = stripComments(fs.readFileSync(file, "utf8"), {
      trailing: true,
    });
    for (const m of src.matchAll(EDGE)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".") || spec.startsWith("@/")) continue;
      bareSpecs.set(spec, [
        ...(bareSpecs.get(spec) ?? []),
        path.relative(REPO_ROOT, file),
      ]);
    }
  }

  it("walks a graph that is actually there", () => {
    // Both halves are "X is absent", which an empty walk satisfies perfectly.
    expect(seen.size, "the shell's import closure is empty").toBeGreaterThan(2);
    expect([...seen].map((f) => path.relative(REPO_ROOT, f))).toContain(
      "src/screens/elections/electionSurfaceDescriptors.ts",
    );
    expect(
      [...bareSpecs.keys()],
      "no bare specifier found — the extractor is broken",
    ).toContain("react-i18next");
  });

  it.each(FORBIDDEN)("does not reach %s", (pkg) => {
    const hits = [...bareSpecs.entries()].filter(
      ([spec]) => spec === pkg || spec.startsWith(`${pkg}/`),
    );
    expect(
      hits.map(([spec, files]) => `${spec} <- ${files.join(", ")}`),
      `${pkg} is in the shell's static import graph — §Phase 2 item 4`,
    ).toEqual([]);
  });
});

describe("labels are resolved from ids at render time (§5.3)", () => {
  it("names the party in the ranked result instead of printing its id", () => {
    // ⚠ THE WHOLE POINT OF STORING AN ID. Until this wiring the row header WAS the id — the
    // component's own comment said "the prototype shows the id" — so every ranked table on the
    // site would have read „p_20  1 234 567  38.04%".
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const first = container.querySelector(
      "[data-ranked-result] tbody th",
    ) as HTMLElement;
    expect(first.textContent).toBe("ПрБ");
    expect(first.textContent).not.toMatch(/^p_/);
    expect(first.getAttribute("data-entry-kind")).toBe("party");
  });

  it("SHOWS an id it cannot resolve rather than blanking the row", () => {
    // ⚠ THE ROW STILL CARRIES A REAL VOTE COUNT, so an empty header attributes a percentage to
    // nobody. `p_6` is deliberately absent from this file's party fixture.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const headers = [
      ...container.querySelectorAll("[data-ranked-result] tbody th"),
    ];
    const unresolved = headers.filter(
      (h) => h.getAttribute("data-entry-kind") === "unresolved",
    );
    expect(unresolved.length).toBeGreaterThan(0);
    for (const h of unresolved) expect(h.textContent).not.toBe("");
  });

  it("prints a local-only list's own Bulgarian name, in both languages", () => {
    // §5.3's second deliberate exception: no English form of a purely local list exists
    // anywhere in the corpus, so it renders unchanged and un-transliterated.
    const surface: ElectionSurfaceV1 = {
      ...parliamentaryCountry,
      ballots: [
        {
          ...parliamentaryCountry.ballots[0],
          preview: [
            {
              partyId: null,
              localPartyName: "Движение заедно за промяна",
              votes: 100,
              pct: 50,
            },
          ],
        },
      ],
    };
    const { container } = draw(<ElectionResultsShell surface={surface} />);
    const th = container.querySelector(
      "[data-ranked-result] tbody th",
    ) as HTMLElement;
    expect(th.textContent).toBe("Движение заедно за промяна");
    expect(th.getAttribute("data-entry-kind")).toBe("local_list");
  });

  it("names the winner in the parliamentary digest cell", () => {
    // „46.28%" with no subject is a number a reader cannot use — §4.1's cell is „who won here".
    const { container } = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestAllFourViews}
      />,
    );
    const cell = container.querySelector(
      '[data-digest-cell="parliamentary"]',
    ) as HTMLElement;
    expect(
      within(cell).getByText("ПрБ", { selector: "[data-digest-winner]" }),
    ).toBeTruthy();
  });

  it("claims NO party for the mayor, because the artifact cannot establish one", () => {
    // ⚠ A GATE AGAINST A LINE THAT LOOKS OBVIOUS AND IS UNSUPPORTABLE. `mayorPartyId` is null
    // for an independent AND for a local-only list, and the digest cell carries no name for the
    // second — so „Независим" under a local list's mayor would be this component inventing the
    // distinction the artifact cannot make, about a named person.
    const { container } = draw(
      <ElectionResultsShell
        surface={parliamentaryCountry}
        digest={digestAllFourViews}
      />,
    );
    const cell = container.querySelector(
      '[data-digest-cell="local"]',
    ) as HTMLElement;
    expect(cell.querySelector("[data-digest-mayor-party]")).toBeNull();
    expect(cell.textContent).toContain("Костадин Димитров Димитров");
    expect(cell.textContent).not.toContain(bg.election_independent);
  });
});

describe("the canvas layout has ONE definition (Phase 2 item 5)", () => {
  it("renders the shared grid, so the skeleton cannot drift from it", () => {
    // ⚠ "No layout shift when the map arrives" is only true if the skeleton and the content
    // declare the same layout. A literal restated here would be correct on the day it is
    // written and would drift the first time a column ratio moves — invisibly, because both
    // files still read like a two-column grid.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const canvas = container.querySelector("[data-outcome-canvas]")!;
    for (const cls of CANVAS_GRID_CLASS.split(" "))
      expect(canvas.className, cls).toContain(cls);
    expect(
      container.querySelector('[data-canvas-slot="ranked"]')!.className,
    ).toContain(CANVAS_RANKED_SLOT_CLASS);
    expect(
      container.querySelector('[data-canvas-slot="map"]')!.className,
    ).toContain(CANVAS_MAP_SLOT_CLASS);
  });
});

describe("the scope has ONE home per page (§4 item 1)", () => {
  it("draws the cycle and status by default", () => {
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} />,
    );
    const scope = container.querySelector('[data-surface-region="scope"]')!;
    expect(scope).toBeTruthy();
    // The cycle is a formatted date, never the folder id — the defect that reached 31 surfaces.
    expect(scope.textContent).not.toContain("2026_04_19");
    expect(scope.querySelector("[data-scope-cycle]")).toBeTruthy();
  });

  it("draws NONE when the header carries it", () => {
    // ⚠ §4 COMPOSES THE SCOPE INTO `PlaceHeader`, beside the view pills. A shell that also drew
    // it would print the same two words twice on one screen and stack a second control row
    // under the pills — the exact arrangement §4 rules out, and one that looks fine in
    // isolation because each half is correct.
    const { container } = draw(
      <ElectionResultsShell surface={parliamentaryCountry} scope="header" />,
    );
    expect(container.querySelector('[data-surface-region="scope"]')).toBeNull();
    // …and nothing else in the shell is lost with it.
    expect(container.querySelector("[data-outcome-canvas]")).toBeTruthy();
    expect(
      container.querySelector('[data-surface-region="facts"]'),
    ).toBeTruthy();
  });
});

describe("§8's complete-result leaf", () => {
  // ⚠ IT WAS GENERATED, SCHEMA-GATED AND PUBLISHED SINCE PHASE 1 WITH NO CONSUMER. `destinations`
  // rode on every artifact and nothing read it, which is why the defect below could not be seen:
  // 8,704 artifacts across both kinds carried `completeResult` pointing at their OWN route with
  // `available: true` — every region, abroad, município, country and settlement. A payload nobody
  // renders cannot look wrong.

  const withDest = (
    surface: typeof parliamentaryCountry,
    completeResult: { to: string; available: boolean; reason?: string },
  ) =>
    ({
      ...surface,
      destinations: { ...surface.destinations, completeResult },
    }) as typeof parliamentaryCountry;

  it("renders the link when the destination is a DIFFERENT page", () => {
    const { container } = draw(
      <ElectionResultsShell
        surface={withDest(parliamentaryCountry, {
          to: "/sections/02676",
          available: true,
        })}
      />,
    );
    const leaf = container.querySelector("[data-surface-complete-result]")!;
    expect(leaf.getAttribute("href")).toBe("/sections/02676");
    expect(leaf.textContent).toBe(bg.election_complete_result_link);
  });

  it("renders NOTHING for `same_page` — the one reason a reader can already see", () => {
    // ⚠ THE EXCEPTION TO §5's "`available: false` IS A RENDERED STATE". Every other reason tells
    // the reader something they cannot work out from the page; „the complete result is on this
    // page" tells them only what is in front of them.
    const { container } = draw(
      <ElectionResultsShell
        surface={withDest(parliamentaryCountry, {
          to: "",
          available: false,
          reason: "same_page",
        })}
      />,
    );
    expect(
      container.querySelector("[data-surface-complete-result]"),
    ).toBeNull();
  });

  it("STATES the other reasons rather than dropping them", () => {
    // The discriminating half: without it, "render nothing when unavailable" passes the test
    // above and silently swallows „no data for this place" too.
    const { container } = draw(
      <ElectionResultsShell
        surface={withDest(parliamentaryCountry, {
          to: "",
          available: false,
          reason: "no_data_for_place",
        })}
      />,
    );
    const none = container.querySelector(
      '[data-surface-complete-result="none"]',
    )!;
    expect(none.textContent).toBe(bg.election_unavailable_no_data_for_place);
  });

  it("never renders an anchor with an empty href", () => {
    // `available: true` with an empty `to` is not a shape the generator emits, but the render
    // rule must not depend on that — an `<a href="">` reloads the current page.
    const { container } = draw(
      <ElectionResultsShell
        surface={withDest(parliamentaryCountry, { to: "", available: true })}
      />,
    );
    expect(
      container.querySelector("a[data-surface-complete-result]"),
    ).toBeNull();
  });
});
