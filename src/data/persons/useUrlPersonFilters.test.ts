// The /persons URL contract — three separable things, all of which fail silently.
//
//  1. VALIDATE-ON-READ + the LIKE-escaping that makes a padded code-set match exact. An
//     unvalidated value reaches the engine, which rejects an unwhitelisted one with a 500
//     rather than an empty table; and an unescaped `_` is a LIKE wildcard, so `' p_16 '`
//     would also match `' pX16 '` — a filter that looks exact, is not, and would never be
//     noticed until two parties collided.
//  2. THE SCOPE DEFAULT. `?sector` absent means the WHOLE 137,461-person layer; a regression
//     to the old `public` narrows the page to 63,816 rows with every count on it reconciling.
//  3. THE SEARCH-FIRST SWITCH. `hasNarrowingFilters` / `queryIsSendable` / `browseAll` are
//     what decide whether the browser renders a table at all, so their membership is a UI
//     contract: a dimension wrongly in the first opens a 137,461-row table nobody asked for,
//     and one wrongly out of it renders a BLANK page to a reader who arrived from a cross-link.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  escapeLike,
  codeSetMatch,
  isInstitutionName,
  readSector,
  useUrlPersonFilters,
  PERSON_SECTORS,
  PERSON_FILTER_ALL,
  QUERY_MAX,
} from "./useUrlPersonFilters";
import { PERSON_GROUPS, groupByKey } from "./personGroups";

describe("readSector — the ?sector scope", () => {
  test("an absent ?sector defaults to ALL (the whole layer, not just people in power)", () => {
    // The search-first default. A regression to "public" silently narrows the page to
    // 63,816 of 137,461 rows while every count on it still reconciles.
    assert.equal(readSector(null), "all");
    assert.equal(readSector(""), "all");
  });
  test("an unknown value falls back to all, not through to the engine", () => {
    // 'company' is a real position_type but NOT a sector — a wrong param must not be forwarded.
    assert.equal(readSector("company"), "all");
    assert.equal(readSector("V"), "all");
    assert.equal(readSector("../etc"), "all");
  });
  test("the three known sectors pass unchanged", () => {
    for (const s of PERSON_SECTORS) assert.equal(readSector(s), s);
  });
});

// ---- the hook itself ------------------------------------------------------------
//
// WHAT THIS PINS. `hasNarrowingFilters` decides whether /persons renders a table at all, so
// its membership is a UI contract rather than a convenience: a dimension wrongly in it opens
// a 137,461-row table nobody asked for, and one wrongly out of it renders a blank page to a
// reader who arrived from a cross-link.

const wrap =
  (search: string) =>
  ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      { initialEntries: [`/persons${search}`] },
      children,
    );

/** The hook plus the live query string it has written, so a setter can be asserted on the URL
 *  rather than on the hook's own echo of it. */
const useFiltersAndUrl = () => ({
  ...useUrlPersonFilters(),
  search: useLocation().search,
});

describe("useUrlPersonFilters — ?q", () => {
  test("round-trips through the URL, so a refresh restores the last result", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=явор"),
    });
    assert.equal(result.current.query, "явор");
  });

  test("PRESERVES a space — a multi-word name must be typable", () => {
    // The rule that must never be "tidied up". The value IS the controlled field's value, so
    // trimming it here deletes the space as it is typed and „Иван Иванов" arrives as
    // „ИванИванов". `person_browse_table.name` is `searchFoldTokens: true` precisely so a
    // first + family name matches past the patronymic, so one concatenated token matches
    // NOTHING — „no such person", at a 200, about somebody who is in the corpus.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("Иван "));
    assert.equal(result.current.query, "Иван ");
    act(() => result.current.setQuery("Иван Иванов"));
    assert.equal(result.current.query, "Иван Иванов");
  });

  test("caps on WRITE, in the URL itself", () => {
    // Asserted on the URL rather than on `query`, because the read side caps too — so a
    // write-side regression is invisible to any assertion that reads back through the hook.
    // (Measured: deleting the write cap left the previous version of this test green.)
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("я".repeat(QUERY_MAX + 50)));
    const written = new URLSearchParams(result.current.search).get("q") ?? "";
    assert.equal(written.length, QUERY_MAX);
  });

  test("caps on READ, so a hand-built URL cannot carry a paragraph", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap(`?q=${encodeURIComponent("я".repeat(QUERY_MAX + 50))}`),
    });
    assert.equal(result.current.query.length, QUERY_MAX);
  });

  test("is NOT character-validated — the picker's own values must survive", () => {
    // Deliberate non-validation: the engine escapes LIKE metacharacters itself, and a class
    // narrow enough to feel safe rejects a term the institution picker beside it offers
    // verbatim. A `%`/`_` here is escaped downstream, not here.
    for (const term of [
      "Окръжен съд - Варна",
      'Агенция „Митници"',
      "50%_x",
      "О'Брайън",
    ]) {
      const { result } = renderHook(useFiltersAndUrl, {
        wrapper: wrap(`?q=${encodeURIComponent(term)}`),
      });
      assert.equal(result.current.query, term);
    }
  });

  test("queryIsSendable follows the ENGINE's rule, not String.length", () => {
    // Below the floor the table must not open at all: the engine refuses the term with a 400,
    // which renders the destructive error panel. „👍👍" is the case a `.length` check gets
    // wrong — 4 code units, 2 characters, and ZERO trigrams to pg_trgm.
    const sendable = (q: string) =>
      renderHook(useFiltersAndUrl, {
        wrapper: wrap(`?q=${encodeURIComponent(q)}`),
      }).result.current.queryIsSendable;
    assert.equal(sendable(""), false);
    assert.equal(sendable("яв"), false);
    assert.equal(sendable("  яв  "), false);
    assert.equal(sendable("👍👍"), false);
    assert.equal(sendable("явор"), true);
    assert.equal(sendable("  явор  "), true);
  });

  test("a whitespace-only term is not an active filter", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap(`?q=${encodeURIComponent("   ")}`),
    });
    assert.equal(result.current.hasActiveFilters, false);
    assert.equal(result.current.queryIsSendable, false);
  });

  test("an empty term DELETES the param rather than writing q=", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=явор"),
    });
    act(() => result.current.setQuery(""));
    assert.equal(result.current.query, "");
    assert.ok(!result.current.search.includes("q="), result.current.search);
  });

  test("a term counts as an active filter", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=явор"),
    });
    assert.equal(result.current.hasActiveFilters, true);
    // …but it is not a FILTER: it narrows through the engine's global arm, not a column.
    assert.equal(result.current.hasNarrowingFilters, false);
  });
});

describe("useUrlPersonFilters — ?obshtina folds Sofia's three synonyms", () => {
  // Measured 2026-08-26 on `person_browse_table`: `SFO_CITY` is 1,315 rows — the largest
  // municipality in the corpus — and `SOF00` and `SOF` are 0 each. `SOF00` is the code every
  // /governance Sofia URL carries, so an unfolded read filters the capital to nothing.
  for (const synonym of ["SOF00", "SOF"])
    test(`${synonym} reads as SFO_CITY`, () => {
      const { result } = renderHook(useFiltersAndUrl, {
        wrapper: wrap(`?obshtina=${synonym}`),
      });
      assert.equal(result.current.obshtina, "SFO_CITY");
    });

  test("SFO_CITY itself is unchanged", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=SFO_CITY"),
    });
    assert.equal(result.current.obshtina, "SFO_CITY");
  });

  test("an ordinary code is untouched — the fold is Sofia-only", () => {
    // Non-vacuity: a fold that rewrote everything would pass the clauses above.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=BGS04"),
    });
    assert.equal(result.current.obshtina, "BGS04");
  });

  test("Sofia's районa are NOT folded into the city", () => {
    // obshtinaPlace.ts's own rule: a кмет на район holds that район's office, and folding the
    // 24 S2*** codes into the city bundle would erase 24 distinct offices.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=S2414"),
    });
    assert.equal(result.current.obshtina, "S2414");
  });

  test("the URL is NOT rewritten — the fold is read-side only", () => {
    // An inbound link silently becoming a different link is a different promise, and it makes
    // any diff of two URLs unreliable.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=SOF00"),
    });
    assert.match(result.current.search, /obshtina=SOF00/);
  });

  test("junk is still refused", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=%3Cscript%3E"),
    });
    assert.equal(result.current.obshtina, PERSON_FILTER_ALL);
  });
});

describe("useUrlPersonFilters — the sector scope is not a narrowing", () => {
  test("a bare ?sector=public is active but narrows nothing", () => {
    // The rule the whole search-first switch rests on: switching the scope must NOT open a
    // 63,816-row prominence-sorted table, which is the default-table behaviour being removed.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?sector=public"),
    });
    assert.equal(result.current.sector, "public");
    assert.equal(result.current.hasActiveFilters, true);
    assert.equal(result.current.hasNarrowingFilters, false);
  });

  test("`all` writes NO param — /persons is the whole layer", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?sector=private"),
    });
    act(() => result.current.setSector("all"));
    assert.ok(!result.current.search.includes("sector"), result.current.search);
    assert.equal(result.current.sector, "all");
  });

  test("`public` is now the one written explicitly", () => {
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setSector("public"));
    assert.match(result.current.search, /sector=public/);
  });
});

describe("useUrlPersonFilters — every narrowing dimension unlocks the table", () => {
  // One case per param, because the failure is asymmetric and silent in both directions: a
  // dimension missing here renders a BLANK page to a reader who deep-linked into it.
  const cases: [string, string][] = [
    ["?facet=mp", "a group"],
    ["?pfacet=politician", "the mix bar's segment"],
    ["?role=mp", "a role"],
    ["?party=gerb", "a party"],
    ["?oblast=VAR", "an oblast"],
    [
      "?obshtina=BGS04",
      "a municipality (no picker — the /governance cross-link)",
    ],
    ["?position=executive", "a position type (no picker — a cross-link)"],
    [`?court=${encodeURIComponent("Окръжен съд - Варна")}`, "an institution"],
    ["?decl=1", "declaration-only"],
    ["?held=1", "held-office-only"],
    ["?switch=1", "party switchers"],
  ];
  for (const [search, what] of cases)
    test(`${what} narrows`, () => {
      const { result } = renderHook(useFiltersAndUrl, {
        wrapper: wrap(search),
      });
      assert.equal(
        result.current.hasNarrowingFilters,
        true,
        `${search} must unlock the table`,
      );
    });

  test("nothing at all narrows nothing", () => {
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    assert.equal(result.current.hasNarrowingFilters, false);
    assert.equal(result.current.hasActiveFilters, false);
  });
});

describe("useUrlPersonFilters — ?browse is a view mode, not a filter", () => {
  test("it does not light the clear button", () => {
    // Offering to "clear filters" when the only param is a view mode would name the wrong
    // thing; the landing's own „назад" affordance takes a reader back out of it.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?browse=1"),
    });
    assert.equal(result.current.browseAll, true);
    assert.equal(result.current.hasActiveFilters, false);
    assert.equal(result.current.hasNarrowingFilters, false);
  });

  test("clearFilters still clears it — and the term with it", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?browse=1&q=явор&role=mp&switch=1"),
    });
    act(() => result.current.clearFilters());
    assert.equal(result.current.browseAll, false);
    assert.equal(result.current.query, "");
    assert.equal(result.current.role, PERSON_FILTER_ALL);
    assert.equal(result.current.switchersOnly, false);
  });
});

describe("useUrlPersonFilters — the boolean setters write and delete", () => {
  // Each toggle stores "1" or NOTHING; a setter that wrote "0" would leave a param that reads
  // as false to this hook and as present to anything counting the query string.
  const toggles: [
    keyof ReturnType<typeof useFiltersAndUrl>,
    keyof ReturnType<typeof useFiltersAndUrl>,
    string,
  ][] = [
    ["setBrowseAll", "browseAll", "browse"],
    ["setSwitchersOnly", "switchersOnly", "switch"],
    ["setDeclaredOnly", "declaredOnly", "decl"],
    ["setHeldOfficeOnly", "heldOfficeOnly", "held"],
  ];
  for (const [setter, reader, param] of toggles)
    test(`${param}`, () => {
      const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
      act(() => (result.current[setter] as (v: boolean) => void)(true));
      assert.equal(result.current[reader], true);
      assert.match(result.current.search, new RegExp(`${param}=1`));
      act(() => (result.current[setter] as (v: boolean) => void)(false));
      assert.equal(result.current[reader], false);
      assert.ok(
        !result.current.search.includes(`${param}=`),
        result.current.search,
      );
    });
});

describe("useUrlPersonFilters — clearFilters covers everything the hook owns", () => {
  test("every param a setter can write is cleared", () => {
    // The failure this pins is one-directional and silent: a param added to the hook and
    // forgotten in PARAMS survives „Изчисти всички", so the table stays filtered by something
    // no control on the page is showing any more.
    const all =
      "?sector=private&position=executive&facet=mp&pfacet=politician&role=mp" +
      "&party=gerb&oblast=VAR&obshtina=BGS04&court=X&decl=1&held=1&switch=1" +
      "&q=явор&browse=1";
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap(all) });
    assert.equal(result.current.hasActiveFilters, true);
    act(() => result.current.clearFilters());
    assert.equal(result.current.search, "", result.current.search);
    assert.equal(result.current.hasActiveFilters, false);
    assert.equal(result.current.hasNarrowingFilters, false);
    assert.equal(result.current.browseAll, false);
  });

  test("preserves params it does not own", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?role=mp&elections=2026_04_19"),
    });
    act(() => result.current.clearFilters());
    assert.match(result.current.search, /elections=2026_04_19/);
  });
});

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

describe("the court/institution param", () => {
  test("accepts the punctuation real institution names contain", () => {
    // Each of these is a live value the picker itself offers. A too-narrow class rejects
    // the reader's own click and the control snaps back to "all" with no explanation.
    for (const name of [
      "Окръжен съд - Кърджали",
      '"Български пощи" ЕАД',
      "Софийски районен съд, гр. София",
      "Апелативен специализиран наказателен съд",
      "Комисия за защита от дискриминация (КЗД)",
      "Агенция „Митници“",
      "МБАЛ - Плевен + филиали",
      "Дирекция №2 — Изпълнение",
    ])
      assert.ok(
        isInstitutionName(name),
        `rejected a real institution: ${name}`,
      );
  });

  test("rejects junk and over-long values rather than forwarding them", () => {
    assert.ok(!isInstitutionName("<script>alert(1)</script>"));
    assert.ok(!isInstitutionName("a".repeat(201)));
    assert.ok(!isInstitutionName(""));
  });
});
