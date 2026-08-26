// The /companies URL contract — four separable things, all of which fail silently.
//
//  1. VALIDATE-ON-READ. An unvalidated value reaches the engine, which rejects an
//     unwhitelisted one with a 500 rather than an empty table.
//  2. THE SCOPE DEFAULT. `?scope` absent means the WHOLE 1,022,592-row registry. A
//     regression to `signal` re-imposes the floor on every SEARCH, which is the original
//     defect: 923,855 companies (90.34%) unfindable by name or by EIK, while the page's own
//     copy promises „търсенето обхваща целия регистър".
//  3. THE SEARCH-FIRST SWITCH. `hasNarrowingFilters` / `queryIsSendable` / `browseAll`
//     decide whether the page renders a table at all, so their membership is a UI contract:
//     a dimension wrongly IN opens a million-row table nobody asked for, and one wrongly OUT
//     renders a BLANK page to a reader who arrived from a cross-link — including the OG
//     capture, which would then silently keep serving the old share card.
//  4. THE SOFIA FOLD THAT MUST NOT HAPPEN. `?obshtina` here is NOT /persons' `?obshtina`:
//     this corpus spells Столична община `SOF46`, and `canonicalObshtina()` would turn the
//     governance route's `SOF00` into `SFO_CITY`, which matches zero rows.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { canonicalObshtina } from "@/lib/obshtinaPlace";
import { SEARCH_MIN_CHARS } from "@/ux/data_table/searchTerm";
import {
  readScope,
  isOblastName,
  useUrlCompanyFilters,
  COMPANY_SCOPES,
  COMPANY_CLASSES,
  COMPANY_STATUSES,
  COMPANY_FILTER_ALL,
  QUERY_MAX,
  NARROWING_PARAMS,
  COMPANY_URL_PARAMS,
} from "./useUrlCompanyFilters";

describe("readScope — the ?scope population", () => {
  test("an absent ?scope defaults to ALL — the whole registry, not the has_signal floor", () => {
    // THE defect this param exists to remove. Under the floor, measured 2026-08-26:
    // `uic = '205074978'` (ЕЛСЛАК ЕООД, €1.59bn declared capital) returned 0 rows, and so did
    // „елслак" and „бета фонд" — an exact EIK, the least ambiguous query this corpus accepts,
    // answering „нищо намерено" at a 200.
    assert.equal(readScope(null), "all");
    assert.equal(readScope(""), "all");
  });
  test("an unknown value falls back to all, not through to the engine", () => {
    assert.equal(readScope("has_signal"), "all");
    assert.equal(readScope("true"), "all");
    assert.equal(readScope("../etc"), "all");
  });
  test("both known scopes pass unchanged", () => {
    for (const s of COMPANY_SCOPES) assert.equal(readScope(s), s);
  });
});

describe("isOblastName — the ?oblast shape", () => {
  test("accepts the spellings the picker actually offers", () => {
    // Validated by SHAPE rather than against a frozen list of the 28, for the reason
    // /persons' isInstitutionName spells out: the picker facets this same column, so its
    // vocabulary is the render-time authority, and a client-side list silently refuses a
    // value the picker itself just offered.
    //
    // ⚠️ „София (столица)" IS THE LOAD-BEARING CASE and must not be dropped from this list.
    // Measured 2026-08-26 over the 28 values, it is the ONLY one carrying punctuation — there
    // is no hyphen anywhere in the vocabulary — so without it the punctuation half of the
    // class is untested: a regression narrowing OBLAST_NAME to [\p{L}\p{N} ] passes every
    // other assertion in this file and silently refuses the CAPITAL, which is the largest
    // placed population on the page. That is the failure the sibling records having shipped
    // once („`+` and the closing curly quote were exactly that bug").
    for (const n of [
      "Варна",
      "София (столица)",
      "Велико Търново",
      "Стара Загора",
      "Търговище",
      "Кюстендил",
    ])
      assert.equal(isOblastName(n), true, n);
  });
  test("rejects junk and an over-long value", () => {
    assert.equal(isOblastName(""), false);
    assert.equal(isOblastName("<script>"), false);
    assert.equal(isOblastName("я".repeat(200)), false);
  });
});

// ---- the hook itself ------------------------------------------------------------

const wrap =
  (search: string) =>
  ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      { initialEntries: [`/companies${search}`] },
      children,
    );

/** The hook plus the live query string it has written, so a setter can be asserted on the
 *  URL rather than on the hook's own echo of it. */
const useFiltersAndUrl = () => ({
  ...useUrlCompanyFilters(),
  search: useLocation().search,
});

describe("useUrlCompanyFilters — ?q", () => {
  test("round-trips through the URL, so a refresh restores the last result", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=елслак"),
    });
    assert.equal(result.current.query, "елслак");
  });

  test("PRESERVES a space — a multi-word name must be typable", () => {
    // Worse here than on /persons: `companies.name` carries `searchFold` but NOT
    // `searchFoldTokens`, so the whole query must be one CONTIGUOUS substring of the
    // transliterated fold. „бета фонд" concatenated to „бетафонд" matches nothing at all,
    // while Бета Фонд АД (€20.45bn declared capital) sits in the corpus.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("бета "));
    assert.equal(result.current.query, "бета ");
    act(() => result.current.setQuery("бета фонд"));
    assert.equal(result.current.query, "бета фонд");
  });

  test("keeps a hyphen — БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ is a real name", () => {
    // The reason ?q is not character-validated. The engine escapes LIKE metacharacters
    // itself, so a class narrow enough to feel safe here only rejects real queries.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("БДЖ-ПЪТНИЧЕСКИ"));
    assert.equal(result.current.query, "БДЖ-ПЪТНИЧЕСКИ");
  });

  test("caps on WRITE, in the URL itself", () => {
    // Asserted on the URL rather than on `query`, because the read side caps too — so a
    // write-side regression is invisible to any assertion that reads back through the hook.
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

  test("queryIsSendable counts CHARACTERS, not code units", () => {
    // „👍👍" is 4 code units, 2 characters, and ZERO trigrams to pg_trgm — strictly worse
    // than the „ст" the floor exists for. A `.length >= 3` here opens the table on a term
    // the engine answers with a 400, i.e. the destructive error panel.
    const short = renderHook(useFiltersAndUrl, { wrapper: wrap("?q=👍👍") });
    assert.equal(short.result.current.queryIsSendable, false);
    const ok = renderHook(useFiltersAndUrl, { wrapper: wrap("?q=елслак") });
    assert.equal(ok.result.current.queryIsSendable, true);
  });

  test("queryIsSendable is false below the engine's floor and true at it", () => {
    for (const term of ["", "с", "ст"])
      assert.equal(
        renderHook(useFiltersAndUrl, {
          wrapper: wrap(`?q=${encodeURIComponent(term)}`),
        }).result.current.queryIsSendable,
        false,
        term,
      );
    const atFloor = "я".repeat(SEARCH_MIN_CHARS);
    assert.equal(
      renderHook(useFiltersAndUrl, { wrapper: wrap(`?q=${atFloor}`) }).result
        .current.queryIsSendable,
      true,
    );
  });

  test("a term of only spaces is not sendable — the floor trims, the value does not", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=%20%20%20%20"),
    });
    assert.equal(result.current.queryIsSendable, false);
    assert.equal(result.current.hasActiveFilters, false);
  });
});

describe("useUrlCompanyFilters — validate on read", () => {
  test("every entity_class code round-trips", () => {
    for (const c of COMPANY_CLASSES)
      assert.equal(
        renderHook(useFiltersAndUrl, { wrapper: wrap(`?class=${c}`) }).result
          .current.entityClass,
        c,
      );
  });

  test("every status code round-trips — INCLUDING the two the corpus has no rows for", () => {
    // ⚠️ The list is the PRODUCER's union (TrCompany["status"]), not the four values the
    // matview currently holds. `erased` and `unknown` have zero rows today; refusing them
    // would silently break `?status=erased` the day a TR refresh first mints one, and the
    // symptom is a control snapping back to „всички" with no explanation.
    for (const s of COMPANY_STATUSES)
      assert.equal(
        renderHook(useFiltersAndUrl, { wrapper: wrap(`?status=${s}`) }).result
          .current.status,
        s,
      );
    assert.ok(COMPANY_STATUSES.includes("erased"));
    assert.ok(COMPANY_STATUSES.includes("unknown"));
  });

  test("an unknown class or status is DROPPED, not forwarded to the engine", () => {
    const r = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?class=llc&status=dissolved"),
    });
    assert.equal(r.result.current.entityClass, COMPANY_FILTER_ALL);
    assert.equal(r.result.current.status, COMPANY_FILTER_ALL);
    // …and therefore does not unlock the table either.
    assert.equal(r.result.current.hasNarrowingFilters, false);
  });

  test("a refused value does not count as a narrowing", () => {
    // Derived from what each param READS, not from the query string — otherwise a junk param
    // would open a table that is not filtered by it.
    const r = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?oblast=%3Cscript%3E&obshtina=sofia"),
    });
    assert.equal(r.result.current.oblast, COMPANY_FILTER_ALL);
    assert.equal(r.result.current.obshtina, COMPANY_FILTER_ALL);
    assert.equal(r.result.current.hasNarrowingFilters, false);
  });
});

describe("useUrlCompanyFilters — ?obshtina and the FOURTH Sofia code", () => {
  test("SOF46 passes — it is 116,306 rows, 35.6% of every placed row on the page", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=SOF46"),
    });
    assert.equal(result.current.obshtina, "SOF46");
    assert.equal(result.current.hasNarrowingFilters, true);
  });

  test("⚠️ the value is NOT folded through canonicalObshtina — that maps SOF00 → SFO_CITY, which matches ZERO rows here", () => {
    // The /persons hook folds this param deliberately; this one must not, and the two are
    // one letter apart in the URL. Measured 2026-08-26 on company_browse_table: SOF46 =
    // 116,306 rows; SOF00, SOF, SFO_CITY and all 24 S2*** district codes = 0 each.
    //
    // This assertion is written against `canonicalObshtina` itself rather than a literal, so
    // it keeps discriminating if that helper's mapping changes.
    assert.equal(canonicalObshtina("SOF00"), "SFO_CITY");
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina=SOF46"),
    });
    assert.notEqual(result.current.obshtina, canonicalObshtina("SOF00"));
    assert.equal(result.current.obshtina, "SOF46");
  });

  test("the empty string is refused — 13 rows carry it and no picker can offer it", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?obshtina="),
    });
    assert.equal(result.current.obshtina, COMPANY_FILTER_ALL);
  });

  test("a lowercase or malformed code is refused", () => {
    for (const c of ["sof46", "SOF4", "SOF460", "SFO_CITY"])
      assert.equal(
        renderHook(useFiltersAndUrl, { wrapper: wrap(`?obshtina=${c}`) }).result
          .current.obshtina,
        COMPANY_FILTER_ALL,
        c,
      );
  });
});

describe("useUrlCompanyFilters — the search-first switch", () => {
  test("each of the seven narrowings unlocks the table on its own", () => {
    const cases: Record<(typeof NARROWING_PARAMS)[number], string> = {
      political: "?political=1",
      class: "?class=chitalishte",
      status: "?status=bankrupt",
      oblast: `?oblast=${encodeURIComponent("Варна")}`,
      obshtina: "?obshtina=SOF46",
      money: "?money=1",
      contracts: "?contracts=1",
    };
    for (const p of NARROWING_PARAMS)
      assert.equal(
        renderHook(useFiltersAndUrl, { wrapper: wrap(cases[p]) }).result.current
          .hasNarrowingFilters,
        true,
        p,
      );
  });

  test("⚠️ ?political=1 is a NARROWING — the OG capture depends on it", () => {
    // capture-screens.ts shoots `companies?political=1&elections=2026_04_19` and waits on
    // `[data-og="official-companies-og"] tbody tr.group`. Treated as a scope, the landing
    // would render, the wait would time out, and the job would silently keep serving the old
    // share card — the failure its own comment warns about.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?political=1&elections=2026_04_19"),
    });
    assert.equal(result.current.political, true);
    assert.equal(result.current.hasNarrowingFilters, true);
  });

  test("⚠️ ?scope=signal alone does NOT unlock the table", () => {
    // A population, not a question about one. If flipping the scope opened a table, the
    // landing's own scope choice would dismiss the landing.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?scope=signal"),
    });
    assert.equal(result.current.scope, "signal");
    assert.equal(result.current.hasNarrowingFilters, false);
    assert.equal(result.current.hasActiveFilters, false);
  });

  test("?browse=1 is a view mode — not a narrowing, and not an active filter", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?browse=1"),
    });
    assert.equal(result.current.browseAll, true);
    assert.equal(result.current.hasNarrowingFilters, false);
    assert.equal(result.current.hasActiveFilters, false);
  });

  test("a real term is an ACTIVE filter and NOT a narrowing", () => {
    // Two doors to the table: a SEARCH opens it via queryIsSendable, a FILTER via
    // hasNarrowingFilters, and `?q` must only ever use the first. Asserted on the hook's
    // OUTPUT rather than only on the tuple's membership — a change folding `q` into
    // narrowingByParam would fail the list test but no behavioural one, so the failure would
    // point at the tuple instead of at the behaviour.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=елслак"),
    });
    assert.equal(result.current.queryIsSendable, true);
    assert.equal(result.current.hasActiveFilters, true);
    assert.equal(result.current.hasNarrowingFilters, false);
  });

  test("a bare /companies unlocks nothing", () => {
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    assert.equal(result.current.hasNarrowingFilters, false);
    assert.equal(result.current.hasActiveFilters, false);
    assert.equal(result.current.browseAll, false);
    assert.equal(result.current.scope, "all");
  });
});

describe("useUrlCompanyFilters — writers", () => {
  test("?scope=all is written as an ABSENT param, ?scope=signal explicitly", () => {
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setScope("signal"));
    assert.equal(
      new URLSearchParams(result.current.search).get("scope"),
      "signal",
    );
    act(() => result.current.setScope("all"));
    assert.equal(new URLSearchParams(result.current.search).get("scope"), null);
  });

  test("a boolean setter deletes rather than writing =0", () => {
    // `?money=0` would be a param the reader has to look at and reason about, and the reader
    // is a URL a person pastes. Absent means off.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?money=1"),
    });
    assert.equal(result.current.moneyOnly, true);
    act(() => result.current.setMoneyOnly(false));
    assert.equal(new URLSearchParams(result.current.search).get("money"), null);
  });

  test("setQuery('') DELETES the param — the field's clear button", () => {
    // How Esc-clears and the inset × will work. Depends on `v.slice(...) || null` producing
    // null rather than ""; a refactor to `?? null` would leave `?q=` in the URL, which reads
    // back as an empty-but-present param.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=елслак"),
    });
    act(() => result.current.setQuery(""));
    assert.equal(new URLSearchParams(result.current.search).get("q"), null);
    assert.equal(result.current.query, "");
    assert.equal(result.current.hasActiveFilters, false);
  });

  test("⚠️ setQuery routes around the ALL sentinel — the term __all__ is searchable", () => {
    // `write` deletes on COMPANY_FILTER_ALL, which is right for the six params that have an
    // „all" state and wrong for a free-text field fed by a human keyboard. Through the filter
    // writer this would erase the term instead of searching for it, and with the field bound
    // to `query` the text would vanish as the last underscore was typed.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery(COMPANY_FILTER_ALL));
    assert.equal(
      new URLSearchParams(result.current.search).get("q"),
      COMPANY_FILTER_ALL,
    );
    assert.equal(result.current.query, COMPANY_FILTER_ALL);
  });

  test("the remaining setters round-trip", () => {
    // ⚠️ SEPARATE act() calls, deliberately — three setters in one would hit the
    // one-write-per-tick limitation below and only the last would survive.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setOblast("София (столица)"));
    act(() => result.current.setObshtina("SOF46"));
    act(() => result.current.setBrowseAll(true));
    act(() => result.current.setContractsOnly(true));
    act(() => result.current.setPolitical(true));
    const p = new URLSearchParams(result.current.search);
    assert.equal(p.get("oblast"), "София (столица)");
    assert.equal(p.get("obshtina"), "SOF46");
    assert.equal(p.get("browse"), "1");
    assert.equal(p.get("contracts"), "1");
    assert.equal(p.get("political"), "1");
  });

  test("⚠️ browseScope writes BOTH params — the landing's floor button", () => {
    // The mirror of the one-write-per-tick limitation. `setScope("signal")` followed by
    // `setBrowseAll(true)` drops the scope, so the button labelled „Разгледай 98 737 фирми с
    // публична следа" would open all 1,022,592 rows. This is the composed writer that cannot
    // be got wrong.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.browseScope("signal"));
    const p = new URLSearchParams(result.current.search);
    assert.equal(p.get("scope"), "signal");
    assert.equal(p.get("browse"), "1");
    assert.equal(result.current.scope, "signal");
    assert.equal(result.current.browseAll, true);
  });

  test("browseScope('all') opens the table with NO scope param", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?scope=signal"),
    });
    act(() => result.current.browseScope("all"));
    const p = new URLSearchParams(result.current.search);
    assert.equal(p.get("scope"), null);
    assert.equal(p.get("browse"), "1");
  });

  test("the ALL sentinel deletes its param", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?class=coop"),
    });
    act(() => result.current.setEntityClass(COMPANY_FILTER_ALL));
    assert.equal(new URLSearchParams(result.current.search).get("class"), null);
  });

  test("a setter preserves the OTHER filters already in the URL", () => {
    // The property the functional `setParams` form actually buys: a write is a merge into the
    // live query string, not a replacement of it.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?class=coop&political=1"),
    });
    act(() => result.current.setStatus("active"));
    const p = new URLSearchParams(result.current.search);
    assert.equal(p.get("status"), "active");
    assert.equal(p.get("class"), "coop");
    assert.equal(p.get("political"), "1");
  });

  test("⚠️ two setters in ONE tick do NOT compose — the second wins", () => {
    // Pinned as a LIMITATION rather than left to be discovered. react-router hands
    // `setSearchParams(fn)` the params as of the current RENDER, so both calls start from the
    // same base and the first param is silently dropped. useUrlPersonFilters' header claims
    // the opposite („two filter changes in one tick cannot clobber each other") and is wrong
    // in the same way.
    //
    // No control on this screen reaches it — each sets one filter per interaction and
    // `clearFilters` is a single call — but a future „clear X and set Y" handler must issue
    // ONE setParams rather than two setters. If this test ever fails because both survive,
    // the mechanism improved and the warning above it should go.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => {
      result.current.setEntityClass("ngo_assoc");
      result.current.setStatus("active");
    });
    const p = new URLSearchParams(result.current.search);
    assert.equal(p.get("status"), "active");
    assert.equal(p.get("class"), null);
  });
});

describe("useUrlCompanyFilters — clearFilters", () => {
  test("clears every managed param, and the fixture covers all of them", () => {
    // ⚠️ BOTH the fixture and the assertions are driven from COMPANY_URL_PARAMS, and the
    // `Record` makes a missing entry a COMPILE error. Hand-writing either half makes this
    // test vacuous in exactly the case it exists for: a non-narrowing param added to the hook
    // and missed from the owned list would be absent from a hand-written fixture too, so
    // `get(k)` returns null before the clear as well as after — the drift that comment names
    // („would get a chip, unlock the table, and then SURVIVE „Изчисти всички""), passing.
    const VALUES: Record<(typeof COMPANY_URL_PARAMS)[number], string> = {
      political: "1",
      class: "coop",
      status: "active",
      oblast: "София (столица)",
      obshtina: "SOF46",
      money: "1",
      contracts: "1",
      scope: "signal",
      q: "елс",
      browse: "1",
    };
    const search =
      "?" +
      COMPANY_URL_PARAMS.map(
        (k) => `${k}=${encodeURIComponent(VALUES[k])}`,
      ).join("&");
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap(search) });

    // Non-vacuity: every managed param is actually PRESENT before the clear.
    const before = new URLSearchParams(result.current.search);
    for (const k of COMPANY_URL_PARAMS)
      assert.notEqual(before.get(k), null, `${k} missing from the fixture`);

    act(() => result.current.clearFilters());
    const after = new URLSearchParams(result.current.search);
    for (const k of COMPANY_URL_PARAMS) assert.equal(after.get(k), null, k);
  });

  test("preserves params it does not own", () => {
    // `?elections` is the global election anchor and belongs to ElectionContext.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?class=coop&elections=2026_04_19"),
    });
    act(() => result.current.clearFilters());
    assert.equal(
      new URLSearchParams(result.current.search).get("elections"),
      "2026_04_19",
    );
  });
});

describe("the chip contract", () => {
  test("⚠️ NARROWING_PARAMS is a literal tuple, not string[]", () => {
    // `as const` is load-bearing: without it `Record<(typeof NARROWING_PARAMS)[number],
    // boolean>` degrades to an index signature that accepts a record MISSING a dimension.
    // That dimension then silently stops unlocking the table and a deep link renders blank,
    // and the `satisfies` in the screen test widens with it and stops failing too.
    //
    // Asserted at RUNTIME because a type-level regression is invisible to a value assertion:
    // this pins the exact membership, so a param added to the hook without being added here
    // fails, and a stale entry fails too.
    assert.deepEqual(
      [...NARROWING_PARAMS],
      [
        "political",
        "class",
        "status",
        "oblast",
        "obshtina",
        "money",
        "contracts",
      ],
    );
  });

  test("neither the scope, the view mode nor the term is a narrowing", () => {
    for (const p of ["scope", "browse", "q"])
      assert.ok(
        !(NARROWING_PARAMS as readonly string[]).includes(p),
        `${p} must not be in NARROWING_PARAMS`,
      );
  });
});
