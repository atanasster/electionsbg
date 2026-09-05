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
  WITHHELD_TILES,
  withCycle,
  withLocalCycle,
  type ElectionsTile,
  type TileBlocker,
} from "./electionsRegistry";
import { ELECTIONS_SCENES } from "./electionsScenes";
import { CYCLE_SURFACE, KINDS_WITHOUT_SURFACE } from "./electionsHubCycle";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";
import { LATEST_PRESIDENTIAL_CYCLE } from "@/data/presidentialCatalogue";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

const REPO = path.resolve(__dirname, "../../..");
const routerSrc = readFileSync(path.join(REPO, "src/routes.tsx"), "utf-8");

describe("elections bands", () => {
  it("is four described bands of four tiles", () => {
    // ⚠ FOUR PER BAND IS A LAYOUT RULE, not a preference: the grid is 4 columns at `xl`, so a
    // band of 5 leaves a lone tile on its last row (§6.1 — 4/3/4 beats 3/3/5).
    expect(ELECTIONS_BANDS).toHaveLength(4);
    for (const b of ELECTIONS_BANDS) {
      expect(b.tiles, b.id).toHaveLength(4);
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
    // the tile duplicated `runoffs`' accent and overflowed its band, so shipping it would
    // have landed on two red gates. Neither is visible in the fields.
    const composed = [...ELECTIONS_TILES, ...WITHHELD_TILES.map((w) => w.tile)];
    const accents = composed.map((t) => t.accent);
    expect(
      new Set(accents).size,
      "a withheld tile duplicates an accent already on this page — the rule is per PAGE",
    ).toBe(accents.length);

    for (const { tile, kind, band, blockers } of WITHHELD_TILES) {
      expect(tile.cycleScoped, tile.id).toBe(kind);
      expect(tile.to.startsWith(CYCLE_SURFACE[kind].href("")), tile.id).toBe(
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
      const applies: TileBlocker[] = [
        ...(KINDS_WITHOUT_SURFACE.includes(kind) ? (["route"] as const) : []),
        ...(home!.tiles.length >= 4 ? (["band-full"] as const) : []),
      ];
      expect(
        [...blockers].sort(),
        `${tile.id}: the blockers it lists are not the constraints that apply`,
      ).toEqual([...applies].sort());
      expect(
        applies.length,
        `${tile.id} is withheld and nothing blocks it — put it in ${band}`,
      ).toBeGreaterThan(0);
    }
    // The control: there IS something withheld right now, so the loop is not vacuous.
    expect(WITHHELD_TILES.map((w) => w.tile.id)).toEqual(["presidential"]);
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
