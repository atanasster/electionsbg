// The /persons URL filters — validate-on-read and the LIKE-escaping that makes a padded
// code-set match exact.
//
// Both behaviours guard silent failures. An unvalidated value reaches the engine, which
// rejects an unwhitelisted one with a 500 rather than an empty table; and an unescaped `_`
// is a LIKE wildcard, so `' p_16 '` would also match `' pX16 '` — a filter that looks
// exact, is not, and would never be noticed until two parties collided.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  escapeLike,
  codeSetMatch,
  PERSON_FILTER_ALL,
} from "./useUrlPersonFilters";
import { PERSON_GROUPS, groupByKey } from "./personGroups";

describe("escapeLike", () => {
  test("escapes the underscore wildcard that these codes are full of", () => {
    // p_16, chief_architect, SOFIA_CITY — an unescaped `_` matches ANY character.
    assert.equal(escapeLike("p_16"), "p\\_16");
    assert.equal(escapeLike("chief_architect"), "chief\\_architect");
    assert.equal(escapeLike("SOFIA_CITY"), "SOFIA\\_CITY");
  });

  test("escapes the percent wildcard", () => {
    assert.equal(escapeLike("a%b"), "a\\%b");
  });

  test("escapes backslashes FIRST, so its own escapes are not re-escaped", () => {
    // Wrong order gives "a\\\\_b" (a literal backslash then a live wildcard).
    assert.equal(escapeLike("a\\_b"), "a\\\\\\_b");
  });

  test("leaves an ordinary code untouched", () => {
    assert.equal(escapeLike("gerb"), "gerb");
    assert.equal(escapeLike("PDV-00"), "PDV-00");
  });
});

describe("codeSetMatch", () => {
  test("pads with spaces so a token cannot match a longer one", () => {
    // The matview stores ' ngo ngo_board '. Without the padding, ILIKE '%ngo%' matches
    // ngo_board too and the role filter silently over-selects.
    assert.equal(codeSetMatch("ngo"), " ngo ");
    assert.notEqual(codeSetMatch("ngo"), "ngo");
  });

  test("pads AND escapes together", () => {
    assert.equal(codeSetMatch("p_16"), " p\\_16 ");
  });
});

describe("the filter vocabulary", () => {
  test("the all-sentinel is not a plausible code", () => {
    // It doubles as a Radix Select item value (Radix rejects ""), so it has to be
    // distinguishable from every real code the corpus can produce.
    assert.match(PERSON_FILTER_ALL, /^__/);
  });

  test("every group maps to a MEMBERSHIP flag, never to primary_facet", () => {
    // primary_facet is the facet of the highest-prominence role, so it can never be
    // 'company'/'ngo'/'donor' — those sources always lose the representative slot. A group
    // filter built on it makes 10,703 company-linked people unreachable.
    for (const g of PERSON_GROUPS)
      assert.match(
        g.column,
        /^is_/,
        `${g.key} filters ${g.column}, which is not a membership flag`,
      );
    // The three groups that only the flags can express.
    for (const key of ["company", "ngo", "donor"])
      assert.ok(groupByKey(key), `${key} must be an offered group`);
  });

  test("group keys are unique and map to distinct columns", () => {
    assert.equal(
      new Set(PERSON_GROUPS.map((g) => g.key)).size,
      PERSON_GROUPS.length,
    );
    assert.equal(
      new Set(PERSON_GROUPS.map((g) => g.column)).size,
      PERSON_GROUPS.length,
    );
  });
});
