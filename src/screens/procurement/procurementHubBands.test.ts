// Gates for the /procurement hub registry — the dashboard-hub skill's §9, applied here.
//
// The hub shipped ELEVEN tiles under one heading called „Разгледай": an instruction, which
// tells a reader only that the things below can be looked at. It is three named bands now,
// and every property below fails SILENTLY without a gate — a band naming a dead id
// white-screens the route, an orphaned tile is a page nothing links to, and a missing
// description is invisible until somebody reads the page and cannot tell why a row belongs
// together.
//
// This imports the registry rather than scanning the screen's source, which is the idiom the
// five sibling hub gates already use. The first cut did scan source, and paid for it: it read
// the other bands' i18n keys as tile ids, counted quoted strings instead of tiles, could not
// see the one tile declared inline, and broke on a code comment — which §3.2 encourages. With
// membership structural, an orphan or a duplicate is not merely detected, it is
// unrepresentable, and four of those clauses stop needing to exist.

import { describe, expect, it } from "vitest";
import { PROCUREMENT_BANDS, PROCUREMENT_TILES } from "./procurementRegistry";
import { PROCUREMENT_SCENES } from "./procurementScenes";
// The UNION, never translation.json alone: a key moved into a deferred bundle by the splitter
// is still real copy, and reading the core chunk would report it as missing.
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";

const has = (corpus: unknown, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(corpus, key);

describe("/procurement bands", () => {
  // Non-vacuity, not a content assertion: it only proves the registry is non-empty, so adding
  // a fourth band or a tile does not fail here with a message blaming the parser.
  it("has bands, and every band has tiles", () => {
    expect(PROCUREMENT_BANDS.length).toBeGreaterThan(0);
    for (const b of PROCUREMENT_BANDS)
      expect(b.tiles.length, `${b.labelKey} has no tiles`).toBeGreaterThan(0);
    expect(PROCUREMENT_TILES.length).toBe(
      PROCUREMENT_BANDS.reduce((n, b) => n + b.tiles.length, 0),
    );
  });

  it("gives every band a heading AND a description, in both corpora", () => {
    for (const b of PROCUREMENT_BANDS) {
      // The description is a real property now — the previous gate re-derived
      // `${labelKey}_desc` and checked the JSON, so deleting every `description:` from the
      // screen left it green. This reads what the band actually declares.
      expect(b.descKey, `${b.labelKey} declares no descKey`).toBeTruthy();
      for (const [name, corpus] of [
        ["bg", bg],
        ["en", en],
      ] as const) {
        expect(has(corpus, b.labelKey), `${name}: ${b.labelKey}`).toBe(true);
        expect(has(corpus, b.descKey), `${name}: ${b.descKey}`).toBe(true);
      }
    }
  });

  it("is not named for its rank", () => {
    // „Още" announces only that the band above it mattered more, so everything under it reads
    // as offcuts. „Разгледай" is an instruction and „Раздели" a container word — neither is a
    // table of contents. This hub existed to remove the first; nothing else stops it coming back.
    for (const b of PROCUREMENT_BANDS) {
      const label = (bg as Record<string, string>)[b.labelKey] ?? "";
      expect(label, b.labelKey).not.toMatch(
        /^(Още|Разгледай|Разгледай цените|Други|Раздели)$/,
      );
    }
  });

  it("gives every tile a scene", () => {
    // `InfographicTile` renders `<Scene />` UNGUARDED, so a tile id with no scene is
    // `undefined` as a component type — "Element type is invalid" and a white page for the
    // whole hub, not a blank vignette. There is no ErrorBoundary anywhere in src/.
    const missing = PROCUREMENT_TILES.filter((t) => !PROCUREMENT_SCENES[t.id]);
    expect(
      missing.map((t) => t.id),
      "tile id(s) with no PROCUREMENT_SCENES scene",
    ).toEqual([]);
  });

  it("labels every tile in both corpora, by key or inline — never neither", () => {
    for (const t of PROCUREMENT_TILES) {
      const keyed = !!t.titleKey;
      expect(
        keyed || !!t.title,
        `${t.id} has neither titleKey nor an inline title`,
      ).toBe(true);
      // Exactly one, so the screen's fallback chain cannot silently pick the wrong branch.
      expect(keyed && !!t.title, `${t.id} sets both titleKey and title`).toBe(
        false,
      );
      if (keyed)
        for (const [name, corpus] of [
          ["bg", bg],
          ["en", en],
        ] as const) {
          expect(has(corpus, t.titleKey!), `${name}: ${t.titleKey}`).toBe(true);
          if (t.descKey)
            expect(has(corpus, t.descKey), `${name}: ${t.descKey}`).toBe(true);
        }
      else {
        expect(t.title?.bg, `${t.id} inline title.bg`).toBeTruthy();
        expect(t.title?.en, `${t.id} inline title.en`).toBeTruthy();
      }
    }
  });

  it("uses each tile id and each accent exactly once", () => {
    const ids = PROCUREMENT_TILES.map((t) => t.id);
    expect(ids.length, "duplicate tile id").toBe(new Set(ids).size);
    // All bands render together, so a repeated accent reads as "these two tiles are the same
    // kind of thing". The FeaturedStrip below the grid is checked separately — its collisions
    // with this registry are what `clay` and `teal` had to move for.
    const accents = PROCUREMENT_TILES.map((t) => t.accent);
    const dup = accents.filter((a, i) => accents.indexOf(a) !== i);
    expect([...new Set(dup)], "accent(s) used twice").toEqual([]);
  });

  it("strands no lone tile on the last xl row", () => {
    // Four columns at `xl`. A band of 5 renders 4+1 and leaves one tile alone; 9 renders
    // 4+4+1. `tiles.length` is the REAL count — the previous gate counted quoted ids, so a
    // band containing an inline tile read one short and a 5-tile band passed as 4.
    //
    // `lg` (three columns) is deliberately OUT OF SCOPE: a four-tile band renders 3+1 there,
    // which every hub on the site does, and §3.2 speaks only about `xl`. Do not read this
    // clause as comprehensive across breakpoints.
    for (const b of PROCUREMENT_BANDS) {
      const n = b.tiles.length;
      if (n <= 4) continue;
      expect(
        n % 4,
        `${b.labelKey}: ${n} tiles leaves ${n % 4} alone on a second row`,
      ).not.toBe(1);
    }
  });
});
