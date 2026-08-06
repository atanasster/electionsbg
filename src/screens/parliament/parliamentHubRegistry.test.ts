// Commit-time gates for the /parliament hub registry (docs/plans/parliament-hub-v1.md §11).
//
// The two that carry the most weight and the least obviousness:
//
//   • SCENES. `tile.id` → `PARLIAMENT_SCENES[id]` is checked nowhere by the compiler: the
//     scene map is Record<string, FC> and noUncheckedIndexedAccess is off, so a missing key
//     types as FC and is `undefined` at runtime. InfographicTile renders <Scene /> with no
//     guard, and `undefined` as a component type WHITE-SCREENS the route rather than
//     dropping the picture. Same precedent, same reason as governance/hubRegistry.test.ts.
//
//   • SEEDED DESTINATIONS. Two band-4 tiles point at parameterised routes with no static
//     landing. Writing the pattern as `to` would satisfy a naive "destination is absolute"
//     assertion while linking nowhere, so the pairing of `:param` with `seed` is asserted
//     both ways, and the substitution is exercised.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  PARLIAMENT_BANDS,
  PARLIAMENT_TILES,
  isSeededDestination,
  resolveDestination,
} from "./parliamentRegistry";
import { PARLIAMENT_SCENES } from "./parliamentScenes";

/** Every routed pattern this hub is allowed to point at. A tile whose destination is not
 *  in this list is either a typo or a route that does not exist — both of which shipped as
 *  live tiles in earlier hubs on this codebase. Kept as literals rather than derived from
 *  routes.tsx so that deleting a route breaks the test loudly. */
const ROUTED_PATTERNS = [
  "/votes",
  "/votes/between",
  "/votes/between/:pair",
  "/parliament/correlation",
  "/parliament/embedding",
  "/parliament/cohesion",
  "/parliament/attendance",
  "/parliament/similarity",
  "/parliament/similarity/:mpId",
  "/persons",
  "/governance/declarations",
  "/mp-assets",
  "/mp/companies",
  "/connections",
];

const patternOf = (to: string): string => to.split("?")[0];

describe("the /parliament hub registry", () => {
  test("every tile id has a scene", () => {
    for (const tile of PARLIAMENT_TILES) {
      assert.equal(
        typeof PARLIAMENT_SCENES[tile.id],
        "function",
        `PARLIAMENT_SCENES has no scene for tile '${tile.id}' — the hub route throws on render`,
      );
    }
  });

  test("no scene is orphaned", () => {
    // The inverse of the gate above: a scene with no tile is dead art, and the usual cause
    // is a tile that was renamed rather than removed.
    const ids = new Set(PARLIAMENT_TILES.map((t) => t.id));
    for (const key of Object.keys(PARLIAMENT_SCENES)) {
      assert.ok(ids.has(key), `PARLIAMENT_SCENES.${key} has no tile`);
    }
  });

  test("tile ids are unique", () => {
    const ids = PARLIAMENT_TILES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate tile id");
  });

  test("destinations are unique", () => {
    // TileHubGrid renders tiles with key={tile.to}. Two tiles sharing a destination is a
    // duplicate React key, not merely a duplicate link — an earlier draft of this hub had
    // exactly that, with a "bills" tile pointing at /votes alongside the votes tile.
    const tos = PARLIAMENT_TILES.map((t) => t.to);
    assert.equal(
      new Set(tos).size,
      tos.length,
      "two tiles share a destination",
    );
  });

  test("every destination is absolute and routed", () => {
    for (const tile of PARLIAMENT_TILES) {
      assert.match(
        tile.to,
        /^\//,
        `tile '${tile.id}' has a non-absolute destination`,
      );
      assert.ok(
        ROUTED_PATTERNS.includes(patternOf(tile.to)),
        `tile '${tile.id}' points at '${tile.to}', which is not a routed pattern`,
      );
    }
  });

  test("a parameterised destination carries a seed, and vice versa", () => {
    for (const tile of PARLIAMENT_TILES) {
      if (isSeededDestination(tile.to)) {
        assert.ok(
          tile.seed,
          `tile '${tile.id}' has a ':param' destination but no seed to fill it — it would render a dead link`,
        );
      } else {
        assert.equal(
          tile.seed,
          undefined,
          `tile '${tile.id}' declares a seed but its destination takes no parameter`,
        );
      }
    }
  });

  test("no tile is seeded any more, and the resolver still handles one correctly", () => {
    // BOTH seeded tiles became pickers. /parliament/similarity and /votes/between now open
    // on a chooser, so the hub no longer has to name a member or a pair on the reader's
    // behalf — which was the whole reason a seed existed, and the reason those two tiles
    // could vanish entirely when the generator produced none.
    assert.deepEqual(
      PARLIAMENT_TILES.filter((t) => t.seed).map((t) => t.id),
      [],
      "a tile is seeded again — prefer a picker page unless there is a reason not to",
    );

    // The machinery stays and stays TESTED, against a synthetic tile rather than a live
    // one. It is the guard for the next seeded destination, and an untested guard is not
    // one; the case that matters is the ABSENT seed, where the alternative to omitting the
    // tile is rendering a link with a raw `:param` in it that 404s.
    const synthetic = [
      {
        id: "synthetic",
        titleKey: "x",
        descKey: "x",
        to: "/parliament/similarity/:mpId",
        seed: "similarity" as const,
        accent: "#000",
      },
    ];
    for (const tile of synthetic) {
      const resolved = resolveDestination(tile, { [tile.seed!]: "SEED" });
      assert.ok(resolved, `tile '${tile.id}' did not resolve with a seed`);
      assert.ok(
        !resolved.includes(":"),
        `tile '${tile.id}' resolved to '${resolved}', which still carries a parameter`,
      );
      // The absent-seed case is the one that matters: an omitted tile is honest, a tile
      // rendered with the raw pattern is a link that 404s.
      assert.equal(
        resolveDestination(tile, {}),
        null,
        `tile '${tile.id}' must be omitted when its seed is missing`,
      );
      assert.equal(
        resolveDestination(tile, { [tile.seed!]: "" }),
        null,
        `tile '${tile.id}' must treat an empty seed as missing`,
      );
    }
  });

  test("no accent is used twice on the page", () => {
    // All three bands render on ONE page, so a repeated accent reads as "these two tiles
    // are the same kind of thing".
    const byAccent = new Map<string, string[]>();
    for (const tile of PARLIAMENT_TILES) {
      byAccent.set(tile.accent, [
        ...(byAccent.get(tile.accent) ?? []),
        tile.id,
      ]);
    }
    const collisions = [...byAccent.values()].filter((ids) => ids.length > 1);
    assert.deepEqual(
      collisions,
      [],
      `tiles sharing an accent: ${collisions.map((ids) => ids.join("+")).join(", ")}`,
    );
  });

  test("every band has a label and at least one tile", () => {
    for (const band of PARLIAMENT_BANDS) {
      assert.ok(band.labelKey, "band without a labelKey");
      assert.ok(band.tiles.length > 0, `band '${band.labelKey}' is empty`);
    }
  });

  test("every sub-page the module owns is reachable from the hub", () => {
    // The reachability half of §11: /parliament/* pages that exist but are linked from
    // nowhere are the 28-orphan reports gap repeating.
    const destinations = new Set(PARLIAMENT_TILES.map((t) => patternOf(t.to)));
    for (const owned of [
      "/votes",
      "/parliament/correlation",
      "/parliament/embedding",
      "/parliament/cohesion",
      "/parliament/attendance",
      "/parliament/similarity",
      "/votes/between",
    ]) {
      assert.ok(
        destinations.has(owned),
        `${owned} is routed but no hub tile links to it`,
      );
    }
  });

  test("the parameterised routes are reached through their pickers, not from the hub", () => {
    // /parliament/similarity/:mpId and /votes/between/:pair are still routed and still the
    // page a reader ends up on — they are simply no longer the hub's business. Asserted
    // rather than left implicit, because "the hub links to it" was how this file previously
    // proved they were reachable at all, and dropping that without replacing it would have
    // quietly retired the check.
    const destinations = new Set(PARLIAMENT_TILES.map((t) => patternOf(t.to)));
    for (const [param, picker] of [
      ["/parliament/similarity/:mpId", "/parliament/similarity"],
      ["/votes/between/:pair", "/votes/between"],
    ]) {
      assert.ok(
        !destinations.has(param),
        `${param} is a hub destination again — the hub should link to ${picker}`,
      );
      assert.ok(
        destinations.has(picker),
        `${picker} must be a hub destination, or ${param} becomes unreachable`,
      );
    }
  });
});
