// The rule table's own contracts — the ones `translitSearch.test.ts` cannot see because it
// only ever observes the table through the client's ch→h collapse, which HIDES the very
// property this file exists to establish: that the table is written in the Streamlined
// alphabet so Postgres can use it unmodified.

import { describe, it, expect } from "vitest";
import {
  SHLYO_RULES,
  SHLYO_TRIGGER,
  applyShlyoRules,
  applyShlyoRulesCollapsed,
} from "./shlyoRules";
import { shlyoSkeleton, searchMatches } from "./translitSearch";

describe("the table targets the Streamlined alphabet", () => {
  it("folds ч to 'ch', NOT to the client's collapsed 'h'", () => {
    // The whole reason this file exists. `4 → "h"` is correct against
    // `latinSkeleton`'s alphabet and would match nothing against a stored
    // `translit_bg_latin()` fold, where ч is "ch" and х is "h".
    expect(applyShlyoRules("4erven")).toBe("cherven");
    expect(applyShlyoRules("4erven")).not.toBe("herven");
  });

  it("has a collapsed twin for the client's alphabet", () => {
    expect(applyShlyoRulesCollapsed("4erven")).toBe("herven");
    expect(shlyoSkeleton("4erven")).toBe("herven");
  });

  it("leaves х as 'h' — the two are distinct server-side", () => {
    expect(applyShlyoRules("xubav")).toBe("hubav");
  });
});

describe("order dependencies", () => {
  it("applies 6t before 6, so щ does not become 'sht' via two rules", () => {
    expect(applyShlyoRules("6tastie")).toBe("shtastie");
    expect(applyShlyoRules("6umen")).toBe("shumen");
  });

  it("applies the ya producers before the y rule", () => {
    // "q"→"ya" emits a `y` followed by `a`, which the y rule's lookahead must
    // then decline to touch. If the y rule ran first, or the lookahead were
    // dropped, this would be "saofia".
    expect(applyShlyoRules("sofiq")).toBe("sofiya");
    expect(applyShlyoRules("9nuari")).toBe("yanuari");
  });

  it("rewrites a bare y (ъ) but never a y that starts a real й/ю/я", () => {
    expect(applyShlyoRules("jelezopyten")).toBe("zhelezopaten");
    expect(applyShlyoRules("sofiya")).toBe("sofiya");
    expect(applyShlyoRules("yordanov")).toBe("yordanov");
  });
});

describe("SHLYO_TRIGGER agrees with the rules it guards", () => {
  // A trigger that misses a rule makes that rule dead code — the fast exit in
  // `searchMatches` would return false before the rewrite ever ran.
  const CASES = [
    "6tastie",
    "6umen",
    "4erven",
    "9nuari",
    "sofiq",
    "jelezo",
    "plowdiw",
    "xubav",
    "pyten",
  ];
  it.each(CASES)("fires for %s, which the rules do rewrite", (s) => {
    expect(SHLYO_TRIGGER.test(s)).toBe(true);
    expect(applyShlyoRules(s)).not.toBe(s);
  });

  it.each(["sofiya", "yordanov", "mariya", "plovdiv", "ivanov"])(
    "does not fire for %s, which the rules leave alone",
    (s) => {
      expect(SHLYO_TRIGGER.test(s)).toBe(false);
      expect(applyShlyoRules(s)).toBe(s);
    },
  );

  it("is stateless — a global regex here would alternate true/false", () => {
    expect(SHLYO_TRIGGER.test("6umen")).toBe(true);
    expect(SHLYO_TRIGGER.test("6umen")).toBe(true);
  });
});

describe("the table's stated exclusions", () => {
  it("does not map c → ts", () => {
    // Present, it would refold every Latin trade name carrying a "c" away from
    // what the reader typed. The НЗОК universes are majority Latin.
    expect(SHLYO_RULES.some((r) => r.find === "c")).toBe(false);
    expect(applyShlyoRules("abemaciclib")).toBe("abemaciclib");
    expect(searchMatches("Abemaciclib", "abemacic")).toBe(true);
  });

  it("every rule declares which letter it recovers", () => {
    // The `why` is what the generated SQL's comments are built from, so an
    // empty one ships a rule nobody can read.
    for (const r of SHLYO_RULES) expect(r.why.trim().length).toBeGreaterThan(0);
  });

  it("every `find` is a valid pattern in both engines' shared subset", () => {
    // Postgres ARE supports (?!…); a rule using a JS-only construct would
    // compile here and fail at migration time.
    const JS_ONLY = /\\[dswbDSWB]|\\p\{|\(\?<|\\k</;
    for (const r of SHLYO_RULES) {
      expect(() => new RegExp(r.find, "g")).not.toThrow();
      expect(JS_ONLY.test(r.find)).toBe(false);
    }
  });
});

// THE EQUIVALENCE GATE. Everything above tests the table against its own description;
// this tests it against the implementation it replaced, which is the only thing that can
// establish "behaviour-preserving".
//
// It exists because the first draft was NOT. It collapsed ch→h over the finished string
// rather than over each rule's replacement, which also ate `ch` sequences no rule
// produced — and since the collapse deletes a character, that turned a rewrite contracted
// to be purely additive into one that dropped real matches. Every one of the 83 tests
// then in the tree passed.
describe("equivalence with the pre-extraction table", () => {
  // The table exactly as it was hand-written in translitSearch.ts, in the client's
  // collapsed alphabet. Frozen: this is a reference, not a thing to keep in sync.
  const LEGACY: [RegExp, string][] = [
    [/6t/g, "sht"],
    [/6/g, "sh"],
    [/4/g, "h"],
    [/9/g, "ya"],
    [/q/g, "ya"],
    [/j/g, "zh"],
    [/w/g, "v"],
    [/x/g, "h"],
    [/y(?![aeiou])/g, "a"],
  ];
  const legacyApply = (base: string): string => {
    let out = base;
    for (const [re, to] of LEGACY) out = out.replace(re, to);
    return out;
  };

  it("agrees on every string over the alphabet the rules can see, to length 4", () => {
    // 'c' and 'h' are in the alphabet deliberately — they are how the output-level
    // collapse broke, and a corpus without them cannot fail.
    const ALPHA = "469qjwxycha".split("");
    const diffs: string[] = [];
    const walk = (s: string) => {
      if (s) {
        if (applyShlyoRulesCollapsed(s) !== legacyApply(s)) diffs.push(s);
      }
      if (s.length === 4) return;
      for (const c of ALPHA) walk(s + c);
    };
    walk("");
    expect(diffs.slice(0, 10)).toEqual([]);
  });

  it("agrees on the two shapes the output-level collapse got wrong", () => {
    // 1: x→h landing after a literal c. 2: a `ch` latinSkeleton itself emitted,
    // because it collapses before stripping punctuation.
    expect(applyShlyoRulesCollapsed("cx")).toBe("ch");
    expect(applyShlyoRulesCollapsed("basicholdingq")).toBe("basicholdingya");
    expect(legacyApply("cx")).toBe("ch");
  });

  it("keeps the rewrite ADDITIVE — the alt needle never loses a literal match", () => {
    // The contract in one assertion: whatever the old needle matched, the new one
    // matches too. "basic xolding" is the real end-to-end case that regressed.
    expect(searchMatches("Basic Holding", "basic xolding")).toBe(true);
    expect(searchMatches("Шумен", "6umen")).toBe(true);
    expect(searchMatches("Червен бряг", "4erven")).toBe(true);
    expect(searchMatches("София", "sofiq")).toBe(true);
  });
});
