// Every header-menu title resolves in BOTH corpora, and every leaf has a destination.
//
// ⚠ THE MENUS ARE THE ONE PLACE A KEY IS NAMED WITH NO SURFACE TEST BEHIND IT. `t()` returns
// the key itself when it is missing, so a corpus entry deleted somewhere else renders as raw
// ASCII in the GLOBAL header — on every page, in both languages, at a 200. That is not
// hypothetical: the `/elections` band reflow removed `elections_band_partial` from both
// corpora while `reportMenus.ts` still named it, and every existing gate stayed green —
// `electionsMenu.test.ts` asserts the group titles as string LITERALS and never resolves them,
// `electionCopyCoverage.test.ts` covers the election surfaces and structurally cannot see the
// header, and `key_usage.test.ts` checks the opposite direction (corpus keys with no call
// site).
//
// ⚠ THERE IS A SECOND, QUIETER COST, which is why this is a gate rather than a note.
// `src/i18n.ts` runs `saveMissing` with `healMissingKey`, and that responds to ANY missing key
// by eagerly importing EVERY deferred locale bundle. A key in no bundle can never be healed,
// so the heal fires once per session and hands back a large part of the −22% core-corpus win
// the bundle split bought.
//
// ⚠ EVERY EXPORTED MENU, not just the one that broke. Covering the class is what stops the
// next corpus edit repeating it one dropdown over.
import { describe, expect, it } from "vitest";
import {
  consumptionMenu,
  electionsMenu,
  governanceMenu,
  type MenuItem,
} from "./reportMenus";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

const flatten = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((i) => [i, ...flatten(i.subMenu ?? [])]);

const ALL = [electionsMenu, governanceMenu, consumptionMenu].flatMap(flatten);

/** ⚠ `"-"` IS A SEPARATOR, not a key — it is the one title that must not resolve. */
const TITLES = [
  ...new Set(
    ALL.map((i) => i.title).filter((t): t is string => Boolean(t) && t !== "-"),
  ),
].sort();

describe("header menu copy", () => {
  it("is not vacuous", () => {
    // A flatten that stopped recursing, or an import that came back empty, would make every
    // assertion below pass over nothing.
    expect(TITLES.length).toBeGreaterThan(40);
    expect(TITLES).toContain("elections_band_results");
    expect(TITLES).toContain("elections_tile_presidential");
  });

  it.each([
    ["bg", bgCorpus],
    ["en", enCorpus],
  ])("%s resolves every menu title", (_lang, corpus) => {
    const missing = TITLES.filter((k) => !(k in corpus));
    expect(missing, `missing: ${missing.join(", ")}`).toEqual([]);
  });

  it.each([
    ["bg", bgCorpus],
    ["en", enCorpus],
  ])("%s carries no EMPTY value for one", (_lang, corpus) => {
    // A blank value passes membership and renders an empty label — harder to spot than a raw
    // identifier, and invisible to the test above.
    const blank = TITLES.filter((k) => (corpus[k] ?? "").trim() === "");
    expect(blank, `blank: ${blank.join(", ")}`).toEqual([]);
  });

  it("gives every leaf a non-empty destination", () => {
    // ⚠ A GROUP HEADING HAS NO LINK BY DESIGN; a LEAF with an empty one renders `href=""`,
    // which navigates to the current page and looks like a dead click rather than an error.
    // The presidential leaf builds its link through `presidentialUrl`, which returns null on
    // an empty cycle — this is what catches a catalogue that went blank.
    const leaves = ALL.filter((i) => !i.group && !i.subMenu && i.title !== "-");
    expect(leaves.length).toBeGreaterThan(30);
    expect(leaves.filter((i) => !i.link?.trim()).map((i) => i.title)).toEqual(
      [],
    );
  });
});
