import { describe, expect, it } from "vitest";
import { dataMapClosure, type DataMapEdge } from "./useDataMap";

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
