// `EXAMPLE_TERMS` — the chips on the empty search box — as a claim about the corpus.
//
// WHY A TEST FOR THREE STRINGS. They are the first thing a new reader clicks, and the
// constant's own contract is that each returns rows: a chip that returns nothing is a worse
// introduction than no chip. The /persons set shipped that defect once (a hyphen-minus where
// the corpus writes an em dash — 0 rows against 47), and this corpus has two hazards of its
// own that are easier to hit:
//
//   · 14,751 of the 1,022,592 names carry a literal `&quot;`, so a chip spelled with real
//     quotation marks matches nothing;
//   · `companies.name` has `searchFold` but NOT `searchFoldTokens`, so a multi-word chip must
//     be a CONTIGUOUS substring of a real name — „софарма търговия" matches nothing even
//     though the first word does.
//
// This runs WITHOUT Postgres, so it cannot check row counts. What it can check is the class of
// mistake that produces the defect — a value typed from memory rather than copied from the
// data — plus the rules that make a chip meaningful on this resource. The counts in
// `companiesBrowseConstants.ts` are the measured half.

import { describe, it, expect } from "vitest";
import {
  EXAMPLE_TERMS,
  companiesScopeCount,
  COMPANIES_LANDING_CARDS,
} from "./companiesBrowseConstants";
import {
  NARROWING_PARAMS,
  COMPANY_CLASSES,
} from "@/data/companies/useUrlCompanyFilters";
import { assertRegistryExamples } from "@/screens/components/exampleTerms.testkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The engine's own routing rule for this resource, READ OUT OF THE ENGINE rather than
 *  restated — `searchWhen` on the `companies` resource's `uic` column (functions/db_table.js),
 *  which the engine itself anchors, so a `^…$` here is semantically exact.
 *
 *  ⚠️ NOT A HAND-COPIED LITERAL. The first draft restated `/^[0-9]{8,14}$/` on the grounds that
 *  „a Vitest suite cannot import the Functions bundle", which is false in this repo:
 *  `searchTerm.test.ts` readFileSync's the same file for exactly this purpose. A copied regex
 *  drifts the day the resource's routing widens, and the drift is silent — the chip set would
 *  keep passing while the arm it claims to demonstrate had moved. */
const EIK_SHAPE = (() => {
  const src = readFileSync(
    resolve(__dirname, "../../../functions/db_table.js"),
    "utf8",
  );
  // ⚠️ LINE-ANCHORED, and that is not pedantry. `indexOf("  companies: {")` finds a COLUMN
  // named `companies` on an earlier resource — `companies: { type: "text", … }` indented six
  // spaces contains the two-space needle as a substring — and the first `searchWhen` after it
  // belongs to `contractor_rank`, whose rule is
  // `[0-9]{8,14}|(obed|ph|np)-[0-9a-f]{6,32}` (it admits supplier_identity's synthetic keys,
  // which this corpus has none of). That is the blind-gate failure this whole derivation exists
  // to avoid, and it does not throw — it silently gates against the wrong resource.
  const block = src.slice(src.search(/^ {2}companies: \{/m));
  // …then the `uic` column INSIDE that block, by name, rather than "the next searchWhen".
  const uic = block.slice(block.search(/^ {6}uic: \{/m));
  const m = uic.match(/searchWhen:\s*"([^"]+)"/);
  if (!m)
    throw new Error(
      "could not read the companies resource's uic searchWhen out of " +
        "functions/db_table.js — this gate has gone blind, which is worse than the drift it " +
        "exists to catch. Fix the pattern, do not delete it.",
    );
  return new RegExp(`^${m[1]}$`);
})();

describe("EXAMPLE_TERMS", () => {
  it("satisfies the rules that hold for any registry chip set", () => {
    // The floor and the set size are properties of a CHIP SET, not of this corpus, so they live
    // in the shared testkit. Everything below is a hazard specific to `company_browse_table`,
    // and stays here because the assertion IS the documentation of the hazard.
    assertRegistryExamples(EXAMPLE_TERMS);
  });

  it("⚠️ no chip carries a quotation mark — 14,751 names store `&quot;` instead", () => {
    // „НАЦИОНАЛНА КОМПАНИЯ &quot;ЖЕЛЕЗОПЪТНА ИНФРАСТРУКТУРА&quot;" is the literal stored value.
    // The screen decodes entities for DISPLAY, so a name looks quoted on the page and is not in
    // the column the search reads — which makes this the easiest possible chip to type from the
    // rendered page and have return nothing.
    for (const term of EXAMPLE_TERMS)
      expect(
        term,
        `"${term}" contains a quote the corpus stores as an entity`,
      ).not.toMatch(/["'„“”«»]/);
  });

  it("no chip carries a hyphen-minus between words", () => {
    // The /persons defect, generalised: punctuation is not folded, so a dash typed from memory
    // in place of the one the corpus uses returns „няма резултати", which reads as an empty
    // corpus rather than as a typo.
    //
    // ⚠️ SUBSUMED TODAY by the single-token rule further down — a chip with no whitespace cannot
    // contain a SPACED hyphen — so this cannot independently fail while that rule holds. It is
    // kept for the case that rule's own message invites: a multi-word chip verified with a
    // SELECT. Note the hazard THIS corpus actually has is the UNSPACED hyphen
    // („БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ"), which is a legitimate spelling here and deliberately NOT
    // rejected — so do not "strengthen" this regex by dropping its \s.
    for (const term of EXAMPLE_TERMS)
      expect(
        term,
        `"${term}" uses a hyphen where the corpus may use an em dash`,
      ).not.toMatch(/\S\s-\s\S/);
  });

  it("offers BOTH kinds the box accepts — a name and an EIK", () => {
    // The point of the set is to teach what the box accepts, and this resource routes by SHAPE:
    // digits go to the exact `uic` arm, everything else to the name fold. A set of three names
    // would never show that an EIK works — which is the query a reader arriving from a document
    // or an invoice actually has.
    const eiks = EXAMPLE_TERMS.filter((t) => EIK_SHAPE.test(t.trim()));
    const names = EXAMPLE_TERMS.filter((t) => !EIK_SHAPE.test(t.trim()));
    expect(eiks.length, "no EIK chip — the uic arm is never demonstrated").toBe(
      1,
    );
    expect(names.length, "no name chip").toBeGreaterThan(0);
  });

  it("every non-EIK chip is Cyrillic — these are values in a Bulgarian corpus", () => {
    // Deliberately untranslated: an English chip returns nothing. Asserted so the choice is a
    // decision rather than an oversight the next reader has to guess at. The EIK is exempt for
    // the obvious reason.
    for (const term of EXAMPLE_TERMS.filter((t) => !EIK_SHAPE.test(t.trim())))
      expect(term, `"${term}" is not Cyrillic`).toMatch(/\p{Script=Cyrillic}/u);
  });

  it("the EIK rule was read from the RIGHT resource", () => {
    // The derivation above is only worth having if it cannot silently gate against a different
    // resource — which the first draft did. `companies.uic` admits digits ONLY; `contractor_rank`
    // additionally admits supplier_identity's `obed-`/`ph-`/`np-` synthetic keys, and this corpus
    // (tr_companies.uic) holds none of them.
    expect(EIK_SHAPE.test("831646048")).toBe(true);
    expect(
      EIK_SHAPE.test("obed-1a2b3c4d"),
      "the searchWhen was read from contractor_rank, not from companies",
    ).toBe(false);
  });

  it("⚠️ every chip is a SINGLE token", () => {
    // `companies.name` carries `searchFold` and NOT `searchFoldTokens` (unlike `persons.name`),
    // so the whole query must be one contiguous substring of the transliterated fold. A
    // multi-word chip is only safe if it is a contiguous prefix of a real name — a condition
    // this test cannot check without Postgres, so the safe rule is enforced instead.
    for (const term of EXAMPLE_TERMS)
      expect(
        term.trim(),
        `"${term}" is multi-word; companies.name has no token fold, so it must be a contiguous ` +
          `substring of a real name — verify with a SELECT and relax this rule deliberately`,
      ).not.toMatch(/\s/);
  });
});

describe("companiesScopeCount", () => {
  it("names the SCOPE's size, never the corpus's", () => {
    // The /persons „разгледай всички" defect: the button promised 137 461 and delivered 63 816.
    // Under ?scope=signal the reader is looking at 98,737 rows, not 1,022,592.
    const counts = { all: 1_022_592, signal: 98_737 };
    expect(companiesScopeCount("signal", counts)).toBe(98_737);
    expect(companiesScopeCount("all", counts)).toBe(1_022_592);
  });

  it("is not a sum — the two scopes NEST, they do not partition", () => {
    // ⚠️ The one way this could be got wrong by analogy with /persons, whose tiers P and V are
    // disjoint and DO sum. Here `signal` is a SUBSET of `all` (has_signal is a filter on the
    // same rows), so adding them would report 1,121,329 companies — more than exist.
    const counts = { all: 1_022_592, signal: 98_737 };
    expect(companiesScopeCount("all", counts)).not.toBe(
      counts.all + counts.signal,
    );
    expect(companiesScopeCount("all", counts)).toBeGreaterThan(
      companiesScopeCount("signal", counts),
    );
  });
});

describe("COMPANIES_LANDING_CARDS", () => {
  it("⚠️ every card is ONE param, structurally", () => {
    // The engine ANDs filters and every picker param is single-valued, so a card needing two is
    // not a card. This is why „НПО, читалища и фондации" is not one, tempting though 30,339 is:
    // it spans three entity_class values and ?class holds one. Carrying a `param`/`value` PAIR
    // rather than an href makes that a shape rather than a thing to check.
    for (const c of COMPANIES_LANDING_CARDS) {
      expect(typeof c.param).toBe("string");
      expect(typeof c.value).toBe("string");
    }
  });

  it("every card's param is one this page OWNS and treats as a NARROWING", () => {
    // A card pointing at a param outside NARROWING_PARAMS would land on the landing again —
    // a call to action that appears to do nothing.
    for (const c of COMPANIES_LANDING_CARDS)
      expect(
        (NARROWING_PARAMS as readonly string[]).includes(c.param),
        `${c.key} uses ?${c.param}, which does not unlock the table`,
      ).toBe(true);
  });

  it("every card's VALUE is one the URL hook would accept", () => {
    // The other half, and the one a key check misses: `?class=ngo` is a valid PARAM with a
    // value `readOneOf` drops, so the card would open the landing again.
    for (const c of COMPANIES_LANDING_CARDS) {
      if (c.param === "class")
        expect(
          (COMPANY_CLASSES as readonly string[]).includes(c.value),
          `${c.key} names entity_class "${c.value}", which the URL hook would drop`,
        ).toBe(true);
      else expect(c.value, `${c.key} is a boolean param`).toBe("1");
    }
  });

  it("⚠️ names the four cards, so removing one is a decision rather than an edit", () => {
    // The set is the landing's whole answer to „what can I ask here". A card silently dropped
    // (or a fifth added past the `lg:grid-cols-4` row) should fail rather than ship.
    expect(COMPANIES_LANDING_CARDS.map((c) => c.key)).toEqual([
      "political",
      "money",
      "contracts",
      "chitalishta",
    ]);
  });

  it("the keys are unique and the set stays short", () => {
    const keys = COMPANIES_LANDING_CARDS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Four is the grid's `lg:grid-cols-4`; more wraps into a second row that reads as a menu.
    expect(keys.length).toBeLessThanOrEqual(4);
  });
});
