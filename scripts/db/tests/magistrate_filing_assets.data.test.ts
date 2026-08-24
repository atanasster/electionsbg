// The per-filing property rows (185) — what may be believed about them.
//
// These rows are parsed out of PDFs, so the gate's job is not "did it parse" but "can a wrong
// parse be told from a right one". Three properties carry that:
//
//  1. ⚠️ THE TWO TABLES HAVE DIFFERENT COLUMN LAYOUTS. Таблица 1 runs
//     „… 7 цена | 8 година | 9 собственик | 10 идеална част | 11 основание | 12 произход";
//     Таблица 2 has no „произход" and no acquisition year, so every column after 7 sits one
//     place EARLIER. Reading table 2 with table 1's map silently puts the transferrer's name
//     in „идеална част" and the legal basis in „собственик". The loader keeps two maps; these
//     assertions are what notice if they are ever merged.
//  2. A REFUSED table stores no rows, and that is not the same as „nothing declared". The
//     pre-v3.0 form is refused wholesale (same twelve columns, different order), so a filing
//     with no rows must carry a refusal reason or genuinely have had none.
//  3. The reference filing. Сотир Цацаров's 2026 annual is the one document verified against
//     an independent source — BIRD reported the same four properties, the вила at 141 m² and
//     234,700 лв — so it is pinned here rather than described.
//
// Auto-skips when Postgres is down or the table is unloaded (its input is a ~3.5-hour operator
// crawl, absent on a fresh clone), like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM magistrate_filing_asset",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / magistrate_filing_asset empty (needs the operator crawl)";

afterAll(async () => {
  await end();
});

test("every property row belongs to a filing the roster publishes", async () => {
  if (skip) return;
  // The crawl covers 51,040 filings across 5,579 names; the published roster is 37,023 across
  // 3,594. A row whose filing is not in the roster is a parse about somebody no page can show.
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM magistrate_filing_asset a
      WHERE NOT EXISTS (SELECT 1 FROM magistrate_filing f
                         WHERE f.source_url = a.source_url
                           AND f.magistrate_name = a.magistrate_name)`,
  );
  assert.equal(Number(r.n), 0, "asset rows with no published filing");
});

test("the two tables keep their own column layouts", async () => {
  if (skip) return;
  // Таблица 2 has NO „година на придобиване" and NO „произход на средствата" — those columns
  // do not exist on it. A non-null there means table 2 was read with table 1's map, which also
  // means its holder, share and legal-basis cells are all one column out.
  const [t2] = await allRows<{ acquired: string; origin: string }>(
    `SELECT count(*) FILTER (WHERE acquired_year IS NOT NULL)::text AS acquired,
            count(*) FILTER (WHERE funds_origin IS NOT NULL)::text AS origin
       FROM magistrate_filing_asset WHERE table_num = '2'`,
  );
  assert.equal(
    Number(t2.acquired),
    0,
    "table 2 rows carrying an acquisition year",
  );
  assert.equal(Number(t2.origin), 0, "table 2 rows carrying a funds origin");

  // …plus the shift signature, which took three attempts to state correctly and is worth
  // recording as a warning about free-text columns.
  //
  // ⚠️ NOT a whitelist of share VALUES: „идеална част" is free text and declarants use it as
  // such — „по 1/2", „не", „1/2 и 1/2", „съпружеска имуществена общност", „целия имот",
  // „всеки по 1/2", „1/2 от 75/2344" are all real.
  // ⚠️ NOR "the share mentions a legal basis": „1/6 наследство и 5/6 покупка" is a magistrate
  // describing a mixed acquisition, and that row ALSO fills the basis column correctly.
  //
  // A shift is the CONJUNCTION: the share holds basis language *and* the basis column it
  // would have come from is empty. That is what the one real case looks like — and it is an
  // `exact = false` row, i.e. the fallback path already flagged it as unreliable, which is
  // why the assertion is scoped to rows claiming to be exact.
  const [bad] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM magistrate_filing_asset
      WHERE (acquired_year IS NOT NULL
             AND (acquired_year < 1900 OR acquired_year > 2100))
         OR (exact AND legal_basis IS NULL AND share IS NOT NULL
             AND share ~ '(покупко-продажба|дарение|наследство|замяна|делба)')`,
  );
  assert.equal(
    Number(bad.n),
    0,
    "an exact row whose share holds the (empty) legal-basis column",
  );
});

test("a price is a positive number or nothing at all", async () => {
  if (skip) return;
  // „Цена на сделката" is the cell a reader will quote. A zero is real and common (property
  // received under a marriage contract or a gift declares 0), so only a NEGATIVE price is
  // impossible — and would mean the parse picked up a different column.
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM magistrate_filing_asset WHERE price_lv < 0",
  );
  assert.equal(Number(r.n), 0, "negative declared prices");
});

test("ord is the form's own numbering, and never repeats within a table", async () => {
  if (skip) return;
  // GAPS ARE LEGITIMATE and an earlier version of this test asserted contiguity, which is
  // false: `ord` is the ordinal the FORM prints, and the form prints numbered but UNFILLED
  // slots that the reader skips. A filing whose table 1 holds only row 2 is a magistrate who
  // left the first slot blank. Keeping the printed number is deliberate — it is what lets a
  // reader match a stored row to the line on the page.
  //
  // What must never happen is a REPEAT, the signature of two tables merged into one:
  // measured before the parser stop condition was fixed, one filing returned Table 1 and
  // Table 1.1 together as ords 1,2,1,2 with the second table columns shifted.
  const [dup] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT source_url, table_num, ord FROM magistrate_filing_asset
        GROUP BY 1, 2, 3 HAVING count(*) > 1
     ) t`,
  );
  assert.equal(Number(dup.n), 0, "repeated ordinals within one table");

  // The form prints at most a couple of dozen slots; an ordinal far outside that range is a
  // number read out of some other column.
  const [range] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM magistrate_filing_asset WHERE ord < 1 OR ord > 60",
  );
  assert.equal(Number(range.n), 0, "ordinals outside the form range");
});

test("an unreadable table is recorded as refused, never as empty", async () => {
  if (skip) return;
  // ⚠️ THE DISTINCTION THIS WHOLE TABLE DEPENDS ON. „No rows" must mean the magistrate
  // declared nothing; „refused" must mean we could not read the document. Publishing the
  // second as the first asserts a named judge acquired no property in a year we never read.
  //
  // Every pre-v3.0 filing is refused wholesale, so the two populations are large and the
  // assertion is that they stay disjoint and correctly labelled.
  const [r] = await allRows<{
    refused_with_rows: string;
    old_form_unrefused: string;
  }>(
    `SELECT
       (SELECT count(*) FROM magistrate_filing f
         WHERE f.table1_refused IS NOT NULL
           AND EXISTS (SELECT 1 FROM magistrate_filing_asset a
                        WHERE a.source_url = f.source_url AND a.table_num = '1'))::text
         AS refused_with_rows,
       (SELECT count(*) FROM magistrate_filing
         WHERE form_version IS NOT NULL AND form_version <> '3.0'
           AND table1_refused IS DISTINCT FROM 'form-version')::text
         AS old_form_unrefused`,
  );
  assert.equal(
    Number(r.refused_with_rows),
    0,
    "a table marked refused nonetheless stored rows",
  );
  assert.equal(
    Number(r.old_form_unrefused),
    0,
    "a pre-v3.0 filing was not refused — its columns are ordered differently",
  );
});

test("the covered period is never silently the filing year", async () => {
  if (skip) return;
  // An ANNUAL filing covers the year BEFORE it was lodged. Equality on a meaningful number of
  // annuals would mean something had substituted `year` for the period the form prints —
  // which is the labelling defect this column exists to end.
  const [r] = await allRows<{ same: string; total: string }>(
    `SELECT count(*) FILTER (WHERE period_year = year)::text AS same,
            count(*) FILTER (WHERE period_year IS NOT NULL)::text AS total
       FROM magistrate_filing WHERE kind = 'annual'`,
  );
  if (Number(r.total) === 0) return; // crawl has not reached any annual yet
  const share = Number(r.same) / Number(r.total);
  assert.ok(
    share < 0.1,
    `${r.same}/${r.total} annual filings claim to cover their own filing year`,
  );
});

test("the reference filing still reads what an independent source reported", async () => {
  if (skip) return;
  // Сотир Цацаров's 2026 annual, the one document checked against BIRD's own reporting of the
  // same four acquisitions. If this drifts, the parser has changed its mind about a document
  // whose correct reading is published elsewhere.
  const rows = await allRows<{
    ord: number;
    kind_of_property: string;
    built_area: string;
    price_lv: string;
    acquired_year: number;
  }>(
    `SELECT ord, kind_of_property, built_area, price_lv::text, acquired_year
       FROM magistrate_filing_asset
      WHERE source_url LIKE '%SotirStefanovTzatzarov220420261452%'
        AND table_num = '1' ORDER BY ord`,
  );
  if (!rows.length) return; // the crawl has not reached this filing yet
  assert.equal(
    rows.length,
    4,
    "Цацаров's 2026 annual declares four properties",
  );
  const villa = rows[3];
  assert.equal(villa.kind_of_property, "вила");
  assert.equal(villa.built_area, "141");
  assert.equal(Number(villa.price_lv), 234700);
  assert.equal(villa.acquired_year, 2025);
  // The three 2025 acquisitions BIRD totalled at „над 453 хиляди лева".
  const total = rows.reduce((s, x) => s + Number(x.price_lv), 0);
  assert.ok(
    total > 452000 && total < 454000,
    `2025 acquisitions total ${total}, expected ~452,865`,
  );
});
