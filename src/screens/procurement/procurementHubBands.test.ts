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
import {
  METRIC_FIELD,
  PROCUREMENT_BANDS,
  PROCUREMENT_TILES,
} from "./procurementRegistry";
import { PROCUREMENT_SCENES } from "./procurementScenes";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The UNION, never translation.json alone: a key moved into a deferred bundle by the splitter
// is still real copy, and reading the core chunk would report it as missing.
import { bgCorpus as bg, enCorpus as en } from "@/locales/allKeys";

/** The repo root, resolved from THIS FILE rather than process.cwd(): every sibling test that
 *  reads a repo file does the same, and a bare relative path read at collection time takes the
 *  whole file down ("Tests: no tests") under any runner whose cwd is not the root. */
const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

interface BlobScope {
  contracts: number;
  awarderCount: number;
  topAwarders: { eik: string; name: string; eur: number }[];
  [field: string]: unknown;
}

/** Read lazily, inside the `it` that needs it, so a missing blob fails one clause. */
const readBlob = (): Record<string, BlobScope> =>
  JSON.parse(
    readFileSync(
      path.join(REPO, "data/procurement/derived/hub_stats.json"),
      "utf8",
    ),
  );

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

describe("/procurement tile figures declare their basis", () => {
  it("gives every tile with a metric a metricBasis, and none without", () => {
    const bare = PROCUREMENT_TILES.filter((t) => t.metric && !t.metricBasis);
    expect(
      bare.map((t) => t.id),
      "tile(s) with a figure and no declared basis — the caption would be a guess",
    ).toEqual([]);
    const orphan = PROCUREMENT_TILES.filter((t) => !t.metric && t.metricBasis);
    expect(
      orphan.map((t) => t.id),
      "metricBasis with no metric",
    ).toEqual([]);
  });

  it("names a metric the field table knows", () => {
    for (const t of PROCUREMENT_TILES) {
      if (!t.metric) continue;
      expect(
        METRIC_FIELD,
        `unknown tile metric "${t.metric}" — extend METRIC_FIELD`,
      ).toHaveProperty(t.metric);
    }
  });

  // The claim each caption makes, re-derived from the DATA rather than trusted. This is what
  // stops „този парламент" appearing under a figure that ignores the parliament: `ngos` is 331
  // in all thirty scopes because procurement_hub_counts computes it with no date predicate,
  // and nothing else in that blob announces it.
  it("proves every scope-captioned figure actually moves with the scope", () => {
    const blob = readBlob();
    const scopes = Object.keys(blob);
    expect(scopes.length, "hub_stats.json has no scopes").toBeGreaterThan(5);

    let checked = 0;
    for (const t of PROCUREMENT_TILES) {
      if (!t.metric || t.metricBasis !== "scope") continue;
      const field = METRIC_FIELD[t.metric];
      // An unmapped or non-blob metric is a gap in the table, not a pass — the previous
      // version skipped silently on a missing key and on a missing field alike.
      expect(
        field,
        `${t.id}: metric "${t.metric}" maps to no field`,
      ).toBeTruthy();
      const present = scopes.filter((s) => field in blob[s]);
      expect(
        present.length,
        `${t.id}: field ${field} is absent from ${scopes.length - present.length} scope(s)`,
      ).toBe(scopes.length);
      const distinct = new Set(present.map((s) => blob[s][field]));
      expect(
        distinct.size,
        `${t.id}: declared "scope" but ${field} is the SAME in every scope — the caption names a window the figure ignores`,
      ).toBeGreaterThan(1);
      checked++;
    }
    // Non-vacuity: if the loop checked nothing, the clause proves nothing.
    expect(checked, "no scope-captioned tile to check").toBeGreaterThan(0);
  });
});

describe("/procurement head — the ranked list", () => {
  it("carries three ranked awarders for every scope that has contracts", () => {
    const b = readBlob();
    const scopes = Object.keys(b);
    expect(scopes.length).toBeGreaterThan(5);
    let covered = 0;
    for (const s of scopes) {
      const top = b[s].topAwarders;
      // A window BEFORE the corpus legitimately has nothing — `ns:2005_06_25` is a real
      // option in the election picker and the corpus starts 2011-01-03, so its card renders
      // nothing at all. That is the coverage state, not a broken fold: assert emptiness
      // matches the contract count rather than demanding rows everywhere.
      if (b[s].contracts === 0) {
        expect(
          top ?? [],
          `${s}: no contracts but ${top?.length} awarders`,
        ).toEqual([]);
        continue;
      }
      covered++;
      expect(top, `${s}: no topAwarders`).toBeTruthy();
      expect(top!.length, `${s}: ${top!.length} awarders`).toBeGreaterThan(0);
      expect(top!.length, `${s}: more than three`).toBeLessThanOrEqual(3);
      for (const a of top!) {
        expect(a.eik, `${s}: awarder with no eik`).toBeTruthy();
        expect(a.name, `${s}: awarder with no name`).toBeTruthy();
        expect(a.eur, `${s}: ${a.name} has no money`).toBeGreaterThan(0);
      }
      // Ranked, or the heading „Най-големи" is false.
      const eurs = top!.map((a) => a.eur);
      expect(
        [...eurs].sort((x, y) => y - x),
        `${s}: not ranked`,
      ).toEqual(eurs);
    }
    // Non-vacuity: the loop must actually have checked some populated scopes, or an empty
    // fold would satisfy every assertion above by skipping all of them.
    expect(covered, "no scope with contracts to check").toBeGreaterThan(5);
  });

  // F-002: a fold that ignored the scope — every window copying `all`'s ranking — satisfied
  // every clause above, because each one only ever looks at one scope at a time.
  it("ranks a different set per window", () => {
    const b = readBlob();
    const populated = Object.entries(b).filter(
      ([, v]) => v.awarderCount > 0 && v.topAwarders.length > 0,
    );
    expect(populated.length).toBeGreaterThan(5);
    const signature = (v: BlobScope): string =>
      v.topAwarders.map((a) => `${a.eik}:${a.eur}`).join("|");
    const distinct = new Set(populated.map(([, v]) => signature(v)));
    // Not "all different" — two adjacent parliaments can genuinely share a top three. But a
    // scope-BLIND fold collapses every window onto one signature, which is what this catches.
    expect(
      distinct.size,
      `all ${populated.length} populated scopes share one ranking — the fold is not scoped`,
    ).toBeGreaterThan(populated.length / 3);
  });

  // F-011: the cross-field invariant the shape clauses cannot see.
  it("keeps each ranking inside its own window's totals", () => {
    const b = readBlob();
    for (const [s, v] of Object.entries(b)) {
      if (!v.topAwarders.length) continue;
      // Nobody can have been paid more than the window contracted…
      for (const a of v.topAwarders)
        expect(
          a.eur,
          `${s}: ${a.name} has €${a.eur} against a window total of €${v.totalEur}`,
        ).toBeLessThanOrEqual(v.totalEur as number);
      // …and three buyers cannot outnumber the buyers the window has.
      expect(
        v.topAwarders.length,
        `${s}: ${v.topAwarders.length} rows against awarderCount ${v.awarderCount}`,
      ).toBeLessThanOrEqual(v.awarderCount);
    }
  });

  it("keeps the blob under its byte budget", () => {
    // Every visitor to /procurement downloads this. Measured: 4,614 B before the ranked list
    // and 16,638 B after — bought deliberately, because the alternative is a second network
    // round-trip on every hub view, and it still replaces the ~1.65 MB of per-tile artifact
    // fetches this blob was created to end. FIVE rows instead of three would be ~26.8 KB and
    // break this ceiling, which is why the generator folds three.
    const bytes = Buffer.byteLength(
      readFileSync(
        path.join(REPO, "data/procurement/derived/hub_stats.json"),
        "utf8",
      ),
      "utf8",
    );
    expect(bytes, `hub_stats.json is ${bytes} B`).toBeLessThanOrEqual(24_000);
  });
});
