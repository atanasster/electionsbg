// Gates for the /funds hub registry. Each one exists because its absence shipped something on
// a previous hub — the list is the dashboard-hub skill's §8, applied here.
//
// The most expensive is the first: `InfographicTile` renders `<Scene />` UNGUARDED, so a tile id
// with no scene is `undefined` as a component type. That is not a blank vignette, it is
// "Element type is invalid" and a white page for the whole hub.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUNDS_BANDS, FUNDS_TILES } from "./fundsRegistry";
import { FUNDS_SCENES } from "./fundsScenes";
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const routes = readFileSync(path.join(REPO, "src/routes.tsx"), "utf8");

/** Every path the hub is allowed to point at, as LITERALS. A new destination has to be declared
 *  here on purpose, and a deleted route breaks loudly rather than 404ing for a reader. */
const ROUTED = [
  "/funds/beneficiaries",
  "/funds/programmes",
  "/funds/places",
  "/funds/political",
  "/funds/integrity",
  "/funds/dual-corpus",
  "/funds/focus",
  "/funds/absorption",
  "/funds/rrf",
  "/funds/interreg",
] as const;

describe("every tile has a scene", () => {
  it("no tile id is missing from FUNDS_SCENES", () => {
    const missing = FUNDS_TILES.filter((t) => !FUNDS_SCENES[t.id]).map(
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
    const ids = new Set(FUNDS_TILES.map((t) => t.id));
    expect(Object.keys(FUNDS_SCENES).filter((k) => !ids.has(k))).toEqual([]);
  });
});

describe("destinations", () => {
  it("every `to` is absolute and in the declared routed list", () => {
    for (const t of FUNDS_TILES) {
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
    for (const to of ROUTED) {
      const p = to.replace(/^\//, "");
      expect(routes, `${to} has no <Route path="${p}">`).toContain(
        `path="${p}"`,
      );
    }
  });

  it("carries no parameterised destination", () => {
    // A `:param` in a `to` would need a seed, and a seeded tile lands the reader on somebody
    // else's subject. Steps 3 and 5 built index pages precisely so this stays true.
    for (const t of FUNDS_TILES)
      expect(t.to.includes(":"), `${t.id}: ${t.to} is parameterised`).toBe(
        false,
      );
  });

  it("no destination appears twice", () => {
    const tos = FUNDS_TILES.map((t) => t.to);
    expect(new Set(tos).size, `duplicate destination: ${tos.join(", ")}`).toBe(
      tos.length,
    );
  });
});

describe("accents", () => {
  it("no accent is used twice on the page", () => {
    // All three bands render together, so a repeat reads as „these two tiles are the same kind
    // of thing".
    const accents = FUNDS_TILES.map((t) => t.accent);
    const dupes = accents.filter((a, i) => accents.indexOf(a) !== i);
    expect(dupes, `accent(s) used more than once: ${dupes.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("bands", () => {
  it("no band strands a single tile on its own row of the 4-column xl grid", () => {
    // 5 tiles is the shape that breaks: four on one row and one orphan beneath.
    for (const b of FUNDS_BANDS) {
      const n = b.tiles.length;
      expect(n, `${b.labelKey} has ${n} tiles`).toBeGreaterThan(0);
      expect(
        n % 4,
        `${b.labelKey}: ${n} tiles leaves ${n % 4} alone on a second row`,
      ).not.toBe(1);
    }
  });

  it("is not named for its rank", () => {
    // „Още" announces only that the band above it mattered more, so everything under it reads
    // as offcuts. „Разгледай" is an instruction, not a table of contents.
    for (const b of FUNDS_BANDS) {
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
      ...FUNDS_BANDS.flatMap((b) => [b.labelKey, b.descKey]),
      ...FUNDS_TILES.flatMap((t) => [t.titleKey, t.descKey]),
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
    for (const t of FUNDS_TILES) {
      const title = (bg as Record<string, string>)[t.titleKey];
      const desc = (bg as Record<string, string>)[t.descKey];
      expect(desc, `${t.id}`).not.toBe(title);
    }
  });
});
