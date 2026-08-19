// Gates on the /company/:eik political-links copy — the claims it makes, not its reachability.
//
// `scripts/i18n/key_usage.test.ts` already checks that every key has a call site. Nothing checked
// that the SENTENCES are true, and this tile is the one surface in the repo whose whole history is
// a false sentence: it printed «Няма установени връзки с политици.» about an NGO chaired by a
// former Deputy PM, at a 200, because its two money-gated arms came back empty.
//
// The copy therefore has to track the query. These assertions are structural on purpose — they
// pin the PROPERTY each string must keep (it names what was searched; it carries its negation; it
// states a method rather than a verdict), not the wording, so an editor may rephrase freely and
// only a change that drops the property goes red.

import { describe, it, expect } from "vitest";
import bg from "./bg/translation.json";
import en from "./en/translation.json";

const corpus = { bg, en } as const;
const LOCALES = ["bg", "en"] as const;

describe("company_pol_none_direct — the denial names what was actually searched", () => {
  // 158 gates the direct arm on `person_role.source IN ('tr', 'ngo')` — the Commerce Register AND
  // the ЮЛНЦ register — and `db_routes.js` unions `company_politicians` and the ИСУН shard on top.
  // Naming only the first understated the search on exactly the NGO that motivated the tile: it
  // told the reader nothing was found in a register that entity is not filed in.
  //
  // ⚠️ IF THAT SOURCE SET WIDENS, THIS TEST IS THE THING THAT SHOULD FAIL. Widening the query and
  // leaving the copy is how a denial silently becomes narrower than the search behind it.
  it.each(LOCALES)("%s names the non-profit register too", (loc) => {
    const s = corpus[loc].company_pol_none_direct;
    expect(s).toMatch(loc === "bg" ? /ЮЛНЦ|нестопанск/i : /non-profit|ЮЛНЦ/i);
    expect(s).toMatch(loc === "bg" ? /регист/i : /regist/i);
  });

  it.each(LOCALES)(
    "%s is distinguishable from the could-not-check copy",
    (loc) => {
      // One says "we looked and found nobody"; the other says "we could not look". Collapsing them
      // is what turns an outage into an accusation.
      expect(corpus[loc].company_pol_none_direct).not.toBe(
        corpus[loc].company_pol_unknown,
      );
    },
  );
});

describe("company_pol_bridged_explainer — licenses one claim and denies the other", () => {
  // The bridged arm supports "someone from this company also sits at a company where an
  // office-holder sits" and NOTHING more. 158's header: merging the two arms behind one
  // confidence column "is exactly how the shards let a two-hop coincidence read as a finding".
  // ⚠️ `\b` IS ASCII-ONLY IN JS and never matches beside a Cyrillic letter, so /\bне\b/ fails on
  // a string that plainly contains „не" — a silent miss that would have made this assertion
  // unsatisfiable rather than merely wrong. Unicode lookarounds are the portable boundary.
  it.each(LOCALES)("%s carries an explicit negation", (loc) => {
    const s = corpus[loc].company_pol_bridged_explainer;
    expect(s).toMatch(
      loc === "bg" ? /(?<!\p{L})не(?!\p{L})/u : /(?<!\p{L})not(?!\p{L})/u,
    );
  });
});

describe("company_pol_basis_name_match — a method, never a verdict", () => {
  // `name_match` is the WEAKER of 158's two bases. It must not imply a confirmed identity —
  // the project's standing rule is that a shared name is never proof of the same person.
  it.each(LOCALES)(
    "%s states how it was found, not that it is confirmed",
    (loc) => {
      const s = corpus[loc].company_pol_basis_name_match;
      expect(s).toMatch(loc === "bg" ? /име/i : /name/i);
      expect(s).not.toMatch(
        loc === "bg"
          ? /потвърд|доказан|установен|същото лице/i
          : /confirm|verifi|proven|same person/i,
      );
    },
  );

  it.each(LOCALES)("%s is not the same claim as the declared basis", (loc) => {
    // Both bases must be labelled and must be told apart. Chipping only one leaves the other
    // looking like the unqualified default, which inverts the disclosure.
    expect(corpus[loc].company_pol_basis_name_match).not.toBe(
      corpus[loc].company_pol_basis_declared,
    );
  });

  it.each(LOCALES)("%s declared basis is not stated as verification", (loc) => {
    // `declared` means a curated register put this COMPANY on this person — stronger than a bare
    // fold, and still NOT a confirmed identity (148 §0.2).
    expect(corpus[loc].company_pol_basis_declared).not.toMatch(
      loc === "bg" ? /потвърд|доказан|верифиц/i : /confirm|verifi|proven/i,
    );
  });
});

describe("BG/EN parity across the whole company_pol_ family", () => {
  const keysOf = (o: Record<string, string>) =>
    Object.keys(o).filter((k) => k.startsWith("company_pol_"));

  it("neither locale carries a key the other lacks", () => {
    expect(keysOf(bg).sort()).toEqual(keysOf(en).sort());
  });

  it("no key is left empty or untranslated between locales", () => {
    for (const k of keysOf(bg)) {
      const b = (bg as Record<string, string>)[k];
      const e = (en as Record<string, string>)[k];
      expect(b.trim().length).toBeGreaterThan(0);
      expect(e.trim().length).toBeGreaterThan(0);
      // A copy-paste of the Bulgarian into the English corpus is the failure this catches;
      // Cyrillic in an EN string is only legitimate where it names a Bulgarian register.
      if (/[Ѐ-ӿ]/.test(e)) expect(e).toMatch(/ЮЛНЦ/);
    }
  });

  it("every interpolation placeholder appears in both locales", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const k of keysOf(bg)) {
      expect(vars((en as Record<string, string>)[k])).toEqual(
        vars((bg as Record<string, string>)[k]),
      );
    }
  });
});
