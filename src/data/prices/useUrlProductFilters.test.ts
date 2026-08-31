// The /consumption/products URL contract — four separable things, all of which fail silently.
//
//  1. VALIDATE-ON-READ. An unvalidated value reaches the engine, which rejects an
//     unwhitelisted one with a 500 — the destructive „Данните не можаха да се заредят.“ panel —
//     rather than an empty table. `?group` is the sharp one: it lands in an `in` filter on an
//     `int` column, so a non-numeric value is a 500 and not a narrower list.
//  2. THE CHIP CONTRACT. `PRODUCT_NARROWING_PARAMS` is what the screen iterates to build its
//     removable chips. A dimension missing from it is a table filtered by something the page
//     names nowhere and offers no way to remove — reachable from any shared or hand-built URL.
//  3. THE TREND RANGE. Both bounds, and both imported rather than written twice: a one-sided
//     one puts `euroPctSafe`'s „—“ artifact rows inside a „поскъпнали“ view, and an inner bound
//     that drifts from the cell's colour edge puts grey rows there instead.
//  4. THE SENTINEL THAT MUST NOT REACH `?q`. `PRODUCT_FILTER_ALL` means „delete“ to the filter
//     writer, so routing a free-text term through it would let a reader searching for the
//     literal „__all__“ erase their own query.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SEARCH_MIN_CHARS } from "@/ux/data_table/searchTerm";
import { EURO_PCT_ARTIFACT, EURO_PCT_FLAT_BAND } from "./usePrices";
import {
  isProductGroupId,
  useUrlProductFilters,
  PRODUCT_FILTER_ALL,
  PRODUCT_UNITS,
  PRODUCT_TRENDS,
  PRODUCT_TREND_RANGE,
  PRODUCT_NARROWING_PARAMS,
  PRODUCT_URL_PARAMS,
  QUERY_MAX,
} from "./useUrlProductFilters";

describe("isProductGroupId — the ?group shape", () => {
  test("accepts the pid range the КЗП basket actually uses", () => {
    // Validated by SHAPE rather than against a frozen list of the 101, because the vocabulary
    // lives in `usePriceDict()` — an async fetch. A client-side list would refuse a group the
    // picker beside it had just offered, the day a new one enters the basket.
    for (const v of ["1", "12", "101", "999999"])
      assert.equal(isProductGroupId(v), true, v);
  });
  test("rejects anything that is not a bare integer", () => {
    // ⚠️ THE ONE THAT MATTERS. `pid` is an `int` column, so a non-numeric value forwarded to
    // the engine is a 500 rather than an empty table.
    for (const v of ["", "12a", "-1", "1.5", "12 ", "<script>", "1234567"])
      assert.equal(isProductGroupId(v), false, v);
  });
});

describe("PRODUCT_TREND_RANGE — the bounds the filter and the table share", () => {
  test("both bounds on both directions — a one-sided range admits the „—“ artifacts", () => {
    // `euroPctSafe` renders |pct| > EURO_PCT_ARTIFACT as „—“ (a thin euro-day baseline, a
    // per-piece↔per-kg unit change, product-identity drift). Without the outer bound those rows
    // sit inside a „поскъпнали“ view saying nothing at all about their own price.
    for (const trend of PRODUCT_TRENDS) {
      const r = PRODUCT_TREND_RANGE[trend];
      assert.equal(typeof r.min, "number", trend);
      assert.equal(typeof r.max, "number", trend);
      assert.ok(r.min < r.max, trend);
    }
  });

  test("the outer bound IS `EURO_PCT_ARTIFACT`, not a copy of its value", () => {
    // Asserted against the exported constant rather than against 100, so it keeps
    // discriminating if the artifact ceiling is ever re-measured.
    assert.equal(PRODUCT_TREND_RANGE.up.max, EURO_PCT_ARTIFACT);
    assert.equal(PRODUCT_TREND_RANGE.down.min, -EURO_PCT_ARTIFACT);
  });

  test("the inner bound IS the cell's own colour edge — the filter cannot disagree with the row", () => {
    // `productColumns.tsx` paints `v > EURO_PCT_FLAT_BAND` red and `v < -EURO_PCT_FLAT_BAND`
    // green off the SAME constant. Two literals would show up as a grey „+0.05%“ row inside a
    // „поскъпнали“ view — arithmetically defensible and, to a reader, the wrong rows.
    assert.equal(PRODUCT_TREND_RANGE.up.min, EURO_PCT_FLAT_BAND);
    assert.equal(PRODUCT_TREND_RANGE.down.max, -EURO_PCT_FLAT_BAND);
  });

  test("the two directions are disjoint, so „flat“ is in neither", () => {
    // 22,784 of the 46,682 browsable rows (measured 2026-08-31) sit inside the flat band. They
    // belong to no bucket; a range that admitted 0 to both would put every unchanged price
    // under both chips at once.
    assert.ok(PRODUCT_TREND_RANGE.down.max < PRODUCT_TREND_RANGE.up.min);
    assert.ok(PRODUCT_TREND_RANGE.up.min > 0);
    assert.ok(PRODUCT_TREND_RANGE.down.max < 0);
  });
});

// ---- the hook itself ------------------------------------------------------------

const wrap =
  (search: string) =>
  ({ children }: { children: ReactNode }) =>
    createElement(
      MemoryRouter,
      { initialEntries: [`/consumption/products${search}`] },
      children,
    );

/** The hook plus the live query string it has written, so a setter can be asserted on the URL
 *  rather than on the hook's own echo of it. */
const useFiltersAndUrl = () => ({
  ...useUrlProductFilters(),
  search: useLocation().search,
});

describe("useUrlProductFilters — ?q", () => {
  test("round-trips through the URL, so a refresh restores the last result", () => {
    // The whole point of the migration: before it the term lived in DbDataTable's own
    // uncontrolled input and reached the URL never, so a search could not be shared, linked
    // from an article, bookmarked, or recovered with Back.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=верея"),
    });
    assert.equal(result.current.query, "верея");
  });

  test("PRESERVES a space — „мляко верея“ is one contiguous substring of a real title", () => {
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("мляко "));
    assert.equal(result.current.query, "мляко ");
    act(() => result.current.setQuery("мляко верея"));
    assert.equal(result.current.query, "мляко верея");
  });

  test("keeps punctuation — „ОЛИО 1Л“ and „3%“ are how these titles are written", () => {
    // The reason ?q is not character-validated: the engine escapes LIKE metacharacters itself
    // (`likeEscape`), and a class narrow enough to feel safe here refuses real queries. „%“ in
    // particular is in a large share of the dairy titles.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("МЛЯКО 3%"));
    assert.equal(result.current.query, "МЛЯКО 3%");
  });

  test("⚠️ the „all“ SENTINEL is searchable, not a delete — ?q uses the RAW writer", () => {
    // `write` treats PRODUCT_FILTER_ALL as „delete this param“, which is right for the five
    // params that have an „all“ state and wrong for a free-text field fed by a human keyboard.
    // Through the shared writer, searching for the literal string would silently CLEAR the box.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery(PRODUCT_FILTER_ALL));
    assert.equal(result.current.query, PRODUCT_FILTER_ALL);
    assert.equal(
      new URLSearchParams(result.current.search).get("q"),
      PRODUCT_FILTER_ALL,
    );
  });

  test("caps on WRITE, in the URL itself", () => {
    // Asserted on the URL rather than on `query`, because the read side caps too — so a
    // write-side regression is invisible to any assertion that reads back through the hook.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap("") });
    act(() => result.current.setQuery("я".repeat(QUERY_MAX + 50)));
    assert.equal(
      (new URLSearchParams(result.current.search).get("q") ?? "").length,
      QUERY_MAX,
    );
  });

  test("caps on READ, so a hand-built URL cannot carry a paragraph", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap(`?q=${encodeURIComponent("я".repeat(QUERY_MAX + 50))}`),
    });
    assert.equal(result.current.query.length, QUERY_MAX);
  });

  test("queryIsSendable counts CHARACTERS, not code units", () => {
    // „👍👍“ is 4 code units, 2 characters, and ZERO trigrams to pg_trgm — strictly worse than
    // the „ст“ the floor exists for. A `.length >= 3` here would report a term the engine
    // answers with a 400 as sendable.
    assert.equal(
      renderHook(useFiltersAndUrl, { wrapper: wrap("?q=👍👍") }).result.current
        .queryIsSendable,
      false,
    );
    assert.equal(
      renderHook(useFiltersAndUrl, { wrapper: wrap("?q=верея") }).result.current
        .queryIsSendable,
      true,
    );
  });

  test("queryIsSendable is false below the engine's floor and true at it", () => {
    for (const term of ["", "м", "мл"])
      assert.equal(
        renderHook(useFiltersAndUrl, {
          wrapper: wrap(`?q=${encodeURIComponent(term)}`),
        }).result.current.queryIsSendable,
        false,
        term,
      );
    assert.equal(
      renderHook(useFiltersAndUrl, {
        wrapper: wrap(`?q=${"я".repeat(SEARCH_MIN_CHARS)}`),
      }).result.current.queryIsSendable,
      true,
    );
  });

  test("a term of only spaces is not active — the floor trims, the value does not", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?q=%20%20%20%20"),
    });
    assert.equal(result.current.queryIsSendable, false);
    assert.equal(result.current.hasActiveFilters, false);
  });
});

describe("useUrlProductFilters — validate on read", () => {
  test("every unit and every trend code round-trips", () => {
    for (const u of PRODUCT_UNITS)
      assert.equal(
        renderHook(useFiltersAndUrl, { wrapper: wrap(`?unit=${u}`) }).result
          .current.unit,
        u,
      );
    for (const v of PRODUCT_TRENDS)
      assert.equal(
        renderHook(useFiltersAndUrl, { wrapper: wrap(`?trend=${v}`) }).result
          .current.trend,
        v,
      );
  });

  test("⚠️ the EMPTY-STRING net_unit is refused — 11,105 rows carry it and no picker can offer it", () => {
    // canon's `null` unit, stored as ''. Radix refuses an empty SelectItem value outright, and
    // „no unit“ means „the net quantity did not parse from the title“ rather than a category
    // anybody browses by. A hand-built `?unit=` must not open that view under a labelled chip.
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?unit="),
    });
    assert.equal(result.current.unit, PRODUCT_FILTER_ALL);
    assert.equal(result.current.hasNarrowingFilters, false);
  });

  test("an unknown unit, trend or group is DROPPED, not forwarded to the engine", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?unit=kg&trend=flat&group=milk"),
    });
    assert.equal(result.current.unit, PRODUCT_FILTER_ALL);
    assert.equal(result.current.trend, PRODUCT_FILTER_ALL);
    assert.equal(result.current.group, PRODUCT_FILTER_ALL);
    // …and therefore counts as no narrowing either: the table is not filtered by it, so a chip
    // offering to remove it would name a filter that is not applied.
    assert.equal(result.current.hasNarrowingFilters, false);
  });

  test("the toggles read only the literal „1“", () => {
    const on = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?multi=1&loose=1"),
    });
    assert.equal(on.result.current.multiChain, true);
    assert.equal(on.result.current.looseOnly, true);
    const off = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?multi=true&loose=yes"),
    });
    assert.equal(off.result.current.multiChain, false);
    assert.equal(off.result.current.looseOnly, false);
  });
});

describe("useUrlProductFilters — the chip contract", () => {
  test("every narrowing param actually narrows, and none of them is the term", () => {
    // `PRODUCT_NARROWING_PARAMS` is what the screen iterates to build its chips, so a member
    // that does not flip `hasNarrowingFilters` is a dimension the page would never chip.
    const byParam: Record<(typeof PRODUCT_NARROWING_PARAMS)[number], string> = {
      group: "group=12",
      unit: `unit=${PRODUCT_UNITS[0]}`,
      trend: `trend=${PRODUCT_TRENDS[0]}`,
      multi: "multi=1",
      loose: "loose=1",
    };
    for (const p of PRODUCT_NARROWING_PARAMS) {
      const { result } = renderHook(useFiltersAndUrl, {
        wrapper: wrap(`?${byParam[p]}`),
      });
      assert.equal(result.current.hasNarrowingFilters, true, p);
      assert.equal(result.current.hasActiveFilters, true, p);
    }
    // The term is NOT a narrowing — it goes through the engine's global arm rather than a
    // column — but it IS an active filter, so „Изчисти филтрите“ is offered for it.
    const q = renderHook(useFiltersAndUrl, { wrapper: wrap("?q=верея") });
    assert.equal(q.result.current.hasNarrowingFilters, false);
    assert.equal(q.result.current.hasActiveFilters, true);
  });
});

describe("useUrlProductFilters — clearFilters", () => {
  // ⚠️ THE FIXTURE IS DERIVED FROM THE EXPORTED LIST, not hand-written. Hand-writing it makes
  // this test vacuous in the one case it exists for: a param added to the hook and missed in
  // `PRODUCT_URL_PARAMS` would be absent from a hand-written fixture too, so `get(k)` returns
  // null before the clear as well as after and the assertion passes having tested nothing.
  const fixture = `?${PRODUCT_URL_PARAMS.map((k) => `${k}=1`).join("&")}&area=EK68134&elections=2026_04_19`;

  test("clears every param it owns", () => {
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap(fixture) });
    act(() => result.current.clearFilters());
    const after = new URLSearchParams(result.current.search);
    for (const k of PRODUCT_URL_PARAMS) assert.equal(after.get(k), null, k);
    assert.equal(result.current.hasActiveFilters, false);
  });

  test("⚠️ and PRESERVES the globals — `?area` is the pinned place every product link carries", () => {
    // The functional `setSearchParams` form is what makes this true. A writer that replaced the
    // whole query string would drop the place anchor on the first „Изчисти филтрите“, and the
    // product pages opened afterwards would silently show national prices instead of local.
    const { result } = renderHook(useFiltersAndUrl, { wrapper: wrap(fixture) });
    act(() => result.current.clearFilters());
    const after = new URLSearchParams(result.current.search);
    assert.equal(after.get("area"), "EK68134");
    assert.equal(after.get("elections"), "2026_04_19");
  });

  test("a setter preserves the globals too", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?area=EK68134"),
    });
    act(() => result.current.setGroup("12"));
    const after = new URLSearchParams(result.current.search);
    assert.equal(after.get("group"), "12");
    assert.equal(after.get("area"), "EK68134");
  });

  test("setting a filter to the „all“ sentinel DELETES it rather than writing it", () => {
    const { result } = renderHook(useFiltersAndUrl, {
      wrapper: wrap("?group=12"),
    });
    act(() => result.current.setGroup(PRODUCT_FILTER_ALL));
    assert.equal(new URLSearchParams(result.current.search).get("group"), null);
    assert.equal(result.current.group, PRODUCT_FILTER_ALL);
  });
});
