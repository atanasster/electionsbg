import { describe, expect, it } from "vitest";
import {
  dataMapClosure,
  dataMapLinkNeighbours,
  DATA_MAP_KEY_COLOR,
  type DataMapEdge,
  type DataMapLink,
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
