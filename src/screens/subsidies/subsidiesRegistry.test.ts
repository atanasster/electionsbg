// Gates for the /subsidies hub registry — the dashboard-hub skill's §8, applied here. Each one
// exists because its absence shipped something on a previous hub.
//
// The most expensive is the first: `InfographicTile` renders `<Scene />` UNGUARDED, so a tile id
// with no scene is `undefined` as a component type. That is not a blank vignette, it is
// "Element type is invalid" and a white page for the whole hub.
//
// Two rules are stricter here than on /funds, both because band 3 leaves the module:
//
//   • the ROUTED list carries four CROSS-MODULE destinations (/budget/municipal,
//     /sector/transport, /culture, /budget/simulator). Those belong to other teams' pages, so a
//     rename there breaks this hub silently — the routes.tsx check is what makes it loud.
//     /sector/transport is registered as the parameterised `sector/:id`, so it is asserted
//     through the sector registry instead of as a literal <Route path>.
//   • band 3's four tiles must all be ANNUAL and must each name their year in the rendered
//     caption. That is not checkable from the registry (the caption is built in the screen), so
//     the screen's own test covers it; what IS checked here is that the band exists with
//     exactly those four members, so a fifth cannot be dropped in without a decision.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBSIDIES_BANDS, SUBSIDIES_METRIC_KEYS } from "./subsidiesRegistry";
import { SUBSIDIES_SCENES } from "./subsidiesScenes";

/** Flattened, since the registry exports bands only. */
const TILES = SUBSIDIES_BANDS.flatMap((b) => b.tiles);
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const routes = readFileSync(path.join(REPO, "src/routes.tsx"), "utf8");

/** Every path the hub is allowed to point at, as LITERALS. A new destination has to be declared
 *  here on purpose, and a deleted route breaks loudly rather than 404ing for a reader. */
const ROUTED = [
  "/subsidies/recipients",
  "/subsidies/schemes",
  "/subsidies/places",
  "/subsidies/untraceable",
  "/subsidies/concentration",
  "/subsidies/political",
  "/subsidies/cross-programme",
  "/subsidies/browse",
  "/subsidies/coverage",
  // Band 3 — other modules' pages. See the header on why these are the risky ones.
  "/budget/municipal",
  "/culture",
  "/budget/simulator",
  "/sector/transport",
] as const;

/** `/sector/transport` is served by the parameterised `sector/:id` route, so there is no
 *  `<Route path="sector/transport">` to grep for. Its existence is proved by the sector
 *  registry instead — which is also the file that would be edited if the sector were renamed. */
const VIA_SECTOR_REGISTRY = new Set(["/sector/transport"]);

describe("every tile has a scene", () => {
  it("no tile id is missing from SUBSIDIES_SCENES", () => {
    const missing = TILES.filter((t) => !SUBSIDIES_SCENES[t.id]).map(
      (t) => t.id,
    );
    expect(
      missing,
      `tile id(s) with no scene — the hub would render a white page`,
    ).toEqual([]);
  });

  it("no scene is orphaned", () => {
    // An unused scene is dead code, and more usefully: it is the trace of a tile that was
    // renamed on one side only.
    const ids = new Set(TILES.map((t) => t.id));
    expect(Object.keys(SUBSIDIES_SCENES).filter((k) => !ids.has(k))).toEqual(
      [],
    );
  });
});

describe("destinations", () => {
  it("every `to` is absolute and in the declared routed list", () => {
    for (const t of TILES) {
      expect(t.to.startsWith("/"), `${t.id}: ${t.to} is not absolute`).toBe(
        true,
      );
      expect(
        ROUTED as readonly string[],
        `${t.id}: ${t.to} is not declared`,
      ).toContain(t.to);
    }
  });

  it("every declared destination is actually registered in routes.tsx", () => {
    // The gate that catches the class no type system does. `/funds/projects` was in the first
    // draft of the registry and does not exist — `/funds/contract/:number` is a single contract
    // page, not a browser.
    const sectorRegistry = readFileSync(
      path.join(REPO, "src/screens/governance/sectorRegistry.ts"),
      "utf8",
    );
    for (const to of ROUTED) {
      if (VIA_SECTOR_REGISTRY.has(to)) {
        const id = to.split("/").pop();
        expect(
          sectorRegistry,
          `${to} is not in sectorRegistry.ts, so sector/:id will not match it`,
        ).toContain(`"${id}"`);
        expect(routes, "the sector/:id route itself is gone").toContain(
          'path="sector/:id"',
        );
        continue;
      }
      const p = to.replace(/^\//, "");
      expect(routes, `${to} has no <Route path="${p}">`).toContain(
        `path="${p}"`,
      );
    }
  });

  it("carries no parameterised destination", () => {
    // A `:param` in a `to` would need a seed, and a seeded tile lands the reader on somebody
    // else's subject. Steps 3 and 5 built index pages precisely so this stays true.
    for (const t of TILES)
      expect(t.to.includes(":"), `${t.id}: ${t.to} is parameterised`).toBe(
        false,
      );
  });

  it("no destination appears twice", () => {
    const tos = TILES.map((t) => t.to);
    expect(new Set(tos).size, `duplicate destination: ${tos.join(", ")}`).toBe(
      tos.length,
    );
  });
});

describe("accents", () => {
  it("no accent is used twice on the page", () => {
    // All three bands render together, so a repeat reads as „these two tiles are the same kind
    // of thing".
    const accents = TILES.map((t) => t.accent);
    const dupes = accents.filter((a, i) => accents.indexOf(a) !== i);
    expect(dupes, `accent(s) used more than once: ${dupes.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("bands", () => {
  it("no band strands a single tile on its own row of the 4-column xl grid", () => {
    // 5 tiles is the shape that breaks: four on one row and one orphan beneath.
    for (const b of SUBSIDIES_BANDS) {
      const n = b.tiles.length;
      expect(n, `${b.labelKey} has ${n} tiles`).toBeGreaterThan(0);
      expect(
        n % 4,
        `${b.labelKey}: ${n} tiles leaves ${n % 4} alone on a second row`,
      ).not.toBe(1);
    }
  });

  it("band 3 has exactly its four declared members", () => {
    // The band leaves the module, and the plan's §4 rules for it — annual, each naming its
    // year, NEVER summed, and no КФП budget aggregate among them — are reasoning about these
    // four specifically. A fifth arriving without that reasoning is the thing to catch.
    const other = SUBSIDIES_BANDS.find(
      (b) => b.labelKey === "subsidies_band_other",
    );
    expect(other, "the cross-module band is gone").toBeTruthy();
    expect(other!.tiles.map((t) => t.id).sort()).toEqual([
      "film",
      "municipal",
      "party",
      "rail",
    ]);
  });

  it("is not named for its rank", () => {
    // „Още" announces only that the band above it mattered more, so everything under it reads
    // as offcuts. „Разгледай" is an instruction, not a table of contents.
    for (const b of SUBSIDIES_BANDS) {
      const label = (bg as Record<string, string>)[b.labelKey] ?? "";
      expect(label).not.toMatch(/^(Още|Разгледай|Други)$/);
    }
  });
});

describe("i18n", () => {
  it("every key the registry names exists in BOTH bundles", () => {
    // `t()` returns the KEY when it is missing, which is truthy — so a `t(k) || fallback` never
    // fires and the tile renders „funds_tile_places" at the reader.
    const keys = [
      ...SUBSIDIES_BANDS.flatMap((b) => [b.labelKey, b.descKey]),
      ...TILES.flatMap((t) => [t.titleKey, t.descKey]),
      // The metric captions too. They are passed to `t()` by the SCREEN rather than named in
      // the registry, so deriving the list from SUBSIDIES_BANDS alone left nine keys ungated.
      ...SUBSIDIES_METRIC_KEYS,
    ];
    for (const k of keys) {
      expect(
        (bg as Record<string, string>)[k],
        `bg is missing ${k}`,
      ).toBeTruthy();
      expect(
        (en as Record<string, string>)[k],
        `en is missing ${k}`,
      ).toBeTruthy();
    }
  });

  it("no description is a copy of its title", () => {
    // A tile whose caption repeats its heading has spent a line saying nothing.
    for (const t of TILES) {
      const title = (bg as Record<string, string>)[t.titleKey];
      const desc = (bg as Record<string, string>)[t.descKey];
      expect(desc, `${t.id}`).not.toBe(title);
    }
  });
});
