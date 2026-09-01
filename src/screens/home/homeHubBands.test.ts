// The home tile registry: shape, destinations, scenes and the scope rule.
//
// Every clause here is about something that renders as a working page when it is wrong — a
// tile pointing at a dead route still looks like a tile, a duplicated scene still draws, and
// a leaked `?pscope` still navigates. None of them is visible in review.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_BANDS, HOME_TILES } from "./homeRegistry";
import { HOME_SCENES } from "./homeScenes";

const REPO = path.resolve(__dirname, "../../..");
const routerSrc = readFileSync(path.join(REPO, "src/routes.tsx"), "utf-8");

describe("home bands", () => {
  it("is exactly two described bands of four tiles", () => {
    expect(HOME_BANDS).toHaveLength(2);
    for (const b of HOME_BANDS) {
      expect(b.tiles, b.id).toHaveLength(4);
      expect(b.labelKey, b.id).toBeTruthy();
      expect(b.descKey, b.id).toBeTruthy();
    }
  });

  it("HOME_TILES is derived, not a second hand-maintained list", () => {
    // Two lists is how a tile lands in one and not the other. Asserted by identity of
    // contents AND order, so a re-ordered copy fails too.
    expect(HOME_TILES).toEqual(HOME_BANDS.flatMap((b) => b.tiles));
  });

  it("every tile id is unique", () => {
    const ids = HOME_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every destination is unique", () => {
    // `InfographicTile` keys on `to`; two tiles sharing a destination would also be two
    // routes into the same page dressed as different subjects.
    const tos = HOME_TILES.map((t) => t.to);
    expect(new Set(tos).size).toBe(tos.length);
  });
});

describe("home tile destinations", () => {
  it("every destination is absolute and in-app", () => {
    for (const t of HOME_TILES) {
      expect(t.to.startsWith("/"), t.id).toBe(true);
      expect(t.to.startsWith("//"), t.id).toBe(false);
      expect(/^https?:/.test(t.to), t.id).toBe(false);
    }
  });

  it("every destination is a route the router actually declares", () => {
    // The gate that stops a repoint landing before its route exists — the `elections` tile
    // is explicitly waiting on one (`/elections`), and a tile pointing at an undeclared
    // path still renders and still navigates, straight to the SPA fallback.
    for (const t of HOME_TILES) {
      const seg = t.to.replace(/^\//, "").split("?")[0];
      const declared =
        routerSrc.includes(`path="${seg}"`) ||
        // `/parliamentary` is an INDEX route under its group, so it has no `path=` of its
        // own — the group does. Same shape any future index destination would have.
        (seg === "parliamentary" && routerSrc.includes('path="parliamentary"'));
      expect(declared, `${t.id} -> /${seg} is not declared in routes.tsx`).toBe(
        true,
      );
    }
  });

  it("procurement forces the all-time scope its metric is measured on", () => {
    // The tile's number is the ALL-SCOPE total. Opening the page on its default parliament
    // window would show a different figure from the one the reader just clicked.
    const p = HOME_TILES.find((t) => t.id === "procurement");
    expect(p?.to).toBe("/procurement?pscope=all");
  });

  it("no tile still points at the root", () => {
    // `/` is the page these tiles are ON.
    expect(HOME_TILES.filter((t) => t.to === "/")).toEqual([]);
  });
});

describe("the scope rule", () => {
  it("drops pscope on exactly the destinations that do not read it", () => {
    // Verified per screen, not assumed: only /procurement (which forces its own) and
    // /governance/sectors call `useScope`. An inbound `?pscope=y:2019` reaching a
    // scope-free page makes it answer for a window it has no concept of — the defect
    // `usePreserveParams`' own header records shipping once on /governance.
    const dropping = HOME_TILES.filter((t) => t.dropParams?.includes("pscope"))
      .map((t) => t.id)
      .sort();
    expect(dropping).toEqual([
      "budget",
      "elections",
      "funds",
      "governance",
      "my-area",
      "prices",
    ]);
  });

  it("the two scope-aware destinations keep it", () => {
    for (const id of ["procurement", "sectors"]) {
      const t = HOME_TILES.find((x) => x.id === id);
      expect(t?.dropParams, id).toBeUndefined();
    }
  });

  it("a tile that forces a param does not also drop it", () => {
    // Dropping a param the tile itself put in `to` would silently undo the tile's own
    // choice. `useTileHref` guards this too; asserted here so the registry cannot express it.
    for (const t of HOME_TILES) {
      const own = new URLSearchParams(t.to.split("?")[1] ?? "");
      for (const key of t.dropParams ?? [])
        expect(own.has(key), `${t.id} both forces and drops ${key}`).toBe(
          false,
        );
    }
  });
});

describe("home scenes", () => {
  it("every tile has a scene", () => {
    for (const t of HOME_TILES)
      expect(HOME_SCENES[t.id], t.id).toBeTypeOf("function");
  });

  it("no scene is orphaned", () => {
    const ids = new Set(HOME_TILES.map((t) => t.id));
    expect(Object.keys(HOME_SCENES).filter((k) => !ids.has(k))).toEqual([]);
  });

  it("no two tiles share a scene", () => {
    // A shared scene makes two destinations look like the same kind of thing at a glance,
    // which is the whole reason the grid draws rather than uses icons.
    const fns = HOME_TILES.map((t) => HOME_SCENES[t.id]);
    expect(new Set(fns).size).toBe(fns.length);
  });

  it("no accent is used twice", () => {
    const accents = HOME_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });
});

describe("the prerendered destination list", () => {
  it("matches the tile registry exactly, in order", () => {
    // ⚠️ A THIRD LIST OF THE SAME EIGHT. `HOME_DESTINATIONS` in the prerender feeds both the
    // crawlable body links and the ItemList JSON-LD, and it cannot import the registry (that
    // pulls the React barrel in for TILE_ACCENTS). This file's own header says two
    // hand-maintained lists is how a tile lands in one and not the other; the same argument
    // applies across the Node/browser boundary, so the comparison is made textually.
    //
    // Order included, for the same reason the HOME_TILES clause asserts order: the ItemList
    // emits 1-based positions from this sequence.
    const src = readFileSync(
      path.join(REPO, "scripts/prerender/routes.ts"),
      "utf-8",
    );
    const block = /const HOME_DESTINATIONS[\s\S]*?\n\];/.exec(src);
    expect(block, "HOME_DESTINATIONS not found — did it move?").toBeTruthy();
    const paths = [...block![0].matchAll(/path:\s*"([^"]+)"/g)].map(
      (m) => `/${m[1]}`,
    );
    expect(paths).toEqual(HOME_TILES.map((t) => t.to));
  });
});

describe("i18n keys", () => {
  it("no descriptor key is built from a template", () => {
    // A built template defeats the reachability analysis: `bundle_reachability.test.ts`
    // treats one as naming EVERY key it could match, which is how a single `${x}_desc`
    // made eight deferred budget keys "reachable" from a page that cannot render them.
    const src = readFileSync(
      path.join(REPO, "src/screens/home/homeRegistry.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/(titleKey|descKey):\s*`/);
  });

  it("every key is a literal home_ key", () => {
    for (const b of HOME_BANDS) {
      expect(b.labelKey).toMatch(/^home_/);
      expect(b.descKey).toMatch(/^home_/);
    }
    for (const t of HOME_TILES) {
      expect(t.titleKey, t.id).toMatch(/^home_/);
      expect(t.descKey, t.id).toMatch(/^home_/);
    }
  });
});
