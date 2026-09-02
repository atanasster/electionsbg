import { describe, expect, it } from "vitest";
import {
  dataMapClosure,
  dataMapLinkNeighbours,
  dataMapView,
  DATA_MAP_KEY_COLOR,
  type DataMapEdge,
  type DataMapLink,
  type DataMapManifest,
  type DataMapNode,
} from "./useDataMap";

describe("dataMapClosure", () => {
  // The closure highlight means "where this data comes from and goes". Lateral
  // links are a different relationship and must never widen it — feeding 18 of
  // them in would light up roughly half the graph on any selection, and the
  // highlight would stop meaning anything.
  const lineage: DataMapEdge[] = [
    { id: "e0", from: "src:a", to: "ds:one" },
    { id: "e1", from: "ds:one", to: "f:x" },
    { id: "e2", from: "src:b", to: "ds:two" },
    { id: "e3", from: "ds:two", to: "f:y" },
  ];

  it("walks lineage in both directions", () => {
    expect([...dataMapClosure(lineage, "ds:one")].sort()).toEqual([
      "ds:one",
      "f:x",
      "src:a",
    ]);
  });

  it("does not connect two datasets that only share a lateral link", () => {
    // ds:one and ds:two are linked laterally in the manifest, but that link is
    // NOT in `edges` — so the closure must keep them apart.
    const c = dataMapClosure(lineage, "ds:one");
    expect(c.has("ds:two")).toBe(false);
    expect(c.has("f:y")).toBe(false);
  });

  it("would widen if a lateral edge leaked into the lineage array", () => {
    // Pins the consequence, so the guarantee above is not vacuous.
    const leaked = [
      ...lineage,
      { id: "x", from: "ds:one", to: "ds:two" } as DataMapEdge,
    ];
    expect(dataMapClosure(leaked, "ds:one").has("f:y")).toBe(true);
  });
});

describe("dataMapLinkNeighbours", () => {
  const links: DataMapLink[] = [
    {
      id: "1",
      a: "ds:a",
      b: "ds:b",
      kind: "join",
      key: "eik",
      label: { bg: "", en: "" },
    },
    {
      id: "2",
      a: "ds:b",
      b: "ds:c",
      kind: "join",
      key: "ekatte",
      label: { bg: "", en: "" },
    },
    {
      id: "3",
      a: "ds:c",
      b: "ds:d",
      kind: "boundary",
      label: { bg: "", en: "" },
    },
  ];

  it("returns ONE hop, never a transitive closure", () => {
    // Walking these transitively is what the lineage closure does; doing it
    // here would light up half the graph on any selection.
    const n = dataMapLinkNeighbours(links, "ds:a");
    expect(n.map((l) => l.id)).toEqual(["1"]);
  });

  it("is symmetric — the pair is undirected", () => {
    expect(dataMapLinkNeighbours(links, "ds:b").map((l) => l.id)).toEqual([
      "1",
      "2",
    ]);
    expect(dataMapLinkNeighbours(links, "ds:d").map((l) => l.id)).toEqual([
      "3",
    ]);
  });

  it("returns nothing for a node with no links", () => {
    expect(dataMapLinkNeighbours(links, "ds:zzz")).toEqual([]);
  });
});

describe("DATA_MAP_KEY_COLOR", () => {
  it("has a distinct colour for every join key", () => {
    // The legend is derived from this map, so a key with no colour would draw
    // grey and read as a boundary link — which means the opposite thing.
    const colors = Object.values(DATA_MAP_KEY_COLOR);
    expect(colors.length).toBe(5);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("dataMapView", () => {
  // The `?view=` filter DIMMED until v3: whichever view was picked, the graph
  // stayed 108 nodes at full size, so a reader who asked for „Избори" scrolled
  // 3,584px past 88 greyed-out cards. The baked layouts make it reflow —
  // measured on the real manifest, elections goes 986x3584 to 1012x724 and the
  // page from 5,015px to 1,611px, at the same 1.13x zoom.
  const node = (
    id: string,
    kind: DataMapNode["kind"],
    tags: string[],
    x: number,
  ): DataMapNode =>
    ({
      id,
      kind,
      label: { bg: id, en: id },
      detail: { bg: "", en: "" },
      desc: { bg: "", en: "" },
      tags,
      x,
      y: 0,
      w: 240,
      h: 62,
    }) as DataMapNode;

  const tier = (kind: DataMapNode["kind"], x: number) => ({
    kind,
    label: { bg: kind, en: kind },
    x,
    y: 0,
    w: 296,
    h: 400,
  });

  const base: DataMapManifest = {
    version: 3,
    generatedAt: "2026-09-02T00:00:00.000Z",
    nodes: [
      node("src:a", "source", ["elections"], 0),
      node("src:b", "source", ["prices"], 0),
      node("ds:one", "dataset", ["elections"], 350),
      node("ds:two", "dataset", ["prices"], 350),
    ],
    edges: [
      { id: "e0", from: "src:a", to: "ds:one" },
      { id: "e1", from: "src:b", to: "ds:two" },
      // Crosses the view boundary: its target is not in `elections`.
      { id: "e2", from: "src:a", to: "ds:two" },
    ],
    views: [
      { id: "all", label: { bg: "", en: "" }, tag: null },
      { id: "elections", label: { bg: "", en: "" }, tag: "elections" },
    ],
    tiers: [tier("source", 0), tier("dataset", 350)],
    tours: [],
    links: [
      {
        id: "ds:one|ds:two|eik",
        a: "ds:one",
        b: "ds:two",
        key: "eik",
        kind: "join",
        label: { bg: "", en: "" },
      },
    ],
    layouts: {
      all: {
        nodes: [
          { id: "src:a", x: 0, y: 0 },
          { id: "src:b", x: 0, y: 100 },
          { id: "ds:one", x: 350, y: 0 },
          { id: "ds:two", x: 350, y: 100 },
        ],
        tiers: [tier("source", 0), tier("dataset", 350)],
      },
      elections: {
        nodes: [
          { id: "src:a", x: 7, y: 11 },
          { id: "ds:one", x: 357, y: 11 },
        ],
        tiers: [tier("source", 0), tier("dataset", 350)],
      },
    },
  };

  it("returns only the view's members", () => {
    const g = dataMapView(base, "elections");
    expect(g.nodes.map((n) => n.id)).toEqual(["src:a", "ds:one"]);
    expect(g.dimNonMembers).toBe(false);
  });

  it("overrides positions with that view's layout", () => {
    // The whole point: a subset at the `all` positions is still 3,584px tall.
    // What collapses the page is re-solving the column for the subset.
    const g = dataMapView(base, "elections");
    expect(g.nodes.find((n) => n.id === "src:a")).toMatchObject({
      x: 7,
      y: 11,
    });
    expect(g.nodes.find((n) => n.id === "ds:one")).toMatchObject({
      x: 357,
      y: 11,
    });
  });

  it("does not mutate the manifest's own positions", () => {
    dataMapView(base, "elections");
    expect(base.nodes.find((n) => n.id === "src:a")).toMatchObject({ x: 0 });
  });

  it("drops an edge whose other end is outside the view", () => {
    // React Flow drops an edge pointing at an absent node SILENTLY — nothing
    // renders and nothing is logged, the failure class lateralHandles.test.ts
    // exists for.
    const g = dataMapView(base, "elections");
    expect(g.edges.map((e) => e.id)).toEqual(["e0"]);
  });

  it("drops a lateral link with one end outside the view", () => {
    expect(dataMapView(base, "elections").links).toEqual([]);
    expect(dataMapView(base, "all").links).toHaveLength(1);
  });

  it("returns the whole graph for `all`", () => {
    const g = dataMapView(base, "all");
    expect(g.nodes).toHaveLength(4);
    expect(g.edges).toHaveLength(3);
    expect(g.dimNonMembers).toBe(false);
  });

  // A cached v2 manifest has no `layouts`. It must still render — as the whole
  // graph with the others dimmed, which is exactly how this filter behaved
  // before v3.
  it("falls back to the full graph and dims when a layout is missing", () => {
    const v2 = { ...base, version: 2, layouts: undefined };
    const g = dataMapView(v2, "elections");
    expect(g.nodes).toHaveLength(4);
    expect(g.tiers).toBe(v2.tiers);
    expect(g.dimNonMembers).toBe(true);
  });

  it("does not ask the fallback to dim on `all`", () => {
    // Every node is a member there, so dimming would grey out the whole map.
    const v2 = { ...base, version: 2, layouts: undefined };
    expect(dataMapView(v2, "all").dimNonMembers).toBe(false);
  });

  it("returns the fallback's arrays by identity", () => {
    // The fallback must BE the pre-v3 behaviour, not a re-derivation of it —
    // a filtered copy here would quietly narrow a cached v2 manifest.
    const v2 = { ...base, version: 2, layouts: undefined };
    const g = dataMapView(v2, "elections");
    expect(g.edges).toBe(v2.edges);
    expect(g.links).toBe(v2.links);
    expect(g.nodes).toBe(v2.nodes);
  });

  describe("a view id outside the manifest's vocabulary", () => {
    // `?view=` comes straight off the query string. `manifest` comes from
    // JSON.parse, so `layouts["constructor"]` and friends are TRUTHY: without
    // an own-property check the `!layout` fallback is skipped and
    // `layout.nodes.map` throws — inside a render-time useMemo, with no
    // ErrorBoundary in src/, i.e. a blank page.
    it.each([
      "constructor",
      "__proto__",
      "toString",
      "valueOf",
      "hasOwnProperty",
    ])("does not throw on ?view=%s", (viewId) => {
      expect(() => dataMapView(base, viewId)).not.toThrow();
      expect(dataMapView(base, viewId).nodes).toHaveLength(4);
    });

    it("does not dim for an id that is not a view at all", () => {
      // An unknown id is not a NARROWER view — dimming for it would grey out
      // the whole map on a typo or a stale link.
      expect(dataMapView(base, "constructor").dimNonMembers).toBe(false);
      expect(dataMapView(base, "nonsense").dimNonMembers).toBe(false);
    });

    it("still dims for a known view whose layout is missing", () => {
      const partial = { ...base, layouts: { all: base.layouts!.all } };
      expect(dataMapView(partial, "elections").dimNonMembers).toBe(true);
    });
  });

  it("falls back when a view's layout is present but empty", () => {
    // A tag that matches no node would otherwise give a 1px canvas and an
    // unframed camera.
    const empty = {
      ...base,
      views: [
        ...base.views,
        { id: "ghost", label: { bg: "", en: "" }, tag: "x" },
      ],
      layouts: { ...base.layouts!, ghost: { nodes: [], tiers: [] } },
    };
    const g = dataMapView(empty, "ghost");
    expect(g.nodes).toHaveLength(4);
    expect(g.tiers).toHaveLength(2);
  });

  describe("hidden", () => {
    // A view's membership is curated per node and does not follow lineage, so
    // filtering edges to the members can leave a card with every arrow in one
    // direction gone. On a page about provenance that reads as an answer, so
    // the card says how many are hidden.
    it("counts each edge that leaves the view, on the end inside it", () => {
      // e2 (src:a -> ds:two) crosses out of `elections` at src:a.
      expect(dataMapView(base, "elections").hidden).toEqual(
        new Map([["src:a", 1]]),
      );
    });

    it("is empty when nothing is cut", () => {
      expect(dataMapView(base, "all").hidden.size).toBe(0);
    });

    it("is empty on the fallback, where the whole graph is drawn", () => {
      const v2 = { ...base, version: 2, layouts: undefined };
      expect(dataMapView(v2, "elections").hidden.size).toBe(0);
    });
  });
});
