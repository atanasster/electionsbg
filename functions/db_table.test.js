// Pure unit tests for the db_table WHERE builder — specifically the free-text
// `global` search arm and its `globalCols` allowlist (no DB needed; buildWhere
// only emits SQL text + params).
// Run: cd functions && npm test   (Node 22 built-in runner, zero deps)

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWhere,
  REGISTRY,
  runDbTable,
  runDbFacets,
  buildAggSelect,
  SEARCH_MIN_CHARS,
  SHLYO_TRIGGER_RAW,
} = require("./db_table.js");

const contracts = REGISTRY.contracts;

test("global search ORs every searchable column by default", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус" },
  });
  // title (searchText → FTS + trigram over the fold) …
  assert.ok(whereSql.includes("title_fold"), "title arm present");
  // … plus the entity-name arms.
  assert.ok(
    whereSql.includes("awarder_name ILIKE"),
    "awarder_name arm present",
  );
  assert.ok(
    whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm present",
  );
});

test("globalCols=['title'] restricts the search to the title arm only", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус", globalCols: ["title"] },
  });
  assert.ok(whereSql.includes("title_fold"), "title arm kept");
  assert.ok(
    !whereSql.includes("awarder_name ILIKE"),
    "awarder_name arm dropped",
  );
  assert.ok(
    !whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm dropped",
  );
});

test("globalCols can select a single entity-name column", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус", globalCols: ["contractor_name"] },
  });
  assert.ok(
    whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm kept",
  );
  assert.ok(!whereSql.includes("title_fold"), "title arm dropped");
});

test("globalCols rejects a non-searchable column (no silent full-corpus match)", () => {
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: { global: "хемус", globalCols: ["procurement_method"] },
      }),
    /column not searchable: procurement_method/,
  );
  // A pure typo is rejected the same way — never silently ignored.
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: { global: "хемус", globalCols: ["ttile"] },
      }),
    /column not searchable: ttile/,
  );
});

test("an empty globalCols array is treated as 'no restriction'", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "хемус", globalCols: [] },
  });
  assert.ok(whereSql.includes("title_fold"), "title arm present");
  assert.ok(
    whereSql.includes("contractor_name ILIKE"),
    "contractor_name arm present",
  );
});

test("a valid globalCols with no global term emits no search arm", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "", globalCols: ["title"] },
  });
  assert.ok(!/ILIKE|title_fold/.test(whereSql), "no search arm emitted");
});

test("globalCols is validated even when there is no global term", () => {
  // A malformed request must throw regardless of whether a search term is
  // active — not be silently accepted in the empty-term case.
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: { global: "", globalCols: ["nope"] },
      }),
    /column not searchable: nope/,
  );
});

test("globalFtsOnly drops the trigram %> fallback, keeps the FTS arm", () => {
  // The project-file seed sets this: its membership is decided by the Cyrillic
  // confidence gate, so the fuzzy `%>` arm never admits a member — it only pulls
  // unrelated near-spellings (планиране for саниране) into the amount-sorted
  // seed window and inflates the exact-count banner. FTS-only makes it honest.
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "саниране", globalCols: ["title"], globalFtsOnly: true },
  });
  assert.ok(whereSql.includes("fold_prefix_tsquery"), "FTS arm kept");
  assert.ok(!whereSql.includes("%>"), "trigram %> arm dropped");
  assert.ok(
    !whereSql.includes("translit_bg_latin"),
    "trigram translit fallback dropped",
  );
});

test("default (no globalFtsOnly) keeps BOTH the FTS and trigram arms", () => {
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "саниране", globalCols: ["title"] },
  });
  assert.ok(whereSql.includes("fold_prefix_tsquery"), "FTS arm present");
  assert.ok(whereSql.includes("%>"), "trigram %> arm present by default");
});

test("globalFtsOnly is a no-op on a non-searchText (name) column", () => {
  // contractor_name is a searchFold/ILIKE column, not searchText — the flag only
  // gates the FTS/trigram searchText arm, so the name match is unchanged.
  const { whereSql } = buildWhere(contracts, {
    filters: {
      global: "хемус",
      globalCols: ["contractor_name"],
      globalFtsOnly: true,
    },
  });
  assert.ok(whereSql.includes("contractor_name ILIKE"), "name arm unchanged");
});

// ---- the free-text length floor (SEARCH_MIN_CHARS) ---------------------------
// pg_trgm extracts no trigram from a 1-2 character pattern, so a short term turns
// `col ILIKE '%q%'` from an index probe into a FULL SCAN of the gin index. Measured
// on contractor_rank under a generic plan: `ст` returned all 432,959 entries at
// 3,447 buffers / 359-490 ms, and again at 3,441 on the count aggregate, against 257
// buffers for the 3-character `апи`. See db_table.js's SEARCH_MIN_CHARS header.

test("a sub-floor term REFUSES rather than serving an empty result", () => {
  // The failure this prevents is a WRONG ANSWER AT 200, not a slow one: `ст` matches
  // 6,462 rows in contractor_rank, so answering "0 contractors" would read to a
  // reader as "no such contractor exists" with nothing saying the search never ran.
  assert.throws(
    () =>
      buildWhere(REGISTRY.contractor_rankings, { filters: { global: "ст" } }),
    (e) =>
      e.name === "DbRequestError" &&
      e.status === 400 &&
      /at least 3/.test(e.message),
    "a two-character term throws a 400",
  );
  assert.throws(
    () =>
      buildWhere(REGISTRY.contractor_rankings, { filters: { global: "с" } }),
    (e) => e.name === "DbRequestError",
    "a one-character term throws too",
  );
});

test("a term AT the floor is served normally", () => {
  // Boundary: 3 passes, 2 does not. A floor written as `>` instead of `>=` would
  // reject every three-letter acronym in the corpus ("АПИ", "БДЖ", "НЗОК").
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    filters: { global: "апи" },
  });
  assert.ok(whereSql.includes("name_fold ILIKE"), "the fold arm is emitted");
});

test("the floor drops only the FLOORED arms, never the whole search", () => {
  // tenders carries a searchPrefix arm (`unp`, floor 1) beside a fold arm, an FTS
  // arm and a side-table arm. A two-character term keeps the prefix arm and narrows
  // to it — a NARROWER answer, which is honest — instead of refusing outright.
  //
  // ⚠️ The arms it drops must actually disappear from the SQL. Leaving one in would
  // reinstate the full gin scan this whole floor exists to prevent, on a request that
  // looks like it was handled correctly.
  const { whereSql } = buildWhere(REGISTRY.tenders, {
    filters: { global: "00" },
  });
  assert.ok(whereSql.includes("unp LIKE"), "the prefix arm survives");
  assert.ok(
    !whereSql.includes("buyer_fold"),
    "the floored fold arm is dropped",
  );
  assert.ok(
    !whereSql.includes("fold_prefix_tsquery"),
    "the floored FTS + side-table arms are dropped",
  );
});

test("the floor counts CHARACTERS, not UTF-16 code units", () => {
  // `String.length` is code units; pg_trgm counts characters. Measured against the
  // corpus's own pg_trgm: show_trgm('👍👍') is the EMPTY set — 4 code units, 2
  // characters, and NO trigram at all, i.e. strictly worse than the `ст` this floor was
  // written for, because an empty trigram set gives the GIN scan nothing to filter on.
  // The NFD pair is the same shape from the other direction: show_trgm on two decomposed
  // e-acutes yields the 1-character trigram set.
  for (const g of ["👍👍", "éé"])
    assert.throws(
      () =>
        buildWhere(REGISTRY.contractor_rankings, { filters: { global: g } }),
      (e) => e.name === "DbRequestError",
      `${JSON.stringify(g)} is two characters and must be floored`,
    );
});

test("the floor is applied AFTER globalCols narrowing", () => {
  // `searchDefs` is `restrictedDefs ?? searchAll`, so a request naming ONLY a floored
  // column must refuse even though the resource has an unfloored arm it did not ask for.
  // Filtering `searchAll` here instead serves `unp LIKE …` for a buyer_name request —
  // the allowlist ignored AND the refusal skipped, both at a 200.
  assert.throws(
    () =>
      buildWhere(REGISTRY.tenders, {
        filters: { global: "00", globalCols: ["buyer_name"] },
      }),
    (e) => e.name === "DbRequestError",
    "a sub-floor term restricted to a floored arm refuses",
  );
  const { whereSql } = buildWhere(REGISTRY.tenders, {
    filters: { global: "00", globalCols: ["unp"] },
  });
  assert.ok(
    whereSql.includes("unp LIKE"),
    "…while the unfloored arm alone is still served",
  );
  assert.ok(
    !whereSql.includes("buyer_fold"),
    "…and only that arm — the allowlist still holds",
  );
});

test("a resource with no searchable column reports THAT, not 'too short'", () => {
  // "too short" would be false and unactionable there: no length of term can help.
  // Latent today (all 24 resources have a searchable column), but the engine is designed
  // so a new resource is one registry entry, and a wrong error message on a live route is
  // exactly what the shape-invariant tests in this file exist to prevent.
  const bare = {
    base: "x",
    columns: { a: { type: "text", sort: true } },
    select: ["a"],
    defaultSort: [["a", "asc"]],
  };
  assert.throws(
    () => buildWhere(bare, { resource: "bare", filters: { global: "хемус" } }),
    (e) =>
      e.name === "DbRequestError" && /no searchable columns/.test(e.message),
  );
});

test("every resource keeps at least one arm at the floor length", () => {
  // Vacuity guard on the two tests above. If some resource's only searchable column
  // were floored at 3 while its UI let a shorter term through, the refusal would be
  // correct but invisible here; and if the floor were ever raised, this names every
  // resource it would start refusing rather than letting them fail one route at a
  // time in production.
  // Samples AT the floor via the exported constant rather than restating it, so raising
  // SEARCH_MIN_CHARS reports "this resource can no longer be searched at the new floor"
  // instead of looking like the boundary broke. The `/at least 3/` assertion above stays
  // a LITERAL on purpose: it asserts the user-visible message, and deriving it from the
  // source would let an inverted implementation satisfy the test against itself.
  const term = "a".repeat(SEARCH_MIN_CHARS);
  for (const [name, r] of Object.entries(REGISTRY)) {
    assert.doesNotThrow(
      () => buildWhere(r, { filters: { global: term } }),
      `${name}: a ${term.length}-character term must be servable`,
    );
  }
});

test("the floor refuses BEFORE any SQL is issued, so page and count agree", async () => {
  // The page query and the count/sum aggregate are built from ONE buildWhere call.
  // Asserting that NO query ran is what proves the two cannot disagree — a floor
  // applied at one call site and not the other would show a row count the rows
  // beneath it do not add up to.
  let issued = 0;
  const q = async () => {
    issued++;
    return [];
  };
  await assert.rejects(
    runDbTable(q, {
      resource: "contractor_rankings",
      filters: { global: "ст" },
    }),
    (e) => e.name === "DbRequestError",
  );
  assert.equal(issued, 0, "refused before issuing any query");
});

// ---- query-shape routing (searchWhen / searchEq) -----------------------------
// A column with `searchWhen` is a SPECIALIST — it claims a term of its shape or stays
// silent; columns without one are the fallback set. The point is that an identifier arm
// and a name arm are never OR'd: measured on contractor_rank under a generic plan,
// `(name_fold ILIKE … OR eik LIKE …)` makes the planner abandon the trigram index for the
// WHOLE predicate — `софарма` 2.7 ms / 255 buffers → 114 ms / 704.

// A throwaway resource, so these tests pin the ENGINE rule rather than whichever registry
// entry happens to use it today.
const routedResource = {
  base: "t",
  columns: {
    eik: {
      type: "text",
      search: true,
      searchEq: true,
      searchWhen: "^[0-9]{8,14}$",
    },
    name: {
      type: "text",
      search: true,
      searchCol: "name_fold",
      searchFold: true,
    },
  },
  select: ["eik"],
  defaultSort: [["eik", "asc"]],
};

test("an identifier-shaped term routes to the equality arm ALONE", () => {
  const { whereSql, params } = buildWhere(routedResource, {
    filters: { global: "103267194" },
  });
  assert.ok(whereSql.includes("eik = $"), "the equality arm is emitted");
  assert.ok(
    !whereSql.includes("name_fold"),
    "and the name arm is NOT — OR-ing them is the 42x regression",
  );
  assert.ok(!whereSql.includes("ILIKE"), "no LIKE pattern at all");
  // Bound RAW: no %-wrapping, no escaping, no transliteration. Folding would corrupt a
  // synthetic key like obed-3c76d4088cb9.
  assert.deepEqual(params, ["103267194"]);
});

test("a name-shaped term routes to the fallback arms ALONE", () => {
  const { whereSql } = buildWhere(routedResource, {
    filters: { global: "софарма" },
  });
  assert.ok(whereSql.includes("name_fold ILIKE"), "the name arm is emitted");
  assert.ok(!whereSql.includes("eik = $"), "and the specialist stays silent");
});

test("a term no arm claims matches NOTHING, explicitly", () => {
  // Reachable when every surviving column is a specialist and none of their shapes fit.
  // Dropping the arm instead would make the search match the ENTIRE corpus — the same
  // failure the globalCols validation guards against.
  const { whereSql, filtered } = buildWhere(routedResource, {
    filters: { global: "софарма", globalCols: ["eik"] },
  });
  assert.match(whereSql, /\bFALSE\b/, "an explicit no-match predicate");
  assert.ok(
    !whereSql.includes("name_fold"),
    "the excluded arm is not resurrected",
  );
  assert.equal(filtered, true, "and the request still counts as filtered");
});

test("routing runs BEFORE the length floor, so an identifier is not floored", () => {
  // `searchEq` has floor 1: equality is an index cond at any length (4 buffers measured).
  // Evaluating the floor first would refuse an 8-digit id on the trigram floor.
  const { whereSql } = buildWhere(routedResource, {
    filters: { global: "12345678" },
  });
  assert.ok(
    whereSql.includes("eik = $"),
    "an 8-character identifier is served",
  );
});

test("a specialist does not rescue a sub-floor term of the WRONG shape", () => {
  // "ст" is not identifier-shaped, so it falls to the name arm and is floored. The
  // specialist's floor of 1 must not leak across to a term it never claimed.
  assert.throws(
    () => buildWhere(routedResource, { filters: { global: "ст" } }),
    (e) => e.name === "DbRequestError" && /at least 3/.test(e.message),
  );
});

test("the engine ANCHORS searchWhen, so a name carrying an EIK is not misrouted", () => {
  // The registry pattern below is deliberately unanchored. Unanchored matching claims
  // „Хемус 103267194 ЕООД" for the identifier arm, which then binds the WHOLE name as an
  // EIK: zero rows at a 200, the wrong-answer shape the length floor refuses to ship.
  // The engine wraps every pattern in ^(?:…)$ so this is unrepresentable rather than
  // merely discouraged.
  const R = {
    base: "t",
    columns: {
      eik: {
        type: "text",
        search: true,
        searchEq: true,
        searchWhen: "[0-9]{8,14}",
      },
      name: {
        type: "text",
        search: true,
        searchCol: "name_fold",
        searchFold: true,
      },
    },
    select: ["eik"],
    defaultSort: [["eik", "asc"]],
  };
  const { whereSql, params } = buildWhere(R, {
    filters: { global: "Хемус 103267194 ЕООД" },
  });
  assert.ok(
    whereSql.includes("name_fold"),
    "a name containing digits stays on the name arm",
  );
  assert.ok(
    !whereSql.includes("eik = $"),
    "the identifier arm does not claim it",
  );
  assert.deepEqual(params, ["Хемус 103267194 ЕООД"]);
  // …and the bare identifier still routes, so the anchoring did not break the feature.
  assert.ok(
    buildWhere(R, { filters: { global: "103267194" } }).whereSql.includes(
      "eik = $",
    ),
    "the whole-term identifier still routes",
  );
});

test("searchEq honours searchCol redirection", () => {
  // Every other arm's `searchCol` redirection is exercised; this one was not. A refactor
  // that used the logical id here would emit a valid query against the WRONG column and
  // pass every other test in this file.
  const R = {
    base: "t",
    columns: {
      key: {
        type: "text",
        search: true,
        searchEq: true,
        searchCol: "phys_col",
        searchWhen: "^[0-9]+$",
      },
    },
    select: ["key"],
    defaultSort: [["key", "asc"]],
  };
  const { whereSql } = buildWhere(R, { filters: { global: "12345678" } });
  assert.ok(whereSql.includes("phys_col = $"), "the PHYSICAL column is named");
  assert.ok(!/\bkey = \$/.test(whereSql), "not the logical id");
});

test("the FALSE predicate is AND-ed onto the scope, never a replacement", () => {
  // A FALSE that REPLACED the scope would turn a scoped no-match into a corpus-wide one
  // on the count query — the row count and the (empty) rows would then describe different
  // populations. The bare-resource test above cannot see this: it has no scope to lose.
  const { whereSql, params } = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "ns:2026_04_19" },
    filters: { global: "софарма", globalCols: ["eik"] },
  });
  assert.match(whereSql, /^WHERE scope_key = \$1 AND .*AND FALSE$/);
  assert.deepEqual(
    params,
    ["ns:2026_04_19", "ALL"],
    "the scope and the division default survive; no orphan search param is bound",
  );
});

test("every searchWhen compiles, and searchEq is exclusive of the pattern arms", () => {
  // A bad pattern would otherwise surface as a 500 on a live route, and a descriptor
  // carrying both searchEq and a pattern flag would emit whichever arm the if/else
  // happens to reach first — silently ignoring the other.
  //
  // ⚠️ NON-VACUITY FIRST. With no subscriber this sweep executes zero assertions and
  // still reports green, which reads as "the rule is enforced" when it means "nobody
  // uses the feature" — the shape this repo's data gates call out by name. Counted
  // rather than asserted per-resource so removing the last subscriber fails HERE, with
  // a message saying why, instead of quietly turning the whole sweep into a no-op.
  let routedCols = 0;
  for (const r of Object.values(REGISTRY))
    for (const d of Object.values(r.columns ?? {}))
      if (d.searchWhen != null || d.searchEq) routedCols++;
  assert.ok(
    routedCols > 0,
    "no column carries searchWhen/searchEq — this sweep would assert nothing",
  );

  for (const [name, r] of Object.entries(REGISTRY))
    for (const [id, d] of Object.entries(r.columns ?? {})) {
      if (d.searchWhen != null) {
        assert.equal(
          typeof d.searchWhen,
          "string",
          `${name}.${id}.searchWhen must be a regex SOURCE string`,
        );
        assert.doesNotThrow(
          () => new RegExp(d.searchWhen),
          `${name}.${id}.searchWhen is not a valid regex`,
        );
        assert.ok(
          d.search,
          `${name}.${id}: searchWhen needs search:true to ever be used`,
        );
        // ⚠️ A ROUTED ARM MUST BE `searchEq`, and this is the constraint that keeps the
        // 42x regression unrepresentable. Two specialists claiming one term are OR'd
        // together, and OR-ing an equality arm with a trigram arm is precisely the plan
        // the routing exists to avoid: measured, `(eik = $1 OR alias_fold ILIKE …)` is
        // 716 buffers against 4. Two `searchEq` specialists are safe (BitmapOr, 7
        // buffers), which is why the rule is on the arm KIND rather than on the count.
        //
        // Relaxing this needs a measurement, not an argument: EXPLAIN the mixed-arm OR
        // on the target relation under `plan_cache_mode = force_generic_plan` first.
        assert.ok(
          d.searchEq,
          `${name}.${id}: searchWhen requires searchEq — a routed non-equality arm can ` +
            `be OR'd with an equality one, which drops the whole predicate off its index`,
        );
      }
      if (!d.searchEq) continue;
      assert.ok(
        d.search,
        `${name}.${id}: searchEq needs search:true to ever be used`,
      );
      for (const k of [
        "searchFold",
        "searchText",
        "searchPrefix",
        "searchInSet",
      ])
        assert.ok(
          !d[k],
          `${name}.${id}: searchEq is mutually exclusive with ${k}`,
        );
    }
});

// ---- shliokavitsa, the second gin arm ----------------------------------------
// translit_bg_latin folds Cyrillic→Streamlined Latin on BOTH sides, so „СОФАРМА" and a
// typed „sofarma" already meet. What it cannot reach is the Latin-side spelling a
// Bulgarian types — „6ipka", „4erven", „jelezopyten" — since each folds to itself.
// Measured on contractor_rank: „6ipka" returns 0 rows from the plain arm and 7 with the
// rewrite (МЕТРО ШИПКА, КМТ-ШИПКА, ДЗЗД Шипка 2019 …), at 310 buffers against 255.

test("a trigger character adds a SECOND fold arm on the same column", () => {
  const { whereSql, params } = buildWhere(REGISTRY.contractor_rankings, {
    filters: { global: "6ipka" },
  });
  assert.equal(
    (whereSql.match(/name_fold ILIKE/g) || []).length,
    2,
    "plain arm + rewritten arm",
  );
  assert.ok(whereSql.includes("shlyo_query_fold"), "the rewrite is applied");
  // ONE bound parameter shared by both arms — the rewrite happens in SQL, so a second
  // placeholder would mean the two arms could be handed different terms.
  assert.equal(
    params.filter((p) => p === "6ipka").length,
    1,
    "the term is bound once",
  );
});

test("the shliokavitsa arm is GATED, not always on", () => {
  // Ungated, the rewrite fires on ordinary Cyrillic and injects rows the reader never
  // asked for: translit_bg_latin itself emits `y` for й/ь, so „Бойко Борисов" folds to
  // `boyko borisov` and would rewrite to `boako borisov`. 13.64% of 539,985 indexed
  // names rewrite under the client's wider trigger, 97.4% of them carrying no
  // shliokavitsa character at all.
  for (const g of ["софарма", "sofarma", "metro"]) {
    const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
      filters: { global: g },
    });
    assert.ok(
      !whereSql.includes("shlyo_query_fold"),
      `${g} carries no trigger character and must get ONE arm`,
    );
  }
});

test("a bare `y` is deliberately NOT a trigger", () => {
  // The client's SHLYO_TRIGGER includes y(?![aeiou]); the server's must not, because
  // every Latin-typed Bulgarian name has one. The client tolerates the ambiguity because
  // its probe is a substring test where a nonsense needle matches nothing; here the arm
  // is a fuzzy trigram/ILIKE match, where a nonsense needle matches plenty.
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    filters: { global: "boyko" },
  });
  assert.ok(
    !whereSql.includes("shlyo_query_fold"),
    "no second arm for a bare y",
  );
});

test("the shliokavitsa arm never reaches a routed identifier term", () => {
  // `j`/`q`/`w`/`x` are trigger characters and also legal hex, so a synthetic supplier
  // key could carry one. Routing runs first, so the identifier gets its equality arm and
  // no fold arm at all — OR-ing a gin scan onto a btree equality is the 704-buffer plan.
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    filters: { global: "obed-3c76d4088cb9" },
  });
  assert.ok(whereSql.includes("eik = $"), "routed to the equality arm");
  assert.ok(
    !whereSql.includes("shlyo_query_fold"),
    "and carries no fold arm to OR against it",
  );
});

test("the rewrite rides the SAME escape wrapper as the plain arm", () => {
  // Both needles are produced server-side, so both must be escaped server-side — a
  // JS-side escape would be undone by the transliteration. An unescaped rewrite would
  // let a typed `%` turn the second arm into a scan of everything, which is exactly the
  // 11,672 ms failure the plain arm's escape was added for.
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    filters: { global: "6ipka" },
  });
  // Matched on the fold arms specifically rather than by splitting the whole WHERE:
  // `split(" OR ").length === 2` holds only while this resource contributes exactly one
  // non-OR filter chain, and it already has a second searchable column (`eik`) that this
  // term merely does not route to. Measured, the same term splits into 2 arms here, 3 on
  // persons and 6 on tenders — so a whole-clause split would fail on the count, or on an
  // arm like `unp LIKE $1` that legitimately needs no escape, naming the wrong cause.
  const foldArms =
    whereSql.match(/name_fold ILIKE '%' \|\| replace\(replace\(replace\(/g) || [];
  assert.equal(foldArms.length, 2, "both needles are escaped server-side");
});

test("the rewrite WRAPS the transliteration, not the other way round", () => {
  // Not commutative on uppercase input, which is how people type company names:
  //   shlyo_query_fold(translit_bg_latin('Jelqzkov')) = 'zhelyazkov'   ← as written
  //   translit_bg_latin(shlyo_query_fold('Jelqzkov')) = 'jelyazkov'    ← reversed, wrong
  // because reversed, the j→zh rule never sees the lowercased form. The two orders AGREE
  // on lowercase input, so a swapped refactor passes every other assertion here and
  // breaks uppercase shliokavitsa queries only — the same swapped-argument class the
  // declared_label sweep is documented as unable to catch.
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    filters: { global: "6ipka" },
  });
  assert.match(whereSql, /shlyo_query_fold\(translit_bg_latin\(\$\d+\)\)/);
  assert.doesNotMatch(whereSql, /translit_bg_latin\(shlyo_query_fold\(/);
});

test("an UPPERCASE shliokavitsa term still fires the arm", () => {
  // The `i` flag on SHLYO_TRIGGER_RAW is what makes this work: the gate tests the RAW
  // term, while the rewrite runs after translit_bg_latin has lowercased it. Without the
  // flag „6IPKA" silently skips the arm while „6ipka" works.
  for (const g of ["6IPKA", "JELQZKOV", "PLOWDIW"])
    assert.ok(
      buildWhere(REGISTRY.contractor_rankings, {
        filters: { global: g },
      }).whereSql.includes("shlyo_query_fold"),
      `${g} must fire the rewrite`,
    );
});

test("a standalone digit run does NOT fire the arm", () => {
  // `4`/`6`/`9` are ordinary digits in years, road numbers and УНП — unlike q/j/w/x, which
  // translit_bg_latin never emits. In shliokavitsa a digit stands in for a LETTER and so
  // sits inside a word. Measured over 611,704 corpus names, requiring letter-adjacency
  // removes 89% of the fires (4,684 → 513) and loses no genuine spelling.
  for (const g of [
    "автомагистрали 6",
    "мостстрой 49",
    "2024 ремонт",
    "София 1946",
    "ОУ 4",
  ])
    assert.ok(
      !buildWhere(REGISTRY.contractor_rankings, {
        filters: { global: g },
      }).whereSql.includes("shlyo_query_fold"),
      `${g} is ordinary Bulgarian and must get ONE arm`,
    );
  // …while the letter-adjacent digits that ARE shliokavitsa keep firing.
  for (const g of ["6ipka", "4erven", "9nko", "av4ar", "mlqko"])
    assert.ok(
      buildWhere(REGISTRY.contractor_rankings, {
        filters: { global: g },
      }).whereSql.includes("shlyo_query_fold"),
      `${g} is a genuine spelling and must fire`,
    );
});

test("the length floor is measured on the RAW term, not the rewrite", () => {
  // „6t" is щ — two characters, so the floor refuses it even though its rewrite („sht")
  // would be three and perfectly indexable. Deliberate: one rule, stated once, measured
  // on what the reader typed. The alternative — flooring the rewritten needle — makes the
  // minimum length depend on which rules happen to fire, which is unexplainable in a UI
  // hint. Pinned so the refusal reads as a decision rather than an oversight.
  assert.throws(
    () => buildWhere(REGISTRY.contractor_rankings, { filters: { global: "6t" } }),
    (e) => e.name === "DbRequestError" && /at least 3/.test(e.message),
  );
  // …and the same spelling one character longer is served with both arms.
  assert.ok(
    buildWhere(REGISTRY.contractor_rankings, {
      filters: { global: "6tu" },
    }).whereSql.includes("shlyo_query_fold"),
  );
});

test("SHLYO_TRIGGER_RAW has ONE definition, and db_routes.js imports it", () => {
  // The move's whole purpose is a single definition for the `functions/` package.
  // Re-declaring a local copy in db_routes.js would shadow the import, leave both modules
  // green, and let the two drift exactly as the constant's header says they must not.
  // Source-scanning is the established idiom here (entryGraph.test.ts, key_usage.test.ts).
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "db_routes.js"),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /SHLYO_TRIGGER_RAW\s*=/,
    "db_routes.js must import the pattern, never redeclare it",
  );
  assert.match(src, /SHLYO_TRIGGER_RAW/, "…and must still USE it");
  assert.ok(SHLYO_TRIGGER_RAW instanceof RegExp);
  // No /g: .test() would carry lastIndex across two modules sharing one instance, so
  // alternating callers would get alternating answers.
  assert.equal(SHLYO_TRIGGER_RAW.flags.includes("g"), false, "no /g flag");
});

test("searchText columns do NOT get the shliokavitsa arm", () => {
  // A decision, not an oversight: `searchText` matches through fold_prefix_tsquery and
  // would need a differently shaped rewrite. Pinned so the omission stays deliberate.
  const { whereSql } = buildWhere(contracts, {
    filters: { global: "6ipka", globalCols: ["title"] },
  });
  assert.ok(whereSql.includes("fold_prefix_tsquery"), "the FTS arm is there");
  assert.ok(!whereSql.includes("shlyo_query_fold"), "and carries no rewrite");
});

// ---- registry shape invariants ----------------------------------------------
// The engine assumes these and never checks them, so a mistake fails at RUNTIME with a
// 500 on the live route rather than at commit time. Table-driven over every resource so
// a new one is covered the moment it is added.
//
// NOTE what is deliberately NOT asserted: `select ⊆ columns`. The two serve different
// purposes — `columns` is the CLIENT-facing whitelist (what may be sorted/filtered/
// searched, the security boundary), while `select` is the server-controlled projection
// and is legitimately broader. `ngos` projects `signals` (a real ngos_list column) that
// is intentionally not client-addressable. Validating projection names needs the live
// schema, not the registry.

test("every client-addressable column is declared", () => {
  // The security-relevant direction: anything the client can name in a sort, filter,
  // search or scope MUST be in `columns`, because that is the only place the engine
  // validates identifiers before they reach the SQL string.
  for (const [name, r] of Object.entries(REGISTRY)) {
    for (const [col] of r.defaultSort ?? [])
      assert.ok(
        r.columns[col],
        `${name}: defaultSort references undeclared column '${col}'`,
      );
    for (const c of r.scopeCols ?? [])
      assert.ok(
        r.columns[c],
        `${name}: scopeCol '${c}' is not declared in columns`,
      );
  }
});

test("every column descriptor declares a type", () => {
  // `type` picks the filter/predicate shape; a descriptor without one silently falls
  // through the builder's switch and the filter becomes a no-op.
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [id, d] of Object.entries(r.columns))
      assert.ok(
        typeof d === "object" && d !== null && typeof d.type === "string",
        `${name}.${id}: column descriptor must declare a type`,
      );
});

test("the pagination tiebreak column is part of the projection", () => {
  // buildOrder appends `key` (or select[0]) as the deterministic tiebreak, so it has to
  // be selected — otherwise paging can repeat or skip a row at a page boundary.
  for (const [name, r] of Object.entries(REGISTRY)) {
    const tie = r.columns.key ? "key" : r.select[0];
    assert.ok(
      r.select.includes(tie),
      `${name}: pagination tiebreak '${tie}' is not in select`,
    );
  }
});

test("aggregate columns are declared and numeric", () => {
  for (const [name, r] of Object.entries(REGISTRY)) {
    for (const a of r.aggregates ?? []) {
      if (!a.col) continue; // bare count()
      assert.ok(
        r.columns[a.col],
        `${name}: aggregate over undeclared column '${a.col}'`,
      );
    }
  }
});

test("persons declares no sum aggregate over public_money_eur", () => {
  // The money on a /persons row is what the person's COMPANIES won, and two co-officers
  // of one company each carry that company's full sum. A column total is therefore
  // double-counted — large, plausible and wrong, with nothing to flag it. The matview
  // header (120_person_browse.sql) and person_browse.data.test.ts carry the same warning
  // from the data side; this is the one that fails if someone adds `agg: "sum"` here.
  const r = REGISTRY.persons;
  assert.ok(r, "the persons resource has gone missing");
  for (const a of r.aggregates ?? [])
    assert.notEqual(
      a.col,
      "public_money_eur",
      "persons aggregates public_money_eur — co-officers of one company each carry its full sum, so the total double-counts",
    );
  assert.ok(
    !r.columns.public_money_eur.agg,
    "public_money_eur declares an `agg` — same double-counting problem",
  );
});

test("persons filters the padded code sets, never the display scalar", () => {
  // oblast_code is the REPRESENTATIVE seat; oblast_codes is every oblast the person holds
  // a role in. Filtering the scalar drops 1,851 people from an oblast they genuinely
  // serve, which renders as "no such people" rather than as a narrowed view.
  const c = REGISTRY.persons.columns;
  assert.ok(!c.oblast_code.filter, "oblast_code must stay display-only");
  assert.equal(c.oblast_codes.filter, "text");
  for (const set of [
    "role_codes",
    "facet_codes",
    "party_codes",
    "oblast_codes",
  ])
    assert.equal(c[set].filter, "text", `${set} must be a text (ILIKE) filter`);
});

test("persons searches the name FOLD, with the term folded too", () => {
  // searchCol without searchFold matches a Cyrillic query against transliterated Latin
  // text and returns nothing, forever — while looking like a working query.
  const n = REGISTRY.persons.columns.name;
  assert.equal(n.searchCol, "name_fold");
  assert.equal(
    n.searchFold,
    true,
    "name targets name_fold without folding the search term — every Cyrillic search returns 0 rows",
  );
});

test("facet:true is only used where the column is NOT filterable", () => {
  // A filterable column is facetable already, so `facet: true` beside a `filter` is inert
  // config that reads as a supported feature — the exact class of bug the unknown-keys test
  // below exists for. The flag is only meaningful on a column deliberately kept
  // unfilterable (persons.oblast_code).
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [col, d] of Object.entries(r.columns))
      if (d.facet)
        assert.ok(
          !d.filter,
          `${name}.${col} declares both filter and facet:true — the facet flag does nothing there`,
        );
});

test("runDbFacets groups a facet:true column that has no filter", async () => {
  // The regression this guards: runDbFacets used to require `filter`, so a facet-only
  // column returned NO bucket at all — the dropdown it feeds silently rendered empty and
  // the control vanished, with no error anywhere.
  const seen = [];
  const q = async (sql) => {
    seen.push(sql);
    return [];
  };
  await runDbFacets(q, { resource: "persons", columns: ["oblast_code"] });
  assert.equal(seen.length, 1, "facet:true column was skipped");
  assert.match(seen[0], /GROUP BY oblast_code/);
});

test("runDbFacets still refuses a column that is neither filterable nor facetable", async () => {
  const seen = [];
  const q = async (sql) => {
    seen.push(sql);
    return [];
  };
  await runDbFacets(q, { resource: "persons", columns: ["photo_url"] });
  assert.equal(seen.length, 0, "a non-facetable column was grouped anyway");
});

test("no resource carries unknown top-level registry keys", () => {
  // Guards against inert config that reads as a supported feature — `facets: [...]`
  // looked declarative but runDbFacets builds from req.columns and never read it.
  const KNOWN = new Set([
    "base",
    "aggBase",
    "scopeCols",
    "defaultScope",
    "defaultFilters",
    "columns",
    "select",
    "defaultSort",
    "aggregates",
    "maxPageSize",
  ]);
  for (const [name, r] of Object.entries(REGISTRY))
    for (const k of Object.keys(r))
      assert.ok(KNOWN.has(k), `${name}: unknown registry key '${k}'`);
});

test("defaultScope, where declared, names a real scope column", () => {
  for (const [name, r] of Object.entries(REGISTRY)) {
    if (!r.defaultScope) continue;
    assert.ok(
      r.defaultScope.col && typeof r.defaultScope.val === "string",
      `${name}: defaultScope must be { col, val }`,
    );
    assert.ok(
      r.scopeCols.includes(r.defaultScope.col),
      `${name}: defaultScope column '${r.defaultScope.col}' is not in scopeCols — ` +
        `buildWhere would throw on every unscoped request`,
    );
  }
});

// Fan-out resources — those whose base emits one row per (entity, scope value) — MUST
// declare a defaultScope, because an unscoped query over them returns the union of every
// bucket: each entity counted once per bucket, count aggregate and facets inflated to
// match, and no error. Listed explicitly rather than inferred: nothing in the registry
// distinguishes a fan-out base from a normal one, and a new fan-out resource shipping
// without a default is precisely the regression this pins.
test("every fan-out resource declares a defaultScope", () => {
  const FAN_OUT = [
    "mp_assets_rankings",
    "mp_cars",
    "procurement_settlements",
    "contractor_rankings",
    // Both fan out on scope_key (year partitions + 'all' + the '' default), so an
    // unscoped query unions ~2.1x the corpus. Measured when they shipped without a
    // default: €14.04bn and €23.66bn against a real €11.04bn.
    "agri_recipients",
    "agri_schemes",
    "agri_political",
    "agri_cross_programme",
    // Both declaration registers fan out on `scope`, and their matview headers say the entry
    // MUST carry a defaultScope. Neither was listed, so deleting it failed nothing — measured
    // on abroad_holdings, an unscoped query returns 3.73x the rows and 4.06x the money.
    "crypto_holdings",
    "abroad_holdings",
  ];
  for (const name of FAN_OUT) {
    assert.ok(REGISTRY[name], `${name} is no longer a registry resource`);
    assert.ok(
      REGISTRY[name].defaultScope,
      `${name} fans out on ${REGISTRY[name].scopeCols.join("/")} but has no ` +
        `defaultScope — an unscoped query would silently double-count`,
    );
  }
});

test("buildWhere applies defaultScope when the caller sends none", () => {
  const { whereSql, params } = buildWhere(REGISTRY.mp_cars, {});
  assert.match(whereSql, /ns = \$1/);
  assert.deepEqual(params, ["all"]);

  // An explicit scope still wins over the default.
  const explicit = buildWhere(REGISTRY.mp_cars, {
    scope: { col: "ns", val: "52" },
  });
  assert.deepEqual(explicit.params, ["52"]);
});

// defaultFilters is the SECOND-margin analogue of defaultScope: contractor_rankings
// fans out on (scope_key × division), each with a rollup bucket, but defaultScope
// covers only scope_key. Without a default on `division`, an unscoped query unions the
// 'ALL' rollup row with every per-division row per contractor → a ~2× leaderboard.
test("every declared defaultFilter names a filterable column", () => {
  for (const [name, r] of Object.entries(REGISTRY)) {
    for (const df of r.defaultFilters ?? []) {
      assert.ok(
        df.col && "val" in df,
        `${name}: defaultFilter must be { col, val }`,
      );
      assert.ok(
        r.columns[df.col] && r.columns[df.col].filter,
        `${name}: defaultFilter column '${df.col}' is not a filterable column — ` +
          `buildWhere would throw on every request that omits it`,
      );
    }
  }
});

test("buildWhere defaults the division margin when the caller omits it", () => {
  // The regression that pins the [FINDING-001] double-count fix: a scope-only request
  // must still constrain division to the 'ALL' rollup.
  const { whereSql, params } = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "all" },
  });
  assert.match(whereSql, /scope_key = \$\d/);
  assert.match(
    whereSql,
    /division = \$\d/,
    "division margin not defaulted — the leaderboard double-counts",
  );
  assert.ok(params.includes("ALL"));

  // An explicit division still wins — the default is only applied when absent.
  const explicit = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "all" },
    filters: { columns: [{ id: "division", value: "45" }] },
  });
  assert.ok(explicit.params.includes("45"));
  assert.ok(
    !explicit.params.includes("ALL"),
    "explicit division should suppress the 'ALL' default",
  );
});

test("a facet on a defaulted column suppresses that column's defaultFilter", () => {
  // runDbFacets passes skipDefaultFilterCols = the faceted columns, so a `division`
  // facet enumerates all divisions instead of being pinned to the 'ALL' default.
  const withSkip = buildWhere(
    REGISTRY.contractor_rankings,
    { scope: { col: "scope_key", val: "all" } },
    { skipDefaultFilterCols: new Set(["division"]) },
  );
  assert.doesNotMatch(
    withSkip.whereSql,
    /division = \$\d/,
    "division default not suppressed — the facet would return only the 'ALL' bucket",
  );
  // A facet on a DIFFERENT column still gets the division default (double-count-safe).
  const other = buildWhere(
    REGISTRY.contractor_rankings,
    { scope: { col: "scope_key", val: "all" } },
    { skipDefaultFilterCols: new Set(["is_mp_tied"]) },
  );
  assert.match(other.whereSql, /division = \$\d/);
});

test("contractor_rankings searches the name FOLD, with the term folded", () => {
  const n = REGISTRY.contractor_rankings.columns.name;
  assert.equal(n.searchCol, "name_fold");
  assert.equal(n.searchFold, true);
  const { whereSql } = buildWhere(REGISTRY.contractor_rankings, {
    scope: { col: "scope_key", val: "all" },
    filters: { global: "sofarma" },
  });
  // The fold arm wraps the transliteration in LIKE-metacharacter escaping — see
  // "LIKE metacharacters are escaped on the pre-existing arms too".
  assert.match(
    whereSql,
    /name_fold ILIKE '%' \|\| replace\(replace\(replace\(/,
  );
  assert.match(whereSql, /translit_bg_latin\(\$\d\)/);
});

test("contractor_rankings sum/max aggregate only the agg-marked total_eur", () => {
  const c = REGISTRY.contractor_rankings.columns;
  assert.equal(c.total_eur.agg, "sum");
  for (const a of REGISTRY.contractor_rankings.aggregates)
    if (a.col)
      assert.equal(
        c[a.col].agg,
        "sum",
        `${a.fn} over a non-agg column ${a.col}`,
      );
});

// ── runDbFacets: filter-scoped facets (the `filters` merge) ──────────────────
// The contracts table now issues facets that apply the active filters (minus the
// facet's own dimension) so the mix bar / dropdowns reflect the current scope.
// runDbFacets must merge req.filters with req.fixedFilters into the WHERE, and
// omitting req.filters must reproduce the pre-change (fixedFilters-only) behavior.

test("runDbFacets merges req.filters with fixedFilters into the WHERE", async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  await runDbFacets(q, {
    resource: "contracts",
    scope: { col: "contractor_eik", val: "X" },
    fixedFilters: [{ id: "tag", value: ["contract"] }],
    filters: [{ id: "date", min: "2024-01-01", max: "2024-12-31" }],
    columns: ["procurement_method"],
    limit: 100,
  });
  assert.equal(calls.length, 1, "one query per requested facet column");
  const { sql, params } = calls[0];
  assert.ok(sql.includes("procurement_method"), "groups by the facet column");
  assert.ok(params.includes("X"), "scope value present");
  assert.ok(params.includes("contract"), "fixedFilter (tag) present");
  assert.ok(
    params.includes("2024-01-01") && params.includes("2024-12-31"),
    "user filter (date range) merged into the WHERE",
  );
});

test("runDbFacets suppresses a defaulted column's default ONLY in its own facet", async () => {
  // Co-request the defaulted `division` and another column together. The division
  // facet must enumerate all divisions (its default suppressed), while the is_mp_tied
  // facet must KEEP division='ALL' — otherwise it unions the rollup with every
  // per-division row and double-counts. This is why the WHERE is built per-facet.
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  await runDbFacets(q, {
    resource: "contractor_rankings",
    scope: { col: "scope_key", val: "all" },
    columns: ["division", "is_mp_tied"],
    limit: 50,
  });
  assert.equal(calls.length, 2, "one query per requested facet column");
  const divisionCall = calls.find((c) => / division AS value/.test(c.sql));
  const mpCall = calls.find((c) => /is_mp_tied AS value/.test(c.sql));
  assert.ok(divisionCall && mpCall, "both facet queries present");
  assert.ok(
    !/division = \$/.test(divisionCall.sql),
    "division facet still pinned to its own 'ALL' default — would return one bucket",
  );
  assert.ok(
    /division = \$/.test(mpCall.sql) && mpCall.params.includes("ALL"),
    "is_mp_tied facet lost the division default — buckets double-count",
  );
});

test("runDbFacets without req.filters keeps the fixedFilters-only behavior", async () => {
  const calls = [];
  const q = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  await runDbFacets(q, {
    resource: "contracts",
    scope: { col: "contractor_eik", val: "X" },
    fixedFilters: [{ id: "tag", value: ["contract"] }],
    columns: ["procurement_method"],
    limit: 100,
  });
  const { params } = calls[0];
  assert.ok(params.includes("X") && params.includes("contract"));
  assert.ok(
    !params.includes("2024-01-01"),
    "no user filter applied when req.filters is omitted",
  );
});

// buildAggSelect (persons-pg-retirement-v1 T2.2): a column-scoped `count` is a NON-NULL
// count, distinct from the always-present count(*); sum still requires agg:"sum". These lock
// the backward-compat contract so the /mp-cars summary (count / count(value_eur) /
// sum(value_eur)) can't silently regress.
test("buildAggSelect: bare count is count(*); column count is a non-null count", () => {
  const r = {
    base: "t",
    columns: { value_eur: { type: "number", agg: "sum" } },
    aggregates: [
      { fn: "count" },
      { fn: "count", col: "value_eur" },
      { fn: "sum", col: "value_eur" },
    ],
  };
  const sql = buildAggSelect(r);
  assert.match(sql, /count\(\*\)::bigint AS _count/);
  assert.match(sql, /count\(value_eur\)::bigint AS "countValueEur"/);
  assert.match(sql, /coalesce\(sum\(value_eur\),0\) AS "sumValueEur"/);
});

test("buildAggSelect: sum without agg:'sum', or a count over an unknown column, emit nothing extra", () => {
  const noAggFlag = buildAggSelect({
    base: "t",
    columns: { x: { type: "number" } },
    aggregates: [{ fn: "count" }, { fn: "sum", col: "x" }],
  });
  assert.equal(noAggFlag, "count(*)::bigint AS _count", "sum needs agg:'sum'");

  const unknownCol = buildAggSelect({
    base: "t",
    columns: {},
    aggregates: [{ fn: "count" }, { fn: "count", col: "nope" }],
  });
  assert.equal(
    unknownCol,
    "count(*)::bigint AS _count",
    "a count over a column absent from the registry is dropped",
  );
});

// ── procurement_settlements (the by-settlement ranking) ─────────────────────────────────
// Registered in the same commit that moved /procurement/by-settlement off a 196 KB static
// blob. Every assertion below guards a SILENT failure: the wrong scope unions ~30 time
// windows into one ranking, a missing tiebreak shuffles rows between pages, and a raw
// ILIKE search would seq-scan every scope instead of using the trigram index.

const settlements = REGISTRY.procurement_settlements;

test("procurement_settlements is scoped by scope_key", () => {
  // Without this the resource would union every pscope window — ~30 copies of each
  // settlement summed into a ranking that matches no period on the page.
  assert.deepEqual(settlements.scopeCols, ["scope_key"]);
});

test("procurement_settlements searches the transliterated fold, not the raw name", () => {
  const { whereSql } = buildWhere(settlements, {
    filters: { global: "veliko tarnovo" },
  });
  // The fold is what makes Latin input match Cyrillic names AND what the gin_trgm index
  // is built on; searching `name` directly would be both wrong and a seq scan.
  assert.ok(whereSql.includes("name_fold"), "fold arm present");
  assert.ok(
    whereSql.includes("translit_bg_latin"),
    "query is folded with the same function as the column",
  );
  assert.ok(!whereSql.includes("name ILIKE"), "raw name is not searched");
});

test("procurement_settlements sorts by value with an ekatte tiebreak", () => {
  // total_eur alone is not a total order — settlements share values — so pagination would
  // drop or repeat rows without the second key.
  assert.deepEqual(settlements.defaultSort, [
    ["total_eur", "desc"],
    ["ekatte", "asc"],
  ]);
});

test("procurement_settlements exposes count, sum and max of total_eur", () => {
  // max backs the in-cell magnitude bar: its denominator is the largest value in the
  // CURRENT filtered set, which is a property of the whole result rather than of the page.
  const sql = buildAggSelect(settlements);
  assert.ok(
    sql.includes('count(*)::bigint AS "_count"') ||
      sql.includes("count(*)::bigint"),
  );
  assert.ok(sql.includes("sum(total_eur)"), "sum arm present");
  assert.ok(
    sql.includes('coalesce(max(total_eur),0) AS "maxTotalEur"'),
    "max arm present and coalesced — an empty filtered set must size the bar as 0, not NaN",
  );
});

test("the max aggregate is gated exactly like sum", () => {
  // A caller must not be able to aggregate an arbitrary column…
  const rogue = {
    columns: { ekatte: { type: "text" } },
    aggregates: [{ fn: "max", col: "ekatte" }],
  };
  assert.ok(
    !buildAggSelect(rogue).includes("max(ekatte)"),
    "max on an un-marked column must be dropped",
  );
  // …and a truthy-but-wrong `agg` marker must not slip a text column through, whose max
  // the client would read via Number() as NaN.
  const mislabelled = {
    columns: { province: { type: "text", agg: "count" } },
    aggregates: [{ fn: "max", col: "province" }],
  };
  assert.ok(
    !buildAggSelect(mislabelled).includes("max(province)"),
    "max must require agg === 'sum', not merely a truthy agg",
  );
});

test("procurement_settlements projects the English name without sorting on it", () => {
  // The ranking is one row per place; re-ordering it by transliteration would reshuffle
  // the table for an English reader with no explanation.
  assert.ok(settlements.select.includes("name_en"), "name_en is projected");
  assert.ok(!settlements.columns.name_en.sort, "name_en is not sortable");
});

// --- awarder_ekatte: the settlement semi-join (procurement-settlement-browser-v1 §2.1) ---

test("semijoin emits a parameterized subquery against the REAL column", () => {
  const { whereSql, params } = buildWhere(contracts, {
    filters: { columns: [{ id: "awarder_ekatte", value: "68134" }] },
  });
  // The virtual column's name never reaches the SQL — awarder_eik does.
  assert.ok(
    !whereSql.includes("awarder_ekatte"),
    "the virtual column name must not appear in SQL",
  );
  assert.ok(
    whereSql.includes("awarder_eik IN (SELECT eik FROM awarder_seats"),
    "constrains the real column via the registry subquery",
  );
  // is_local_hq keeps national buyers out, matching procurement_by_settlement().
  assert.ok(whereSql.includes("is_local_hq"), "local-tier predicate preserved");
  // The value is BOUND, never interpolated.
  assert.ok(whereSql.includes("ekatte = $1"), "placeholder, not a literal");
  assert.deepEqual(params, ["68134"]);
});

test("semijoin binds a hostile value rather than interpolating it", () => {
  const { whereSql, params } = buildWhere(contracts, {
    filters: {
      columns: [
        { id: "awarder_ekatte", value: "68134'; DROP TABLE contracts--" },
      ],
    },
  });
  assert.ok(!whereSql.includes("DROP TABLE"), "no client text reaches the SQL");
  assert.deepEqual(params, ["68134'; DROP TABLE contracts--"]);
});

test("a required semijoin THROWS on an absent value rather than serving the corpus", () => {
  // The whole point of `required`: dropping this clause does not narrow anything,
  // it widens to every contract in the country — served at a 200, with an exact
  // count, under one settlement's heading. Fail closed instead.
  for (const value of ["", null, undefined]) {
    assert.throws(
      () =>
        buildWhere(contracts, {
          filters: { columns: [{ id: "awarder_ekatte", value }] },
        }),
      /required filter received no value/,
      `value ${JSON.stringify(value)} must be refused`,
    );
  }
});

test("a semijoin refuses a non-scalar value instead of matching nothing", () => {
  // node-postgres would bind an array as '{68134,56784}', which equals no ekatte —
  // rendering "0 contracts" for a settlement that has thousands.
  assert.throws(
    () =>
      buildWhere(contracts, {
        filters: {
          columns: [{ id: "awarder_ekatte", value: ["68134", "56784"] }],
        },
      }),
    /expects a scalar value/,
  );
});

test("the semijoin composes with the scope window and tag, all bound", () => {
  // The shape the settlement page actually sends: tag + pscope window + the place.
  //
  // The upper bound is the day BEFORE the next election (2026-04-18, not -19).
  // src/data/scope/scopeRange.ts is explicit that the DB endpoints filter
  // `date <= to` inclusively, so an ns window must stop a day short to stay
  // half-open — a contract dated on election day belongs to the NEXT parliament.
  // Pinned here because a browser that used the election date itself would show
  // rows the by-settlement KPI excludes, and the two would reconcile nowhere.
  const { whereSql, params } = buildWhere(contracts, {
    filters: {
      columns: [
        { id: "tag", value: ["contract"] },
        { id: "date", min: "2023-04-02", max: "2026-04-18" },
        { id: "awarder_ekatte", value: "68134" },
      ],
    },
  });
  assert.ok(whereSql.includes("date >= $"), "window lower bound is sargable");
  assert.ok(whereSql.includes("date <= $"), "window upper bound is sargable");
  assert.ok(whereSql.includes("awarder_seats"), "semi-join present");
  assert.deepEqual(params, ["contract", "2023-04-02", "2026-04-18", "68134"]);
});

test("awarder_ekatte is filter-only — not projected, sorted, searched or view-bound", () => {
  const def = contracts.columns.awarder_ekatte;
  // It names no real column, so projecting or sorting it would be a 42703.
  assert.ok(!contracts.select.includes("awarder_ekatte"), "not projected");
  assert.ok(!def.sort, "not sortable");
  assert.ok(!def.search, "not searchable");
  // NOT viewOnly: the semi-join constrains a BASE column, so aggregates must stay
  // on aggBase (`contracts`) and keep the migration-113 covering indexes.
  assert.ok(!def.viewOnly, "must not force the aggregate onto the view");
});

test("a semijoin column is refused as a facet", () => {
  // GROUP BY on a virtual column is an undefined-column error, not a vocabulary.
  const calls = [];
  const dbRows = async (sql, params) => {
    calls.push({ sql, params });
    return [];
  };
  return runDbFacets(dbRows, {
    resource: "contracts",
    columns: ["awarder_ekatte"],
    filters: [],
  }).then((out) => {
    assert.deepEqual(out.facets, {}, "no facet is produced");
    assert.equal(calls.length, 0, "and no query is issued");
  });
});

test("the semijoin keeps count+sum on the base table, not the view", async () => {
  // The registry comment stakes a MEASURED claim (count+sum 54ms) that holds only
  // while aggBaseFor returns `contracts`. Aggregating over contracts_list instead
  // would drop to the seq-scan path the aggBase comment describes, with every other
  // test still green.
  const sqls = [];
  const q = async (sql) => {
    sqls.push(sql);
    return [{ _count: "0" }];
  };
  await runDbTable(q, {
    resource: "contracts",
    filters: { columns: [{ id: "awarder_ekatte", value: "68134" }] },
  });
  const agg = sqls.find((s) => s.includes("count(*)::bigint"));
  assert.ok(agg, "an aggregate query ran");
  assert.match(agg, /FROM contracts /, "aggregate stayed on aggBase");
  assert.ok(
    agg.includes("awarder_seats"),
    "and the semi-join reached the aggregate WHERE",
  );
});

test("a semijoin fixedFilter scopes every facet without becoming one", async () => {
  // The shape the settlement page sends: the place as a fixedFilter, real columns
  // as the facets. Neither the table nor the facet tests above cover this path.
  const sqls = [];
  const q = async (sql) => {
    sqls.push(sql);
    return [];
  };
  await runDbFacets(q, {
    resource: "contracts",
    columns: ["procurement_method", "cpv"],
    fixedFilters: [
      { id: "tag", value: ["contract"] },
      { id: "awarder_ekatte", value: "68134" },
    ],
  });
  assert.equal(sqls.length, 2, "both real facets ran");
  for (const s of sqls) {
    assert.ok(
      s.includes("awarder_eik IN (SELECT eik FROM awarder_seats"),
      "facet is place-scoped",
    );
    assert.ok(
      !s.includes("awarder_ekatte"),
      "the virtual name never reaches SQL",
    );
    assert.match(s, /FROM contracts /, "facets stayed on aggBase");
  }
});

test("every semijoin column in the registry is well-formed", () => {
  // These descriptor keys are the first column-level registry keys with structural
  // requirements, and every way of getting them wrong is a request-time 500 or a
  // 42703 rather than a startup failure. Check them statically instead.
  let checked = 0;
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [id, d] of Object.entries(r.columns)) {
      if (d.filter !== "semijoin") continue;
      checked++;
      assert.equal(
        typeof d.semiJoinSql,
        "string",
        `${name}.${id}: no semiJoinSql (a misspelled key is a 500 at request time)`,
      );
      assert.equal(
        d.semiJoinSql.split("?").length,
        2,
        `${name}.${id}: template needs exactly one ? placeholder`,
      );
      assert.ok(
        r.columns[d.semiJoinCol],
        `${name}.${id}: semiJoinCol '${d.semiJoinCol}' is not a declared column`,
      );
      // A viewOnly target would 42703 on the aggregate query alone: physicalColId
      // now resolves through semiJoinCol, so aggBaseFor WOULD see it — this keeps
      // that guarantee from regressing if the resolution is ever reverted.
      assert.ok(
        !r.columns[d.semiJoinCol].viewOnly,
        `${name}.${id}: semiJoinCol '${d.semiJoinCol}' is viewOnly — the aggregate would 42703`,
      );
      // Virtual: it names no real column, so it must stay out of the projection,
      // the sort whitelist and the global search.
      assert.ok(
        !(r.select ?? []).includes(id),
        `${name}.${id}: virtual column must not be projected`,
      );
      assert.ok(
        !d.sort && !d.search,
        `${name}.${id}: virtual column must not be sortable or searchable`,
      );
    }
  assert.ok(
    checked > 0,
    "the invariant actually ran against a semijoin column",
  );
});

test("a malformed semijoin template is refused", () => {
  // The only coverage the parts.length !== 2 branch has.
  const bad = {
    columns: {
      x: {
        type: "text",
        filter: "semijoin",
        semiJoinCol: "y",
        semiJoinSql: "SELECT y FROM t WHERE a = ? AND b = ?",
      },
    },
    scopeCols: [],
    select: ["y"],
  };
  assert.throws(
    () => buildWhere(bad, { filters: { columns: [{ id: "x", value: "1" }] } }),
    /exactly one placeholder/,
  );
});

// ── isdistinct filter mode (person contracts browser, migration 125) ──────────────────────
// The mode exists for NULL-safety: excluding €0 consortium-MEMBER rows must KEEP the ~99% of
// contracts whose consortium_role is NULL, which `!=` would drop. `not_consortium_member`
// remaps the physical `consortium_role` column via `col`.
test("isdistinct emits a NULL-safe parameterized inequality (member exclusion)", () => {
  const { whereSql, params } = buildWhere(contracts, {
    filters: { columns: [{ id: "not_consortium_member", value: "member" }] },
  });
  assert.match(whereSql, /consortium_role IS DISTINCT FROM \$\d+/);
  assert.deepEqual(params, ["member"]);
});

test("isdistinct with an empty value drops the predicate (never IS DISTINCT FROM NULL)", () => {
  for (const value of [null, undefined, ""]) {
    const { whereSql, params } = buildWhere(contracts, {
      filters: { columns: [{ id: "not_consortium_member", value }] },
    });
    assert.ok(
      !/IS DISTINCT FROM/.test(whereSql),
      `empty value ${JSON.stringify(value)} must emit no predicate`,
    );
    assert.deepEqual(params, []);
  }
});

// The persons `defaultFilters` public floor (S3). The name-fold private arm (tier V) is browseable
// only when a caller opts in via the ?sector control; an omitted or EMPTY tier filter must yield
// the public floor (tier='P'), never leak the private arm.
const persons = REGISTRY.persons;

test("persons defaults to the public floor when tier is omitted", () => {
  const { whereSql, params } = buildWhere(persons, {});
  assert.match(whereSql, /tier IN \(\$\d+\)/);
  assert.ok(params.includes("P"));
});

test("an explicit tier filter overrides the public floor", () => {
  const { whereSql, params } = buildWhere(persons, {
    filters: { columns: [{ id: "tier", value: ["V"] }] },
  });
  assert.match(whereSql, /tier IN \(\$\d+\)/);
  assert.ok(params.includes("V") && !params.includes("P"));
});

test("tier=[P,V] expresses the 'all' population", () => {
  const { params } = buildWhere(persons, {
    filters: { columns: [{ id: "tier", value: ["P", "V"] }] },
  });
  assert.ok(params.includes("P") && params.includes("V"));
});

test("an EMPTY tier filter must NOT drop the public floor (presence != effect)", () => {
  const { whereSql, params } = buildWhere(persons, {
    filters: { columns: [{ id: "tier", value: [] }] },
  });
  assert.match(
    whereSql,
    /tier IN \(\$\d+\)/,
    "empty tier:[] suppressed the defaultFilter — a raw/malformed caller would see the private arm",
  );
  assert.ok(params.includes("P"));
});

// ---------------------------------------------------------------------------
// B3 — the two search arms added for the tender dossier
// (docs/plans/tender-dossier-ingest-v1.md, 147_tender_search_text.sql).

const tenders = REGISTRY.tenders;

test("unp is searchable at all — plan §13.7", () => {
  // Pasting a УНП returned total:0 on the live site while the tender existed and
  // its page rendered, because `unp` carried filter:"in" and no `search`.
  const { whereSql } = buildWhere(tenders, {
    filters: { global: "05947-2023-0042" },
  });
  assert.ok(whereSql.includes("unp LIKE"), "unp arm present");
});

test("unp searches by PREFIX, never a leading wildcard", () => {
  // `unp` has no trigram index; '%q%' is a 237k seq-scan, while 'q%' is a range
  // scan on idx_tenders_unp_pattern (measured 125 ms → 0.058 ms).
  const { whereSql, params } = buildWhere(tenders, {
    filters: { global: "05947-2023" },
  });
  assert.ok(whereSql.includes("unp LIKE"));
  assert.ok(params.includes("05947-2023%"), "anchored prefix param, not %…%");
  assert.ok(
    !params.includes("%05947-2023%"),
    "no leading-wildcard param for the unp arm",
  );
});

test("unp prefix escapes LIKE metacharacters", () => {
  // Unescaped, a query containing % matches everything through this arm.
  const { params } = buildWhere(tenders, { filters: { global: "50%_x" } });
  assert.ok(
    params.includes("50\\%\\_x%"),
    `expected escaped param, got ${JSON.stringify(params)}`,
  );
});

test("the dossier arm is an uncorrelated ARRAY subquery, NOT an EXISTS", () => {
  // ⚠️ THE performance property of this step, and it is invisible in a functional
  // test. A correlated EXISTS cannot join a BitmapOr, so it drags the whole tender
  // search onto a Seq Scan: measured for "кафе", 37 ms (baseline) → 6,617 ms
  // (EXISTS) → 21.5 ms (this form). The regression would hit every search, not
  // only ones the dossier can answer.
  const { whereSql } = buildWhere(tenders, { filters: { global: "кафе" } });
  assert.ok(
    whereSql.includes("unp = ANY(ARRAY(SELECT t_unp FROM tender_search_text"),
    `expected the InitPlan array form, got: ${whereSql}`,
  );
  assert.ok(
    !/EXISTS\s*\(\s*SELECT[^)]*tender_search_text/.test(whereSql),
    "must not be a correlated EXISTS",
  );
});

test("the dossier arm is FTS-only — no %> trigram fallback", () => {
  // word_similarity recomputes trigram sets over the whole body per row, and these
  // bodies are documents: 0.073 ms (FTS) vs 13,490 ms (%>) on 1,861 rows.
  const { whereSql } = buildWhere(tenders, { filters: { global: "кафе" } });
  const arm = whereSql.slice(whereSql.indexOf("tender_search_text"));
  assert.ok(arm.includes("fold_prefix_tsquery"), "FTS arm present");
  assert.ok(!arm.includes("%>"), "no trigram arm on the dossier body");
});

test("the dossier arm is bounded, so a stop-word cannot mint a giant array", () => {
  // „или" rather than „на": SEARCH_MIN_CHARS floors every trigram/FTS arm at three
  // characters, so a two-letter term now never reaches this arm at all. That does
  // NOT make the bound redundant — three-letter stop-words are just as common — so
  // the assertion stays and only the example moves above the floor. Do not restore a
  // two-character term here; it would assert against a predicate the engine refuses
  // to build, which passes for the wrong reason or not at all.
  const { whereSql } = buildWhere(tenders, { filters: { global: "или" } });
  assert.match(whereSql, /tender_search_text[\s\S]*LIMIT \d+\)\)/);
});

test("dossier_text is search-only: never selected, sorted, filtered or faceted", () => {
  // It is not a column of `tenders`. If it ever reached the projection, an ORDER BY
  // or a GROUP BY, every tenders query would fail with 42703.
  assert.ok(
    !tenders.select.includes("dossier_text"),
    "dossier_text must not be in the select list",
  );
  const def = tenders.columns.dossier_text;
  assert.ok(!def.sort, "no sort");
  assert.ok(!def.filter, "no filter");
  // `facet` is the one remaining key that would GROUP BY a column that isn't there.
  assert.ok(!def.facet && !def.facetExpr, "no facet");
  // …and it must not be viewOnly either, which would reroute aggregates to the view.
  assert.ok(!def.viewOnly);
});

test("globalCols can select the dossier arm alone", () => {
  const { whereSql } = buildWhere(tenders, {
    filters: { global: "кафе", globalCols: ["dossier_text"] },
  });
  assert.ok(whereSql.includes("tender_search_text"), "dossier arm kept");
  assert.ok(!whereSql.includes("buyer_fold"), "buyer arm dropped");
  assert.ok(!whereSql.includes("subject_fold"), "subject arm dropped");
});

test("the capped dossier subquery is ORDERed, so page and count truncate alike", () => {
  // The page query and the count query are built separately from this descriptor.
  // An unordered LIMIT can truncate to a different subset in each, producing a
  // total the rows do not add up to — wrong, not merely incomplete.
  // Above SEARCH_MIN_CHARS for the same reason as the bound test above.
  const { whereSql } = buildWhere(tenders, { filters: { global: "или" } });
  assert.match(whereSql, /ORDER BY t_unp LIMIT \d+\)\)/);
});

test("every searchInSet descriptor is well-formed", () => {
  // A typo in any of these interpolates straight into SQL as an identifier and
  // fails at query time, not at load time.
  for (const [name, r] of Object.entries(REGISTRY))
    for (const [id, d] of Object.entries(r.columns ?? {})) {
      if (!d.searchInSet) continue;
      for (const k of ["table", "key", "on", "col"])
        assert.match(
          d.searchInSet[k] ?? "",
          /^[a-z_][a-z0-9_]*$/,
          `${name}.${id}.searchInSet.${k} must be a bare identifier`,
        );
      assert.ok(d.search, `${name}.${id} needs search:true to ever be used`);
      // The outer key must be a real, selectable column of the base relation.
      assert.ok(
        r.columns[d.searchInSet.on],
        `${name}.${id}.searchInSet.on must name a column of ${name}`,
      );
      // Distinct inner/outer names — see 147's header: identical ones make the
      // correlated form a silent tautology.
      assert.notEqual(d.searchInSet.key, d.searchInSet.on);
    }
});

test("LIKE metacharacters are escaped on the pre-existing arms too", () => {
  // Measured before this: "50%_x" on tenders took 11,672 ms end to end — past the
  // 10 s statement_timeout — because `buyer_fold ILIKE '%50%_x%'` matched all
  // 237,321 rows. Any user can type it. Now 188 ms.
  const { whereSql, params } = buildWhere(tenders, {
    filters: { global: "50%_x" },
  });
  // The contiguous-substring arm's param escapes in JS. Note the BARE term is also
  // pushed, unescaped, and must stay that way: it feeds fold_prefix_tsquery() and
  // translit_bg_latin(), where a backslash is a literal character and not an escape.
  // tenders reaches LIKE only through the unp PREFIX arm.
  assert.ok(
    params.includes("50\\%\\_x%"),
    `expected an escaped prefix pattern, got ${JSON.stringify(params)}`,
  );
  assert.ok(!params.includes("50%_x%"), "unescaped prefix must not be sent");

  // contracts is the resource that still uses the plain `%q%` raw arm, which is the
  // one measured at 8,256 ms of the 11,672 ms total.
  const cp = buildWhere(contracts, { filters: { global: "50%_x" } }).params;
  assert.ok(
    cp.includes("%50\\%\\_x%"),
    `expected an escaped substring pattern, got ${JSON.stringify(cp)}`,
  );
  assert.ok(!cp.includes("%50%_x%"), "unescaped substring must not be sent");
  // …and the fold arm, whose text is produced server-side, escapes in SQL.
  assert.ok(
    whereSql.includes("replace(replace(replace("),
    "fold arm escapes translit output",
  );
});

test("a search still ORs the pre-existing arms — the dossier only ADDS hits", () => {
  // Safety property at 0.78% dossier coverage: a missing dossier row can fail to
  // add a hit, never suppress one buyer_name/subject already found.
  const { whereSql } = buildWhere(tenders, { filters: { global: "кафе" } });
  for (const arm of ["buyer_fold", "subject_fold", "tender_search_text"])
    assert.ok(whereSql.includes(arm), `${arm} arm present`);
  assert.ok(whereSql.includes(" OR "), "arms are ORed, not ANDed");
});
