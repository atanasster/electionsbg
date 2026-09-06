// The `/elections` tile registry: shape, destinations, scenes and the cycle rewrite.
//
// Every clause is about something that renders as a working page when it is wrong — a tile
// pointing at a dead route still looks like a tile, a duplicated scene still draws, and a tile
// pinned to last cycle still navigates. None of them is visible in review.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ELECTIONS_BANDS,
  ELECTIONS_TILES,
  TILES_PER_BAND,
  WITHHELD_TILES,
  withCycle,
  withLocalCycle,
  type ElectionsTile,
  type TileBlocker,
} from "./electionsRegistry";
import { ELECTIONS_SCENES } from "./electionsScenes";
import {
  CYCLE_SURFACE,
  KINDS_WITHOUT_SURFACE,
  type ElectionsHubKind,
} from "./electionsHubCycle";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

const REPO = path.resolve(__dirname, "../../..");
const routerSrc = readFileSync(path.join(REPO, "src/routes.tsx"), "utf-8");

/**
 * The blockers that ACTUALLY apply to a tile of `kind` aimed at `band`, recomputed from the
 * registry rather than read off the entry that claims them.
 *
 * ⚠ BOTH INPUTS ARE INJECTABLE, AND THAT IS NOT GENERALITY FOR ITS OWN SAKE. The live ones are
 * DEGENERATE: `KINDS_WITHOUT_SURFACE` is empty and every band holds exactly `TILES_PER_BAND`
 * tiles, so against them alone this function is indistinguishable from `() => ["band-full"]` —
 * measured, deleting either arm left all 19 tests green. The synthetic cases below are what
 * make the rule falsifiable while nothing is withheld.
 *
 * ⚠ IT THROWS ON AN UNKNOWN BAND rather than returning `[]`. An empty list is the answer
 * „nothing is in the way", i.e. „ship it" — which is exactly the wrong answer for a tile
 * pointed at a band nobody declares.
 */
const blockersFor = (
  kind: Exclude<ElectionsHubKind, "parliamentary">,
  band: string,
  bands: readonly { id: string; tiles: readonly unknown[] }[] = ELECTIONS_BANDS,
  without: readonly ElectionsHubKind[] = KINDS_WITHOUT_SURFACE,
): TileBlocker[] => {
  const home = bands.find((b) => b.id === band);
  if (!home) throw new Error(`no band "${band}"`);
  return [
    ...(without.includes(kind) ? (["route"] as const) : []),
    ...(home.tiles.length >= TILES_PER_BAND ? (["band-full"] as const) : []),
  ];
};

describe("elections bands", () => {
  it("is four described bands of four tiles", () => {
    // ⚠ FOUR PER BAND IS A LAYOUT RULE, not a preference: the grid is 4 columns at `xl`, so a
    // band of 5 leaves a lone tile on its last row (§6.1 — 4/3/4 beats 3/3/5). The number
    // lives in the registry beside the rule; `blockersFor` reads the same constant, so a grid
    // that moved to 5 columns cannot leave one of the two behind.
    expect(ELECTIONS_BANDS).toHaveLength(4);
    for (const b of ELECTIONS_BANDS) {
      expect(b.tiles, b.id).toHaveLength(TILES_PER_BAND);
      expect(b.labelKey, b.id).toBeTruthy();
      expect(b.descKey, b.id).toBeTruthy();
    }
  });

  it("ELECTIONS_TILES is derived, not a second hand-maintained list", () => {
    expect(ELECTIONS_TILES).toEqual(ELECTIONS_BANDS.flatMap((b) => b.tiles));
  });

  it("every tile id, destination and scene is unique", () => {
    const ids = ELECTIONS_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tos = ELECTIONS_TILES.map((t) => t.to);
    expect(new Set(tos).size).toBe(tos.length);
    const fns = ELECTIONS_TILES.map((t) => ELECTIONS_SCENES[t.id]);
    expect(new Set(fns).size).toBe(fns.length);
  });

  it("no accent repeats on the composed page", () => {
    // The screen renders this registry and no other, so its own set is the composed page.
    const accents = ELECTIONS_TILES.map((t) => t.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });

  it("no band heading is an instruction or a container word", () => {
    // A hub's headings are its table of contents (§6.1).
    const BANNED = [
      "разгледай",
      "още",
      "виж",
      "browse",
      "more",
      "see",
      "explore",
      "other",
    ];
    for (const b of ELECTIONS_BANDS)
      for (const corpus of [bgCorpus, enCorpus]) {
        const label = corpus[b.labelKey];
        expect(label, `${b.id} has no heading copy`).toBeTruthy();
        for (const w of BANNED)
          expect(
            label.toLocaleLowerCase("bg").split(/[\s,·—-]+/),
            `${b.id}: "${label}"`,
          ).not.toContain(w);
      }
  });
});

describe("destinations", () => {
  it("every destination is absolute and in-app", () => {
    for (const t of ELECTIONS_TILES) {
      expect(t.to.startsWith("/"), t.id).toBe(true);
      expect(t.to.startsWith("//"), t.id).toBe(false);
      expect(/^https?:/.test(t.to), t.id).toBe(false);
    }
  });

  it("every destination is a route the router actually declares", () => {
    // A tile pointing at an undeclared path still renders and still navigates, straight to
    // the SPA fallback.
    for (const t of ELECTIONS_TILES) {
      const first = t.to.replace(/^\//, "").split("/")[0];
      expect(
        routerSrc.includes(`path="${first}"`) ||
          routerSrc.includes(`path="${first}/`),
        `${t.id} -> ${t.to}: no route declares "${first}"`,
      ).toBe(true);
    }
  });

  it("carries no per-tile CTA and no query string", () => {
    // §6.1: no tile carries a per-tile CTA. And a `?` here would be a scope this hub does not
    // own — the cycle travels as `?elections`, which `usePreserveParams` already carries.
    for (const t of ELECTIONS_TILES) {
      expect(t.to, t.id).not.toContain("?");
      expect(Object.keys(t), t.id).not.toContain("cta");
    }
  });

  it("does not point at itself", () => {
    expect(ELECTIONS_TILES.filter((t) => t.to === "/elections")).toEqual([]);
  });
});

describe("the cycle rewrite", () => {
  it("marks exactly the destinations that embed a cycle", () => {
    // ⚠ DERIVED FROM THE PATH, NOT RESTATED. A hand-kept list is how `/local/chmi` — whose
    // second segment is a PAGE, not a cycle — ends up flagged and rewritten into a route that
    // does not exist.
    const embeds = (to: string): ElectionsTile["cycleScoped"] =>
      to.startsWith(`/local/${LATEST_LOCAL_CYCLE}`)
        ? "local"
        : to.startsWith(`/presidential/${LATEST_PRESIDENTIAL_CYCLE}`)
          ? "presidential"
          : undefined;
    // ⚠ THE WITHHELD TILES TOO. Their `to` is what T5 will ship, so a mis-flagged one would
    // land already broken — and a flag naming the WRONG kind is a silent no-op rather than
    // an error, since `withCycle` matches that kind's own latest id and simply finds
    // nothing.
    for (const t of [...ELECTIONS_TILES, ...WITHHELD_TILES.map((w) => w.tile)])
      expect(t.cycleScoped, `${t.id} (${t.to})`).toBe(embeds(t.to));
  });

  it("substitutes the cycle of the KIND the tile names", () => {
    // ⚠ One rewrite over „does it embed a cycle" would have to guess the catalogue, and a
    // wrong guess is a NO-OP: the pattern does not match, so the tile silently keeps
    // pointing at the latest cycle rather than the reader's.
    expect(
      withCycle(
        `/presidential/${LATEST_PRESIDENTIAL_CYCLE}`,
        "presidential",
        "2016_11_06_pvr",
      ),
    ).toBe("/presidential/2016_11_06_pvr");
    // Asking for the wrong kind leaves it untouched — which is exactly why the flag carries
    // the kind rather than a boolean.
    expect(
      withCycle(
        `/presidential/${LATEST_PRESIDENTIAL_CYCLE}`,
        "local",
        "2019_10_27_mi",
      ),
    ).toBe(`/presidential/${LATEST_PRESIDENTIAL_CYCLE}`);
    expect(
      withCycle(`/local/${LATEST_LOCAL_CYCLE}`, "local", "2019_10_27_mi"),
    ).toBe("/local/2019_10_27_mi");
  });

  it("rewrites only the cycle segment, on a path that has one", () => {
    const older = "2019_10_27_mi";
    expect(withLocalCycle(`/local/${LATEST_LOCAL_CYCLE}`, older)).toBe(
      `/local/${older}`,
    );
    expect(withLocalCycle(`/local/${LATEST_LOCAL_CYCLE}/runoffs`, older)).toBe(
      `/local/${older}/runoffs`,
    );
    // ⚠ THE TWO IT MUST LEAVE ALONE. `/local/chmi` is the partial-elections feed and has no
    // cycle; `/parliamentary` is not a local path at all.
    expect(withLocalCycle("/local/chmi", older)).toBe("/local/chmi");
    expect(withLocalCycle("/parliamentary", older)).toBe("/parliamentary");
  });

  it("does not rewrite a cycle that merely starts with the latest one", () => {
    // The `(?=/|$)` lookahead. Without it a hypothetical `/local/2023_10_29_mix` would be
    // half-rewritten into a path naming neither cycle.
    expect(
      withLocalCycle(`/local/${LATEST_LOCAL_CYCLE}x`, "2019_10_27_mi"),
    ).toBe(`/local/${LATEST_LOCAL_CYCLE}x`);
  });
});

describe("scenes", () => {
  it("every tile has one", () => {
    // `InfographicTile` renders `<Scene />` unguarded, so a missing one is `undefined` as a
    // component type: "Element type is invalid" and a white screen.
    for (const t of ELECTIONS_TILES)
      expect(ELECTIONS_SCENES[t.id], t.id).toBeTypeOf("function");
  });

  it("none is orphaned — a WITHHELD tile still claims its scene", () => {
    // ⚠ A SCENE WITH NO TILE HAS TWO CAUSES AND ONLY ONE IS A DEFECT. „Orphaned by a
    // deletion" and „built, waiting for its route" look identical in an id-set difference,
    // so the registry names the withheld ones rather than leaving the gate to guess.
    const ids = new Set([
      ...ELECTIONS_TILES.map((t) => t.id),
      ...WITHHELD_TILES.map((w) => w.tile.id),
    ]);
    expect(Object.keys(ELECTIONS_SCENES).filter((k) => !ids.has(k))).toEqual(
      [],
    );
  });

  it("a withheld tile is complete, and every blocker still bites", () => {
    // ⚠ WITHHOLDING MUST NOT BECOME A PLACE TO PARK A HALF-BUILT TILE — and it must not
    // become a place to park a stale excuse either. Every blocker is re-checked here, so one
    // that has been resolved turns this RED rather than sitting in the registry claiming a
    // constraint that no longer exists. It is the „a stale exception fails too" shape.
    //
    // ⚠ AND THE PAGE-LEVEL INVARIANTS ARE CHECKED, not just the tile's own fields. A first
    // draft asserted keys, scene and route prefix and called that „already right"; measured,
    // the presidential tile duplicated `runoffs`' accent and overflowed its band, so shipping
    // it would have landed on two red gates. Neither is visible in the fields.
    // ⚠ RE-CHECKS WHAT THE „no accent repeats" TEST ALREADY COVERS while nothing is withheld
    // — `composed` is `ELECTIONS_TILES` today — and becomes meaningful again the moment
    // something is parked, which is the run that would otherwise discover the clash.
    const composed = [...ELECTIONS_TILES, ...WITHHELD_TILES.map((w) => w.tile)];
    const accents = composed.map((t) => t.accent);
    expect(
      new Set(accents).size,
      "a withheld tile duplicates an accent already on this page — the rule is per PAGE",
    ).toBe(accents.length);

    for (const { tile, kind, band, blockers } of WITHHELD_TILES) {
      expect(tile.cycleScoped, tile.id).toBe(kind);
      expect(tile.to.startsWith(CYCLE_SURFACE[kind].prefix), tile.id).toBe(
        true,
      );
      expect(ELECTIONS_SCENES[tile.id], tile.id).toBeTypeOf("function");
      // …and it really is out of the bands, so „withheld" is not just a label.
      expect(
        ELECTIONS_TILES.some((t) => t.id === tile.id),
        tile.id,
      ).toBe(false);
      const home = ELECTIONS_BANDS.find((b) => b.id === band);
      expect(
        home,
        `${tile.id} names band "${band}", which does not exist`,
      ).toBeTruthy();
      // ⚠ EXACTLY the constraints that currently apply — both directions. Checking only
      // that a LISTED blocker still holds catches the stale excuse and misses the opposite:
      // dropping „band-full" while the band is full reads as „ready to ship" and lands on
      // the four-per-band gate instead. Recomputing the set makes the list a statement the
      // registry cannot get wrong in either direction.
      expect(
        [...blockers].sort(),
        `${tile.id}: the blockers it lists are not the constraints that apply`,
      ).toEqual([...blockersFor(kind, band)].sort());
      // ⚠ NO `toBeGreaterThan(0)` HERE: `WITHHELD_TILES` is filtered on `blockers.length > 0`,
      // so a non-empty `blockers` is guaranteed and the `toEqual` above already fails when the
      // recompute returns nothing. The „withheld with nothing blocking it" case is caught by
      // that comparison, not by a second assertion that can never fire first.
    }
  });

  it("the blocker rule still discriminates on an empty withheld list", () => {
    // ⚠ THE LOOP ABOVE IS VACUOUS TODAY. Nothing is withheld since the presidential tile
    // shipped on 2026-09-07, and a `for` over an empty list passes whatever the recompute
    // says — including nothing at all. So the rule is exercised against the case the registry
    // actually held: the presidential tile, waiting for the four-tile `results` band.
    expect(blockersFor("presidential", "results")).toEqual(["band-full"]);
    // ⚠ BOTH ARMS, AGAINST SYNTHETIC INPUTS. The live ones cannot separate the rule from a
    // constant — measured: deleting the `route` arm, and replacing the tile-count test with
    // `true`, each left this file entirely green.
    expect(
      blockersFor("presidential", "results", ELECTIONS_BANDS, ["presidential"]),
      "the route arm no longer fires for a kind with no surface",
    ).toEqual(["route", "band-full"]);
    expect(
      blockersFor("presidential", "half", [{ id: "half", tiles: [1, 2, 3] }]),
      "the band-full arm fires on a band that still has room",
    ).toEqual([]);
    // …and a band that does not exist must not silently score as „ready".
    expect(() => blockersFor("presidential", "no-such-band")).toThrow();
    // The converse of the loop's „really is out of the bands": a tile ON the page is never
    // also listed as withheld.
    for (const t of ELECTIONS_TILES)
      expect(
        WITHHELD_TILES.some((w) => w.tile.id === t.id),
        t.id,
      ).toBe(false);
  });
});

describe("i18n keys", () => {
  it("no key is built from a template", () => {
    // A built template defeats the reachability analysis: `bundle_reachability.test.ts` treats
    // one as naming EVERY key it could match.
    const src = readFileSync(
      path.join(REPO, "src/screens/elections/electionsRegistry.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/(titleKey|descKey|labelKey):\s*`/);
  });

  it("every key resolves in BOTH corpora", () => {
    // ⚠ A KEY PRESENT IN bg AND MISSING IN en RENDERS AS ITS OWN IDENTIFIER on the English
    // page, at a 200 — and the render suite only ever loads bg.
    const keys = [
      ...ELECTIONS_BANDS.flatMap((b) => [b.labelKey, b.descKey]),
      // ⚠ WITHHELD TILES TOO. Nothing renders them, so this gate is the only thing between
      // a dropped `en` key and the identifier appearing on the page the day they ship.
      ...[...ELECTIONS_TILES, ...WITHHELD_TILES.map((w) => w.tile)].flatMap(
        (t) => [t.titleKey, t.descKey],
      ),
    ];
    for (const k of keys) {
      expect(bgCorpus[k], `bg is missing ${k}`).toBeTruthy();
      expect(enCorpus[k], `en is missing ${k}`).toBeTruthy();
    }
  });
});

describe("the prerendered crawlable mirror", () => {
  it("matches the tile registry exactly — headings, order and destinations", () => {
    // ⚠ A SECOND LIST OF THE SAME SIXTEEN, across the Node/browser boundary: the prerender
    // cannot import the registry (`TILE_ACCENTS` drags the React barrel in), so the comparison
    // is TEXTUAL — the treatment `HOME_DESTINATIONS` already gets in `homeHubBands.test.ts`.
    // Until this existed, `ELECTIONS_HUB_SECTIONS`' own comment was the only thing keeping the
    // two in step, and it said so: „kept in step with the registry BY HAND".
    const src = readFileSync(
      path.join(REPO, "scripts/prerender/routes.ts"),
      "utf-8",
    );
    const block = /const ELECTIONS_HUB_SECTIONS[\s\S]*?\n\];/.exec(src);
    expect(
      block,
      "ELECTIONS_HUB_SECTIONS not found — did it move or change shape?",
    ).toBeTruthy();

    // Paths are written both "quoted" and `templated`; resolve the two cycle constants.
    const resolve = (raw: string): string =>
      "/" +
      raw
        .replace("${LATEST_LOCAL_CYCLE}", LATEST_LOCAL_CYCLE)
        .replace("${LATEST_PRESIDENTIAL_CYCLE}", LATEST_PRESIDENTIAL_CYCLE);
    const paths = [...block![0].matchAll(/path:\s*[`"]([^`"]+)[`"]/g)].map(
      (m) => resolve(m[1]),
    );

    // ⚠ ALLOWLISTED BY NAME, never by relaxing the comparison: `independents` is a link with
    // no tile ON PURPOSE — it left the sixteen slots when the presidential tile arrived, and
    // the page is neither prerendered nor sitemapped, so this is one of its few crawlable
    // entries.
    const LINKS_WITHOUT_A_TILE = [`/local/${LATEST_LOCAL_CYCLE}/independents`];
    expect(paths.filter((p) => !LINKS_WITHOUT_A_TILE.includes(p))).toEqual(
      ELECTIONS_TILES.map((t) => t.to),
    );
    for (const extra of LINKS_WITHOUT_A_TILE) expect(paths).toContain(extra);

    // Headings are the bands' own copy, in band order, in BOTH languages.
    const headings = [
      ...block![0].matchAll(/\n {4}bg:\s*"([^"]+)",\n {4}en:\s*"([^"]+)",/g),
    ];
    expect(headings.map((m) => m[1])).toEqual(
      ELECTIONS_BANDS.map((b) => bgCorpus[b.labelKey]),
    );
    expect(headings.map((m) => m[2])).toEqual(
      ELECTIONS_BANDS.map((b) => enCorpus[b.labelKey]),
    );
  });
});
