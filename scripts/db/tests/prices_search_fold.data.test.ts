// Regression gate: /consumption/products' search box reaches Latin-typed spellings.
//
// THE BUG IT LOCKS OUT. `price_products.title` is Cyrillic, and until 048 grew `title_fold`
// the registry engine searched it RAW — so the page's primary control answered „Няма
// резултати" to every Latin-typed query, about a catalogue that holds the rows. Measured on
// the local corpus (46,682 browsable products) before the fold:
//
//     kafe      0 rows  ·  1,389 titles contain КАФЕ
//     mlyako    0       ·  2,366 contain МЛЯКО
//     sirene    0       ·  1,499
//     banani    0       ·     85
//     olio      6       ·    187   (the 6 were Latin-titled listings)
//
// ⚠️ THERE IS NO ERROR AND NO EMPTY-STATE DISTINCTION. „no such product" and „this search
// cannot see Cyrillic" render identically, at a 200, which is why nothing reported it for as
// long as it shipped.
//
// Requires DB_VERIFY=1 and a loaded local Postgres.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

afterAll(async () => {
  await end();
});

const RUN = process.env.DB_VERIFY === "1";

/** Terms that must be findable. Each is the spelling a Bulgarian actually types, and each
 *  returned ZERO before the fold. */
const LATIN_TERMS = ["kafe", "mlyako", "sirene", "banani"];
/** Shliokavitsa proper — the KEYBOARD substitutions `shlyo_query_fold` (141) owns. */
const SHLYO_TERMS = ["6okolad", "4erven"];

test.skipIf(!RUN)(
  "title_fold exists, is GENERATED, and is trigram-indexed",
  async () => {
    // ⚠️ GENERATED, not merely present. A hand-added plain `text` column would satisfy every
    // row-returning assertion below on the day it was filled and then silently stop tracking
    // `title` — every product added or re-titled afterwards unsearchable in Latin, with the
    // gate still green. The catalogue is rebuilt daily, so that drift starts immediately.
    const [col] = await allRows<{ generated: string }>(
      `SELECT is_generated AS generated
         FROM information_schema.columns
        WHERE table_name = 'price_products' AND column_name = 'title_fold'`,
    );
    assert.ok(
      col,
      "price_products.title_fold is missing — apply 048_prices.sql",
    );
    assert.equal(col.generated, "ALWAYS");

    // Without the index the arm is a seq scan of the whole catalogue on every keystroke's
    // count query. Measured with it: 1,076 buffers / 11 ms for „kafe", of which 9 are the
    // index scan itself.
    const idx = await allRows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'price_products'
          AND indexdef ILIKE '%gin%title_fold%'`,
    );
    assert.ok(idx.length > 0, "price_products_title_fold_trgm is missing");
  },
);

test.skipIf(!RUN)(
  "a Latin-typed term finds the Cyrillic titles — and the raw column could not",
  async () => {
    for (const term of LATIN_TERMS) {
      const [row] = await allRows<{ fold: number; raw: number }>(
        // ⚠️ A MUTATION CHECK, not just a threshold. The `raw` arm is the PREVIOUS
        // implementation, run side by side: asserting only „fold > 0" would pass on an
        // implementation that had quietly reverted to the raw column for any term that
        // happens to appear in a Latin-titled product. Requiring fold >> raw is what makes
        // the assertion about the FOLD rather than about the corpus.
        `SELECT count(*) FILTER (WHERE title_fold ILIKE '%' || translit_bg_latin($1) || '%') AS fold,
                count(*) FILTER (WHERE title      ILIKE '%' || $1 || '%')                    AS raw
           FROM price_products WHERE chain_count >= 1`,
        [term],
      );
      assert.ok(
        Number(row.fold) > 0,
        `"${term}" finds nothing through the fold`,
      );
      assert.ok(
        Number(row.fold) > Number(row.raw),
        `"${term}": the fold (${row.fold}) must beat the raw column (${row.raw})`,
      );
    }
  },
);

test.skipIf(!RUN)(
  "the Cyrillic spelling and its romanization return the SAME set",
  async () => {
    // The fold is not a second, looser search — it is ONE Latin space both sides meet in. If
    // these two ever disagree, a reader typing their own language gets a different answer from
    // one typing the keyboard they have, which is worse than either failing.
    const [row] = await allRows<{ cyr: number; lat: number }>(
      `SELECT count(*) FILTER (WHERE title_fold ILIKE '%' || translit_bg_latin('кафе') || '%') AS cyr,
              count(*) FILTER (WHERE title_fold ILIKE '%' || translit_bg_latin('kafe') || '%') AS lat
         FROM price_products WHERE chain_count >= 1`,
    );
    assert.equal(Number(row.cyr), Number(row.lat));
    assert.ok(Number(row.cyr) > 0);
  },
);

test.skipIf(!RUN)(
  "the shliokavitsa arm reaches what the plain fold cannot",
  async () => {
    // The keyboard half — „6" = ш, „4" = ч — which the plain romanization leaves alone,
    // because „6okolad" folds to itself. This is the arm the engine gates on
    // SHLYO_TRIGGER_RAW; the gate is what stops it firing on ordinary Cyrillic.
    for (const term of SHLYO_TERMS) {
      const [row] = await allRows<{ plain: number; shlyo: number }>(
        `SELECT count(*) FILTER (WHERE title_fold ILIKE '%' || translit_bg_latin($1) || '%') AS plain,
                count(*) FILTER (WHERE title_fold ILIKE '%' || shlyo_query_fold(translit_bg_latin($1)) || '%') AS shlyo
           FROM price_products WHERE chain_count >= 1`,
        [term],
      );
      assert.equal(
        Number(row.plain),
        0,
        `"${term}" should be unreachable without the shliokavitsa fold — if it is not, the ` +
          "term has stopped discriminating and this test is no longer testing anything",
      );
      assert.ok(
        Number(row.shlyo) > 0,
        `"${term}" finds nothing even through shlyo_query_fold — is 141 applied?`,
      );
    }
  },
);
