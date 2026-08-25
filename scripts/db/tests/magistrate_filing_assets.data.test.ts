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
  //
  // ⚠️ THE MAPPED SET IS ('3.0','4.0') AND MUST TRACK declarationTables.SUPPORTED_FORMS.
  // v4.0 is the euro reissue — the same 12 columns at the same positions, with „/лева/"
  // becoming „/евро/" — so it is mapped and therefore must NOT be refused. Everything else
  // (v2.0/2.1/2.2 and the versionless older forms) orders the same 12 columns differently
  // and stays refused. SQL cannot import the TS set, so a future version added there must be
  // added here too; until it is, this gate fails loudly rather than silently widening.
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
         WHERE form_version IS NOT NULL AND form_version NOT IN ('3.0', '4.0')
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

// ---------------------------------------------------------- the headline count's provenance --
// `magistrate.real_estate_count_parsed` is the structured reader's answer for a record's OWN
// filing, and it is the ONLY count any surface renders — the original heuristic is never a
// fallback for it, because it fabricates. See 070's column comment and
// docs/plans/magistrate-declaration-detail-v1.md, Finding 4.

test("the parsed count equals the table-1 rows of that record's own filing", async () => {
  if (skip) return;
  const [bad] = await allRows<{ name: string; stored: number; actual: string }>(
    `SELECT m.name, m.real_estate_count_parsed stored,
            (SELECT count(*) FROM magistrate_filing_asset a
              WHERE a.source_url = m.source_url AND a.table_num = '1')::text actual
       FROM magistrate m
      WHERE m.real_estate_count_parsed IS NOT NULL
        AND m.real_estate_count_parsed <> (
              SELECT count(*) FROM magistrate_filing_asset a
               WHERE a.source_url = m.source_url AND a.table_num = '1')
      LIMIT 1`,
  );
  assert.equal(
    bad,
    undefined,
    bad &&
      `${bad.name} carries ${bad.stored} but its own filing has ${bad.actual} table-1 row(s)`,
  );
});

test("a filing the reader has NOT read leaves the count NULL, never 0", async () => {
  if (skip) return;
  // ⚠️ The failure this exists to catch is silent and one-directional: writing 0 where the
  // answer is unknown publishes „this judge declared no property" about a document nobody has
  // read. It is reachable by deriving the column from magistrate_filing.table1_refused, which
  // is NULL both for „read, not refused" and for „never crawled".
  // ⚠️ `f.kind IS NULL` is the load-bearing arm and the one a first cut omitted. The loader
  // writes kind/form_version/table1_refused ONLY for filings it parsed, so an UNCRAWLED filing
  // has table1_refused = NULL — indistinguishable, on that column alone, from „read and not
  // refused". Without this arm the assertion is green under exactly the broken derivation the
  // comment above forbids: mutation-tested in a rolled-back transaction, the
  // table1_refused-driven version writes 6 fabricated zeros and still passes.
  const [leak] = await allRows<{ name: string; why: string }>(
    `SELECT m.name,
            CASE WHEN f.source_url IS NULL THEN 'not in the roster'
                 WHEN f.kind IS NULL THEN 'never crawled'
                 ELSE f.table1_refused END why
       FROM magistrate m
       LEFT JOIN magistrate_filing f
              ON f.source_url = m.source_url AND f.magistrate_name = m.name
      WHERE m.real_estate_count_parsed IS NOT NULL
        AND (f.source_url IS NULL OR f.kind IS NULL OR f.table1_refused IS NOT NULL)
      LIMIT 1`,
  );
  assert.equal(
    leak,
    undefined,
    leak && `${leak.name} has a parsed count but its filing was ${leak.why}`,
  );

  // …and the column must still DISCRIMINATE. An implementation that simply never writes it
  // passes the assertion above vacuously.
  const [{ filled }] = await allRows<{ filled: string }>(
    `SELECT count(*)::text filled FROM magistrate
      WHERE real_estate_count_parsed IS NOT NULL`,
  );
  const [{ readable }] = await allRows<{ readable: string }>(
    `SELECT count(DISTINCT f.magistrate_name)::text readable
       FROM magistrate_filing f JOIN magistrate m
         ON m.source_url = f.source_url AND m.name = f.magistrate_name
      WHERE f.table1_refused IS NULL AND f.form_version IS NOT NULL`,
  );
  if (Number(readable) > 0)
    assert.ok(
      Number(filled) >= Number(readable) * 0.9,
      `only ${filled} record(s) carry a parsed count against ${readable} readable filing(s) — ` +
        `the derivation has stopped running`,
    );
});

test("the parser does not fall behind a NEWER form the register has started issuing", async () => {
  if (skip) return;
  // ⚠️ THIS MEASURES THE FORWARD DIRECTION ONLY, AND THE DISTINCTION IS THE WHOLE POINT.
  // declarationTables.ts accepts v3.0 and refuses everything else, which covers two
  // completely different populations:
  //
  //   BACKWARD — v2.0/2.1/2.2 and the versionless older forms. Measured on the full corpus:
  //     18,021 + 3,364 versionless of 36,995. A known, STATIC backlog whose column order is
  //     different and deliberately unmapped (plan, Tier-2 validation). It shrinks in relevance
  //     every year and no magistrate's own record depends on it — every roster record's own
  //     filing is 2024-or-later.
  //   FORWARD — v4.0, which the ИВСС began issuing during 2026: 201 filings, 5.5% of that
  //     year. This one GROWS every filing season and lands on the most current declarations.
  //
  // An assertion over the COMBINED share is dominated by the backlog and says nothing about
  // the gap that matters — a first cut of this gate did exactly that and fired at 58.3% on a
  // corpus with no forward problem at all. So the bound is on the NEWEST year: if a majority
  // of the latest season is on a form we refuse, the register has migrated and we have not.
  // The fix when it fails is to MAP the new form, never to raise the threshold.
  const rows = await allRows<{ v: string; n: string }>(
    `SELECT COALESCE(form_version, '(none)') v, count(*)::text n
       FROM magistrate_filing
      WHERE kind IS NOT NULL
        AND year = (SELECT max(year) FROM magistrate_filing WHERE kind IS NOT NULL)
      GROUP BY 1`,
  );
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  if (total < 200) return; // too little of the latest season crawled to say anything

  // Newer than the supported version — a versionless or older form is the backlog, not this.
  const SUPPORTED = 3.0;
  const ahead = rows
    .filter((r) => r.v !== "(none)" && Number(r.v) > SUPPORTED)
    .reduce((s, r) => s + Number(r.n), 0);
  const pct = (100 * ahead) / total;
  assert.ok(
    pct < 50,
    `${ahead}/${total} (${pct.toFixed(1)}%) of the newest season's filings are on a form ` +
      `version NEWER than the supported v${SUPPORTED.toFixed(1)} — ` +
      `${rows.map((r) => `${r.v}:${r.n}`).join(" ")}. The register has moved on; map the ` +
      `new form (plan, Tier-2 validation) rather than loosening this bound.`,
  );
});

test("a corpus with property rows also carries the counts derived from them", async () => {
  if (skip) return;
  // ⚠️ THE HOLE THIS COVERS IS GUARANTEED, NOT HYPOTHETICAL. `db:load:magistrates:pg` is in
  // db:refresh and TRUNCATEs `magistrate` (and `magistrate_filing` with it), clearing both
  // real_estate_count_parsed and the `kind` metadata the derivation needs — while the loader
  // that refills them is a REFRESH_EXCLUSIONS member. So every full refresh blanks the
  // property count on every magistrate card until db:load:magistrate-filing-assets:pg is run
  // again. That direction is deliberate (absent beats fabricated), but it must not be
  // SILENT, and ORDER_PAIRS structurally cannot express it — the asset loader is not in the
  // chain, so there is no pair to declare.
  const [{ assets }] = await allRows<{ assets: string }>(
    "SELECT count(*)::text assets FROM magistrate_filing_asset",
  );
  if (Number(assets) === 0) return; // no crawl on this database — nothing to derive from
  const [{ counted }] = await allRows<{ counted: string }>(
    `SELECT count(*)::text counted FROM magistrate
      WHERE real_estate_count_parsed IS NOT NULL`,
  );
  assert.ok(
    Number(counted) > 0,
    `${assets} property row(s) are loaded but NO magistrate carries a parsed count — the ` +
      `roster was reloaded after the assets were. Re-run db:load:magistrate-filing-assets:pg.`,
  );
});

// ------------------------------------------------------------- the price's unit is READ --
// v4.0 is v3.0 re-denominated for Bulgaria's 2026-01-01 euro changeover: same 12 columns at
// the same positions, and „Цена на сделката /лева/" becomes „…/евро/". Both are current, in
// the SAME year, so the unit is a property of the document and of nothing else.

test("a stored price always knows what unit it is in", async () => {
  if (skip) return;
  // ⚠️ A unitless amount is worse than no amount: it renders under whichever unit a consumer
  // assumes, off by 1.95583 against a named judge, in a figure that looks entirely ordinary.
  // readTable refuses a document that states no unit, so every row the loader stores has one
  // — a NULL here means a corpus crawled before the unit was read, and the repair is
  // `npx tsx scripts/judiciary/crawl_declarations.ts --backfill-currency`.
  const [{ n }] = await allRows<{ n: string }>(
    `SELECT count(*)::text n FROM magistrate_filing_asset
      WHERE price_lv IS NOT NULL AND price_currency IS NULL`,
  );
  assert.equal(
    Number(n),
    0,
    `${n} stored price(s) carry no unit — re-read those filings with --backfill-currency`,
  );
});

test("the unit tracks the DOCUMENT, not the year — 2026 carries both", async () => {
  if (skip) return;
  // ⚠️ The trap is a year rule, and this is the measurement that kills it: 2026 holds v3.0
  // filings in лева beside v4.0 in евро. Anything keyed on the year restates thousands of
  // prices. Anything keyed on the version is right today and one reissue from being wrong.
  const rows = await allRows<{ v: string; cur: string; n: string }>(
    `SELECT f.form_version v, COALESCE(a.price_currency,'(none)') cur, count(*)::text n
       FROM magistrate_filing_asset a
       JOIN magistrate_filing f ON f.source_url = a.source_url
      WHERE a.price_lv IS NOT NULL
      GROUP BY 1, 2`,
  );
  if (!rows.length) return;
  // Each mapped version is internally consistent…
  for (const r of rows)
    assert.ok(
      (r.v === "3.0" && r.cur === "BGN") || (r.v === "4.0" && r.cur === "EUR"),
      `form v${r.v} stored ${r.n} price(s) as ${r.cur} — the map and the unit disagree`,
    );
  // …and the corpus really does contain both, so this gate is not passing vacuously on a
  // single-currency corpus that would hide a hard-coded unit.
  const eur = rows.filter((r) => r.cur === "EUR").length;
  const bgn = rows.filter((r) => r.cur === "BGN").length;
  if (eur > 0)
    assert.ok(
      bgn > 0,
      "only euro prices are stored — the лева arm is unexercised and could be broken",
    );
});
