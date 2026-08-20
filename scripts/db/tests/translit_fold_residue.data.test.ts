// Tier 3 (Postgres-native) — Cyrillic left behind in a Latin fold.
//
//   npm run test:data
//
// `translit_bg_latin()` is the ONE Cyrillic→Latin fold: it produces the stored
// `*_fold` columns on eleven tables AND folds the query on every search that reads
// them. That symmetry is what makes a hole in it invisible — both sides agree on the
// same wrong answer, so the search returns rows, just never THAT row. A term is
// unfindable by anyone typing its Latin form, and nothing errors.
//
// Two holes are known (docs/plans/search-fold-homoglyphs-v1.md):
//
//   A. ORDER. `unaccent` runs AFTER the Cyrillic→Latin `translate`, so anything it
//      folds INTO a Bulgarian letter re-enters the output as Cyrillic —
//      `translit_bg_latin('ё')` returns `е` (U+0435), not `e`.
//   B. COVERAGE. The mapping is the 30-letter Bulgarian alphabet, so Cyrillic
//      HOMOGLYPHS outside it pass straight through: `і`/`І` (U+0456/U+0406) is in
//      50,256 of 50,283 dossier folds, because ЦАИС's own notice template writes the
//      Roman numeral in „Раздел І:" with a Cyrillic І.
//
// This file is the generic gate for BOTH. It exists because the pre-existing
// `tender_search_text` residue check enumerated only the BULGARIAN ALPHABET, and `і`
// is not in it — so it reported ONE row against a defect touching essentially the
// whole dossier corpus, and no gate at all covered the other eleven columns.
//
// ⚠️ The fold column list is DERIVED from the catalog, never hand-listed. A
// hand-listed set is invisible to the next fold column somebody adds, which is the
// same allowlist shape that let `reload_visibility_map` fall behind its loaders
// twice. An undeclared column FAILS here rather than being skipped, so a new fold is
// a decision rather than an omission — and a declared column that no longer exists
// fails too, so a stale entry cannot sit here looking like coverage.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { BG_LETTERS, CYR_EXTRA, charClass } from "../lib/cyrillic";

const BG_CLASS = charClass(BG_LETTERS);
const EXTRA_CLASS = charClass(CYR_EXTRA);

/** What each fold column MEASURED on 2026-08-20, on the full local corpus. Both bounds
 *  below are DERIVED from this one number per column, so there is a single value to
 *  re-measure and no pair that can drift apart.
 *
 *  ⚠️ THE TWO ARMS ARE DELIBERATELY DIFFERENT SHAPES, and getting that wrong is what
 *  makes a gate like this get deleted rather than fixed:
 *
 *  - `bg` is an ABSOLUTE count. It is at most 1 anywhere, it is the worse defect
 *    (`unaccent` re-introducing a Bulgarian letter AFTER the transliteration ran), and
 *    it must reach 0 once the refold lands (plan T2). Absolute is right when the target
 *    is zero.
 *  - `extraPct` is a RATE, because these tables GROW. `tr_companies` / `tr_officers` /
 *    `tr_person_roles` are rebuilt by `tr:daily-refresh` — daily — and the dossier
 *    corpus covers 50,283 of 237,321 procedures, a 4.7× runway. An absolute ceiling
 *    equal to today's count turns the next ordinary ingest red with no regression,
 *    while the "may only be lowered" rule forbids the only green fix. That combination
 *    — a red gate, a rule against raising it, and a deploy to ship — is how a gate ends
 *    up deleted instead. A rate moves only when the fold's BEHAVIOUR does.
 *
 *  `extraFloor` suppresses the rate arm below a handful of rows, so a small table
 *  cannot trip on one row's worth of percentage noise. */
type Measured = { bg: number; extraPct: number; extraFloor: number };

const MEASURED: Record<string, Measured> = {
  "awarder_search.name_fold": { bg: 0, extraPct: 0.246, extraFloor: 5 },
  "contractor_search.name_fold": { bg: 0, extraPct: 0.039, extraFloor: 5 },
  // includes `hӧrmann gmbh` — a Cyrillic ӧ inside a German name
  "contracts.title_fold": { bg: 1, extraPct: 1.72, extraFloor: 0 },
  "person.name_fold": { bg: 0, extraPct: 0, extraFloor: 0 },
  "person_alias.alias_fold": { bg: 0, extraPct: 0, extraFloor: 0 },
  "person_search.name_fold": { bg: 0, extraPct: 0.007, extraFloor: 5 },
  "tenders.buyer_fold": { bg: 0, extraPct: 0.103, extraFloor: 5 },
  "tenders.subject_fold": { bg: 0, extraPct: 1.883, extraFloor: 0 },
  "tr_companies.name_fold": { bg: 0, extraPct: 0.016, extraFloor: 5 },
  "tr_officers.name_fold": { bg: 0, extraPct: 0.005, extraFloor: 5 },
  "tr_person_roles.name_fold": { bg: 0, extraPct: 0.003, extraFloor: 5 },
  // The only loader-written fold rather than a generated column, and the largest
  // affected surface: 50,256 of 50,283 rows carry the `і` homoglyph.
  "tender_search_text.fold": { bg: 1, extraPct: 99.946, extraFloor: 0 },
};

/** Headroom over the measured rate. Ordinary ingestion adds rows at roughly the rate
 *  already there, so 30% absorbs corpus churn while still catching a fold that started
 *  leaving MORE Cyrillic behind than it used to. */
const GROWTH_SLACK = 1.3;

/** How far UNDER its measurement a column may fall before the gate demands the number
 *  be re-measured downwards. This is what ENFORCES "may only be lowered" rather than
 *  asking politely in a comment: a refold takes a rate to ~0, which trips this, so the
 *  refold cannot land without someone recording the state it achieved. Half is loose
 *  enough that churn does not trip it and tight enough that a refold always does. */
const RATCHET = 0.5;

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  if (haveDb) await end();
});

type FoldColumn = { table: string; column: string; key: string };

/** Every STORED generated column whose expression calls the fold, plus the one
 *  loader-written fold. Derived, so a twelfth column cannot appear unnoticed.
 *
 *  `table` and `column` come back as SEPARATE fields rather than as one dotted string
 *  that the caller splits: an identifier may legally contain a dot, so the round trip
 *  is lossy and would silently address the wrong relation.
 *
 *  Three of the filters are load-bearing and none is obvious:
 *  - `relpersistence = 'p'` excludes the UNLOGGED `*_stage` twins the loaders create
 *    with `LIKE … INCLUDING GENERATED`, which inherit the generated expression and so
 *    match this query exactly. `load_pg.ts` drops them on its clean-exit path, so an
 *    aborted loader leaves one behind indefinitely — and the failure it caused here
 *    named the wrong fix ("add a CEILINGS entry" for a table nobody should keep).
 *  - `nspname = 'public'` excludes another session's `pg_temp` twins.
 *  - `attisdropped` / `attnum > 0` are ordinary pg_attribute hygiene: dropped columns
 *    keep their row, and system columns have negative attnums. */
const foldColumns = async (): Promise<FoldColumn[]> => {
  const rows = await allRows<{ table: string; column: string }>(
    `SELECT c.relname AS "table", a.attname AS "column"
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE a.attgenerated = 's'
        AND NOT a.attisdropped
        AND a.attnum > 0
        AND c.relpersistence = 'p'
        AND n.nspname = 'public'
        AND pg_get_expr(d.adbin, d.adrelid) LIKE '%translit_bg_latin%'
      UNION
     SELECT 'tender_search_text', 'fold'
      WHERE to_regclass('public.tender_search_text') IS NOT NULL
      ORDER BY 1, 2`,
  );
  return rows.map((r) => ({ ...r, key: `${r.table}.${r.column}` }));
};

// Resolved ONCE. Both tests below need the same list, and two catalog round trips for
// an answer that cannot change mid-run is just latency.
const FOLD_COLUMNS: FoldColumn[] = skip ? [] : await foldColumns();

test.skipIf(skip)(
  "the declared columns and the catalog's agree, in both directions",
  async () => {
    assert.ok(FOLD_COLUMNS.length > 0, "found no fold columns to check");
    const found = new Set(FOLD_COLUMNS.map((c) => c.key));
    const undeclared = [...found].filter((c) => !(c in MEASURED)).sort();
    const stale = Object.keys(MEASURED)
      .filter((c) => !found.has(c))
      .sort();
    assert.deepEqual(
      { undeclared, stale },
      { undeclared: [], stale: [] },
      `the fold-column list and this file's measurements have drifted.\n` +
        `  undeclared (folded by translit_bg_latin, unmeasured — nothing checks them): ${undeclared.join(", ") || "none"}\n` +
        `  stale (a measurement for a column that no longer exists — coverage that is not there): ${stale.join(", ") || "none"}`,
    );
  },
);

test.skipIf(skip)(
  "no fold column carries more Cyrillic than its measured ceiling",
  async () => {
    const over: string[] = [];
    const slack: string[] = [];
    const empty: string[] = [];
    for (const { table, column, key } of FOLD_COLUMNS) {
      // Identifiers are catalog-derived (never user input) and are quoted anyway —
      // an unquoted identifier breaks on any relation that needs quoting, which is a
      // latent crash rather than an injection.
      const [row] = await allRows<{ bg: string; extra: string; rows: string }>(
        `SELECT count(*) FILTER (WHERE "${column}" ~ $1)::text AS bg,
                count(*) FILTER (WHERE "${column}" ~ $2)::text AS extra,
                count(*)::text AS rows
           FROM "${table}"`,
        [BG_CLASS, EXTRA_CLASS],
      );
      const rows = Number(row.rows);
      const bg = Number(row.bg);
      const extra = Number(row.extra);
      // Not loaded on this checkout — a gitignored-input loader that never ran. Absent
      // is that loader's problem; an EMPTY table must not read as a clean fold, so it
      // is collected and reported below rather than counted as a pass.
      if (rows === 0) {
        empty.push(key);
        continue;
      }
      const measured = MEASURED[key];
      // Unreachable while the first test passes, but this loop must not depend on that
      // ordering: an undeclared column here would otherwise throw a bare TypeError that
      // says nothing about what is wrong.
      if (!measured) {
        over.push(`${key}: no measurement declared (see the previous test)`);
        continue;
      }
      const pct = (extra / rows) * 100;
      const ceilingPct = measured.extraPct * GROWTH_SLACK;
      if (bg > measured.bg)
        over.push(
          `${key}: ${bg} rows carry a plain Bulgarian letter (ceiling ${measured.bg})`,
        );
      if (pct > ceilingPct && extra > measured.extraFloor)
        over.push(
          `${key}: ${extra}/${rows} rows (${pct.toFixed(3)}%) carry a Cyrillic homoglyph ` +
            `(measured ${measured.extraPct}%, ceiling ${ceilingPct.toFixed(3)}%)`,
        );
      // The ratchet — this is what ENFORCES "may only be lowered". A column measuring
      // far under its recorded rate means the corpus got better (the refold ran) and
      // MEASURED is now describing a defect that is gone.
      if (measured.extraPct > 0 && pct < measured.extraPct * RATCHET)
        slack.push(
          `${key}: now ${pct.toFixed(3)}%, measured at ${measured.extraPct}% — re-measure it down`,
        );
      if (measured.bg > 0 && bg < measured.bg)
        slack.push(
          `${key}: bg residue is now ${bg}, measured at ${measured.bg} — re-measure it down`,
        );
    }
    assert.deepEqual(
      { over, slack },
      { over: [], slack: [] },
      `fold residue moved.\n` +
        (over.length
          ? `  OVER — Cyrillic survived the Latin fold beyond the ceiling, so these rows are\n` +
            `  unfindable by anyone typing Latin:\n    ${over.join("\n    ")}\n`
          : "") +
        (slack.length
          ? `  SLACK — the corpus improved and MEASURED did not. Re-measure, so the gate keeps\n` +
            `  defending the state we actually reached:\n    ${slack.join("\n    ")}\n`
          : "") +
        `See docs/plans/search-fold-homoglyphs-v1.md.` +
        (empty.length ? `\n(empty on this checkout: ${empty.join(", ")})` : ""),
    );
  },
);

// NON-VACUITY, per character. The previous version of this test asserted that one
// Bulgarian word matched BG_LETTERS and one homoglyph string matched CYR_EXTRA, which
// is far weaker than it reads: deleting `щ` from BG_LETTERS still matched „проекти"
// through its other letters, 13 of the 14 homoglyphs were never exercised at all, and
// the probe string matched BOTH classes so swapping the two parameters was invisible.
test.skipIf(skip)(
  "both character classes classify every letter correctly",
  async () => {
    const rows = await allRows<{
      ch: string;
      in_bg: boolean;
      in_extra: boolean;
    }>(
      `SELECT ch, ch ~ $1 AS in_bg, ch ~ $2 AS in_extra
       FROM unnest(string_to_array($3 || $4, NULL)) AS ch`,
      [BG_CLASS, EXTRA_CLASS, BG_LETTERS, CYR_EXTRA],
    );
    assert.equal(
      rows.length,
      BG_LETTERS.length + CYR_EXTRA.length,
      "the probe did not see every declared character",
    );
    const wrong = rows
      .filter((r) => {
        const isBg = BG_LETTERS.includes(r.ch);
        return r.in_bg !== isBg || r.in_extra === isBg;
      })
      .map((r) => r.ch);
    // Fails on a single dropped character in either class, on a character that ended up
    // in both, and on the two classes being passed in the wrong order.
    assert.deepEqual(
      wrong,
      [],
      `these characters are classified wrongly by BG_LETTERS/CYR_EXTRA: ${wrong.join(" ")}`,
    );
  },
);

// MUTATION CHECK. Everything above is a `<=` against a number measured from the same
// corpus it is asserting on, which is satisfiable by a counting expression that has
// quietly stopped counting. This runs the identical FILTER expressions over a literal
// table whose answers are known, so a broken class or a broken filter fails HERE, with
// a message that says which, instead of silently passing every column.
test.skipIf(skip)(
  "the counting expression itself still discriminates",
  async () => {
    const [row] = await allRows<{ bg: string; extra: string; rows: string }>(
      `SELECT count(*) FILTER (WHERE v ~ $1)::text AS bg,
            count(*) FILTER (WHERE v ~ $2)::text AS extra,
            count(*)::text AS rows
       FROM (VALUES ('proekti'), ('razdel іv'), ('proеkti'), ('hӧrmann gmbh')) t(v)`,
      [BG_CLASS, EXTRA_CLASS],
    );
    assert.equal(row.rows, "4");
    // 'proеkti' carries a Cyrillic е — hole A, the unaccent-after-translate one.
    assert.equal(row.bg, "1", "the Bulgarian-letter filter stopped counting");
    // 'razdel іv' (U+0456) and 'hӧrmann gmbh' (U+04E7) — hole B, both real corpus rows.
    assert.equal(row.extra, "2", "the homoglyph filter stopped counting");
  },
);

// THE DEFECT ITSELF, PINNED. `translit_bg_latin` is not idempotent today: `ё` folds to
// a Cyrillic `е`, and folding that result again yields the Latin `e` it should have
// produced the first time. That single property is the cheapest possible gate for hole
// A, and it is asserted here in its CURRENT (broken) state on purpose.
//
// It is not a claim that the behaviour is right — it is a tripwire on the coupling the
// plan's §4 is about. Fixing the function without rewriting the stored folds BREAKS
// searches that work today (a reader typing Cyrillic `І` currently matches the stored
// `і`; afterwards the query folds to `i` and the stored value has not moved yet), so
// the fix and the refold must land together. Whoever changes the function will fail
// this test and be sent to the plan, rather than shipping half of a two-part change.
test.skipIf(skip)(
  "translit_bg_latin is NOT YET idempotent — plan T1 flips this",
  async () => {
    const [row] = await allRows<{ once: string; twice: string }>(
      `SELECT translit_bg_latin('ё') AS once,
            translit_bg_latin(translit_bg_latin('ё')) AS twice`,
    );
    assert.equal(
      row.once,
      "е",
      "translit_bg_latin('ё') no longer returns a Cyrillic е — if hole A was fixed, the " +
        "stored folds must be rewritten in the same window (docs/plans/search-fold-homoglyphs-v1.md T2) " +
        "and this test replaced by a real idempotence assertion",
    );
    assert.equal(row.twice, "e", "the second fold no longer reaches Latin e");
  },
);
