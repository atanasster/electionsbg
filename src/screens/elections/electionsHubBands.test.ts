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
  withLocalCycle,
} from "./electionsRegistry";
import { ELECTIONS_SCENES } from "./electionsScenes";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";
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
    const embeds = (to: string) =>
      to.startsWith(`/local/${LATEST_LOCAL_CYCLE}`);
    for (const t of ELECTIONS_TILES)
      expect(Boolean(t.cycleScoped), `${t.id} (${t.to})`).toBe(embeds(t.to));
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

  it("none is orphaned", () => {
    const ids = new Set(ELECTIONS_TILES.map((t) => t.id));
    expect(Object.keys(ELECTIONS_SCENES).filter((k) => !ids.has(k))).toEqual(
      [],
    );
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
      ...ELECTIONS_TILES.flatMap((t) => [t.titleKey, t.descKey]),
    ];
    for (const k of keys) {
      expect(bgCorpus[k], `bg is missing ${k}`).toBeTruthy();
      expect(enCorpus[k], `en is missing ${k}`).toBeTruthy();
    }
  });
});
