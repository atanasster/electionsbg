// Every hub tile's `id` must resolve to a scene.
//
// The stringly-typed `tile.id` → `SCENES[id]` contract is checked nowhere by the compiler:
// the scene maps are `Record<string, FC>` and `noUncheckedIndexedAccess` is off, so a
// missing key types as `FC` and is `undefined` at runtime. `InfographicTile` renders
// `<Scene />` with no guard, and `undefined` as a component type throws "Element type is
// invalid" — it WHITE-SCREENS the route rather than dropping the picture. GovernanceScreen's
// dev-time console guard catches it in development only, and the declarations hub has none.
//
// Same precedent, same reason: src/screens/reports/hub/reportsHubRegistry.test.ts.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { GOV_HUB_CLUSTERS } from "./governanceRegistry";
import { GOV_HUB_SCENES } from "./governanceScenes";
import { DECLARATION_TILES } from "./declarationsRegistry";
import { DECLARATION_SCENES } from "./declarationsScenes";

describe("the governance hub registries", () => {
  test("every /governance tile id has a scene", () => {
    for (const cluster of GOV_HUB_CLUSTERS)
      for (const tile of cluster.tiles)
        assert.equal(
          typeof GOV_HUB_SCENES[tile.id],
          "function",
          `GOV_HUB_SCENES has no scene for tile '${tile.id}' — the hub route throws on render`,
        );
  });

  test("every /governance/declarations tile id has a scene", () => {
    for (const tile of DECLARATION_TILES)
      assert.equal(
        typeof DECLARATION_SCENES[tile.id],
        "function",
        `DECLARATION_SCENES has no scene for tile '${tile.id}' — the sub-hub route throws on render`,
      );
  });

  test("tile ids are unique within a hub", () => {
    const gov = GOV_HUB_CLUSTERS.flatMap((c) => c.tiles).map((t) => t.id);
    assert.equal(
      new Set(gov).size,
      gov.length,
      "duplicate /governance tile id",
    );
    const decl = DECLARATION_TILES.map((t) => t.id);
    assert.equal(
      new Set(decl).size,
      decl.length,
      "duplicate /governance/declarations tile id",
    );
  });

  test("every tile routes somewhere absolute", () => {
    for (const tile of [
      ...GOV_HUB_CLUSTERS.flatMap((c) => c.tiles),
      ...DECLARATION_TILES,
    ])
      assert.match(
        tile.to,
        /^\//,
        `tile '${tile.id}' has a non-absolute destination`,
      );
  });

  test("the persons tile is offered by both hubs and points at the same route", () => {
    // It is deliberately duplicated — the browser is both an accountability sub-hub and the
    // parent of the four declaration leaderboards. Duplicated data may drift; the
    // destination may not.
    const gov = GOV_HUB_CLUSTERS.flatMap((c) => c.tiles).find(
      (t) => t.id === "persons",
    );
    const decl = DECLARATION_TILES.find((t) => t.id === "persons");
    assert.ok(gov, "/governance lost its persons tile");
    assert.ok(decl, "/governance/declarations lost its persons tile");
    assert.equal(gov.to, "/persons");
    assert.equal(decl.to, gov.to);
    assert.equal(decl.titleKey, gov.titleKey);
    assert.equal(decl.descKey, gov.descKey);
  });
});
