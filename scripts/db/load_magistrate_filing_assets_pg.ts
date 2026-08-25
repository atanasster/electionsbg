// Load the per-FILING declaration parse (raw_data/judiciary/filing_cache.json, written by the
// operator-run scripts/judiciary/crawl_declarations.ts) into Postgres — schema 185.
//
// SERVING loader, never writes JSON back. It fills `magistrate_filing_asset` and stamps three
// facts onto `magistrate_filing` that are readable only from the document: the declaration
// KIND, the covered PERIOD, and the FORM VERSION.
//
// ⚠️ ITS INPUT IS GITIGNORED HOST STATE. `filing_cache.json` is the product of a ~3.5-hour
// crawl of a rate-limited public register, so on a fresh clone it is simply absent — this
// loader skips and warns rather than failing, exactly like the agri and dossier loaders whose
// inputs are also uncommitted caches. That is why it belongs in REFRESH_EXCLUSIONS and not in
// the db:refresh chain.
//
// ⚠️ IT ONLY EVER FILLS ROWS FOR FILINGS ALREADY IN `magistrate_filing`. The crawl covers all
// 51,040 filings across 5,579 names; the published roster is 3,594 magistrates and 37,023
// filings. The remainder are people the roster does not carry — a parse without a published
// subject — and inserting them would put rows in the corpus for magistrates no page can show
// and no gate counts. They are reported, not stored.
//
// Run: `npx tsx scripts/db/load_magistrate_filing_assets_pg.ts` (local)
//      `DATABASE_URL=…5434 npx tsx scripts/db/load_magistrate_filing_assets_pg.ts` (cloud)

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, exec, vacuumAfterReload, withClient } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  TABLE_COLUMNS,
  formEra,
  LEGACY_UNVERSIONED,
} from "../judiciary/declarationTables";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/185_magistrate_filing_assets.sql",
);
const SRC = path.join(ROOT, "raw_data/judiciary/filing_cache.json");

/** As emitted by crawl_declarations.ts. `cells` is keyed by the column number the FORM
 *  prints, so the indices below are the ones a person reading the page would use. */
interface DataRow {
  ord: number;
  cells: Record<string, string>;
  exact: boolean;
}
interface FilingRecord {
  pdf: string;
  name: string;
  year: number;
  registerDir: string;
  formVersion: string | null;
  /** Which 12-column layout the document uses; decides the map above. */
  formEra?: "legacy" | "modern" | null;
  /** The unit both price columns are denominated in, read from the document's own header.
   *  Null on a corpus crawled before the euro reissue was mapped. */
  priceCurrency?: "BGN" | "EUR" | null;
  kind: string;
  periodYear: number | null;
  table1: DataRow[] | { refused: string };
  table2: DataRow[] | { refused: string };
}

const REGISTER = "http://62.176.124.194";

/** A лв figure as printed: digits with optional spaces/commas as thousands marks. Anything
 *  else — a word, a range, a dash — is NULL rather than coerced, because a price is the one
 *  cell on these rows that a reader will quote. */
const money = (s: string | undefined): number | null => {
  if (!s) return null;
  // \u00a0 explicitly: the register prints thousands separators as NON-BREAKING spaces,
  // which \s does not match in every engine and which a literal in source is invisible in.
  const t = s.replace(/[\s\u00a0\u202f]/g, "").replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const year = (s: string | undefined): number | null => {
  const m = /^(19|20)\d\d$/.exec((s ?? "").trim());
  return m ? Number(m[0]) : null;
};
const txt = (s: string | undefined): string | null => {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
};

// The two tables' column numbers, as the form prints them. They are NOT the same, which is
// the whole reason they are written down here rather than assumed:
//   Таблица 1 (12 cols): 1 ном · 2 вид · 3 местонахождение · 4 община · 5 площ ·
//                        6 разгъната · 7 цена · 8 година · 9 собственик · 10 идеална част ·
//                        11 правно основание · 12 произход на средствата
//   Таблица 2 (10 cols): 1 ном · 2 вид · 3 местонахождение · 4 община · 5 площ ·
//                        6 разгъната · 7 цена · 8 прехвърлител · 9 идеална част ·
//                        10 правно основание   ← no „произход", and every column after 7
//                        sits one place earlier than in table 1.
// ⚠️ ONE DEFINITION, IMPORTED — the era maps live in declarationTables.ts beside the parser
// that verifies them against each document's own header labels. A private copy here would
// drift silently: every row still loads, just under the wrong headings.
const COLS = TABLE_COLUMNS;

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  if (!existsSync(SRC)) {
    console.warn(
      `magistrate-filing-assets: ${SRC} absent — schema applied, nothing loaded.\n` +
        `  Its input is a ~3.5-hour operator crawl: npx tsx scripts/judiciary/crawl_declarations.ts`,
    );
    await end();
    return;
  }

  const cache: Record<string, FilingRecord> = JSON.parse(
    readFileSync(SRC, "utf8"),
  );
  const records = Object.values(cache);

  // Only filings the published roster carries — see the header.
  //
  // ⚠️ THE ROSTER'S NAME WINS, NOT THE CRAWL'S. The two spell the same person differently:
  // the register's index writes „Ана Иванова Методиева Конялъ" where the roster writes
  // „Ана Иванова Методиева-Конялъ", one of the hyphen/space splits this repo's name fold
  // exists for. Storing the crawl's spelling breaks the (source_url, magistrate_name) join
  // every consumer makes against magistrate_filing — measured, 3 rows — and, worse, names a
  // judge one way on their property rows and another everywhere else. `source_url` is the
  // real key here and is unambiguous, so the name is simply read off the roster.
  const known = new Map(
    (
      await allRows<{ source_url: string; magistrate_name: string }>(
        "SELECT source_url, magistrate_name FROM magistrate_filing",
      )
    ).map((r) => [r.source_url, r.magistrate_name] as const),
  );
  const urlOf = (r: FilingRecord): string => `${REGISTER}${r.pdf}`;
  const usable = records.filter((r) => known.has(urlOf(r)));
  const orphans = records.length - usable.length;

  let assetRows = 0;
  let refusedT1 = 0;
  let emptyRows = 0;
  let noEra = 0;
  let unmerged = 0;
  const duplicateOrds: string[] = [];

  await withClient(async (client) => {
    await client.query("BEGIN");
    // TRUNCATE + reload: the parse is derived, so the cache is the whole truth and a merge
    // would only preserve rows a re-parse has decided are wrong.
    await client.query("TRUNCATE magistrate_filing_asset");
    await copyRows(
      client,
      "magistrate_filing_asset",
      [
        "source_url",
        "magistrate_name",
        "table_num",
        "ord",
        "kind_of_property",
        "location",
        "municipality",
        "area",
        "built_area",
        "price_lv",
        "price_currency",
        "acquired_year",
        "holder_name",
        "share",
        "legal_basis",
        "funds_origin",
        "exact",
      ],
      (function* () {
        for (const r of usable) {
          const url = urlOf(r);
          for (const [tableNum, rows] of [
            ["1", r.table1],
            ["2", r.table2],
          ] as const) {
            if (!Array.isArray(rows)) {
              if (tableNum === "1") refusedT1++;
              continue;
            }
            // ⚠️ THE ERA DECIDES THE COLUMN MAP, and getting it wrong is a SHIFTED row, not
            // a missing one — legacy puts година at 7 and цена at 10 where modern puts цена
            // at 7 and година at 8, so the price cell would hold a year and the year cell a
            // name.
            //
            // DERIVED, not read from the record: `formEra` is a pure function of the form
            // revision, so a stored copy is redundant and — worse — is absent on every record
            // crawled before the field existed. Depending on it would silently drop all
            // 19,781 modern filings the moment the legacy ones were re-parsed. What makes
            // deriving it SAFE is that the proof lives at parse time: readTable checks the
            // era's layout against the document's own header labels and REFUSES on
            // disagreement, so a record carrying rows at all has already been verified.
            const era = formEra(r.formVersion ?? LEGACY_UNVERSIONED);
            if (!era) {
              noEra++;
              continue;
            }
            const c = COLS[era][tableNum];
            // The PK is (source_url, table_num, ord) and COPY does not enforce it mid-stream,
            // so a duplicate ordinal aborts the WHOLE load at COMMIT behind a constraint name
            // rather than a cause. Post-fix the parser cannot emit one — a row bearing the
            // next table's caption is now a stop — but a hard crash is the wrong way to find
            // out that it can again, so they are dropped and REPORTED.
            const seenOrd = new Set<number>();
            for (const row of rows) {
              if (seenOrd.has(row.ord)) {
                duplicateOrds.push(`${url} table ${tableNum} ord ${row.ord}`);
                continue;
              }
              seenOrd.add(row.ord);
              // ⚠️ A ROW WITH NEITHER A PROPERTY TYPE NOR A PRICE IS NOT A DECLARED PROPERTY.
              // The form prints its own furniture inside the table body — „Нямам нищо за
              // деклариране", the next table's caption, a bare „:" — and a reader anchored on
              // ordinals can pick those up as rows. The parser's stop condition is the primary
              // defence; this is the one at the database boundary, because the alternative is
              // publishing a blank row against a named judge's name. Measured before both
              // fixes: 36 such rows across 2,457.
              // ⚠️ THE KIND OFTEN MERGES INTO THE ORDINAL CELL, and un-merging it is the
              // difference between storing this row and losing it. On a row whose run count
              // does not match the header (`exact === false`) each run is placed by NEAREST
              // column edge — and because the header digits are printed CENTRED, the kind's
              // text can sit closer to the ordinal's edge than to its own. Both then land in
              // column 1: „1. апартамент с прилежащи 1.734 % ид.ч.".
              //
              // Reversing it is safe SPECIFICALLY here and nowhere else: column 1's only
              // neighbour is column 2, so whatever follows the ordinal in that cell can only
              // be the kind. Measured across the corpus, 8,251 rows carrying real property
              // are recovered this way and 3 remain unmappable.
              //
              // The rest of the row stays as parsed — its price is already withheld by the
              // `exact` flag, which is the right treatment for a row whose columns merged.
              let kindCell = txt(row.cells[c.kind]);
              if (kindCell == null) {
                const merged = String(row.cells[1] ?? "")
                  .replace(/^\s*\d+\.\s*/, "")
                  .trim();
                if (txt(merged) != null) {
                  kindCell = merged;
                  unmerged++;
                }
              }
              const priceCell = money(row.cells[c.price]);
              if (kindCell == null && priceCell == null) {
                emptyRows++;
                continue;
              }
              assetRows++;
              yield [
                url,
                // The roster's spelling, never the crawl's — see `known` above.
                known.get(url) ?? r.name,
                tableNum,
                row.ord,
                kindCell,
                txt(row.cells[c.location]),
                txt(row.cells[c.muni]),
                txt(row.cells[c.area]),
                txt(row.cells[c.built]),
                priceCell,
                // ⚠️ The unit the DOCUMENT states, carried from the parse. Never derived here
                // from the year or the form version: 2026 carries v3.0 in лева and v4.0 in
                // евро side by side, so either would restate thousands of prices at 1.95583×.
                // A readable filing always has one — readTable refuses a unitless document —
                // so a null here means a corpus parsed before the column existed.
                priceCell == null ? null : (r.priceCurrency ?? null),
                c.acquired == null ? null : year(row.cells[c.acquired]),
                txt(row.cells[c.holder]),
                txt(row.cells[c.share]),
                txt(row.cells[c.basis]),
                c.origin == null ? null : txt(row.cells[c.origin]),
                row.exact,
              ];
            }
          }
        }
      })(),
    );

    // Stamp the three document-only facts onto the filing rows. An UPDATE rather than part of
    // the magistrate loader's COPY, because the two have different inputs and different
    // cadences: the roster reloads whenever the ИВСС publishes, this only after a crawl.
    await client.query(
      "CREATE TEMP TABLE _mf_meta (source_url text PRIMARY KEY, kind text, period_year int, form_version text, t1 text, t2 text) ON COMMIT DROP",
    );
    await copyRows(
      client,
      "_mf_meta",
      ["source_url", "kind", "period_year", "form_version", "t1", "t2"],
      (function* () {
        for (const r of usable)
          yield [
            urlOf(r),
            r.kind,
            r.periodYear,
            r.formVersion,
            Array.isArray(r.table1) ? null : r.table1.refused,
            Array.isArray(r.table2) ? null : r.table2.refused,
          ];
      })(),
    );
    await client.query(`
      UPDATE magistrate_filing f
         SET kind = m.kind, period_year = m.period_year,
             form_version = m.form_version,
             table1_refused = m.t1, table2_refused = m.t2
        FROM _mf_meta m WHERE m.source_url = f.source_url`);
    // The headline count on the magistrate tile, re-derived from the rows just stored.
    //
    // ⚠️ ONLY where THIS record's own filing was read and NOT refused. `magistrate.source_url`
    // is the provenance of every other figure on that record, so counting some other filing's
    // properties would put a number from one document beside money from another. And a
    // refused document must stay NULL rather than 0: a pre-v3.0 form yields no rows because
    // the parser declines to read it, not because the magistrate declared nothing.
    //
    // Everything else is reset to NULL first, so a record whose filing has since been refused
    // — or dropped from the roster — cannot keep a count derived from a corpus it left.
    await client.query(`UPDATE magistrate SET real_estate_count_parsed = NULL
                         WHERE real_estate_count_parsed IS NOT NULL`);
    // ⚠️ DRIVEN FROM `_mf_meta`, NOT from magistrate_filing.table1_refused. That column is
    // NULL for a filing this run READ without refusing it AND for a filing the crawl has
    // never reached — the loader only ever writes meta for filings it parsed. Keying on it
    // would therefore write `0` for every uncrawled filing, which is precisely the „no
    // property declared" claim about an unread document that the NULL/0 distinction exists
    // to prevent. `_mf_meta` holds exactly the filings parsed in this run.
    await client.query(`
      UPDATE magistrate m
         SET real_estate_count_parsed = (
               SELECT count(*) FROM magistrate_filing_asset a
                WHERE a.source_url = m.source_url AND a.table_num = '1')
        FROM _mf_meta mm
       WHERE mm.source_url = m.source_url
         AND mm.t1 IS NULL`);
    await client.query("COMMIT");
  });

  await vacuumAfterReload("magistrate_filing_asset", "magistrate_filing");

  // What the two counting methods say, so a shift in either is visible in the run's own
  // output rather than only on a page. See 070's real_estate_count_parsed comment.
  const [counts] = await allRows<{
    records: string;
    disagree: string;
    heuristic: string;
    parsed: string;
  }>(`SELECT count(*) records,
               count(*) FILTER (WHERE real_estate_count IS DISTINCT FROM real_estate_count_parsed) disagree,
               COALESCE(sum(real_estate_count), 0) heuristic,
               COALESCE(sum(real_estate_count_parsed), 0) parsed
          FROM magistrate WHERE real_estate_count_parsed IS NOT NULL`);
  if (counts && Number(counts.records) > 0)
    console.log(
      `  headline counts re-derived for ${counts.records} record(s): ` +
        `${counts.parsed} propert(ies) read vs ${counts.heuristic} by the old heuristic, ` +
        `${counts.disagree} record(s) differ`,
    );

  console.log(
    `magistrate-filing-assets: ${usable.length} filing(s) parsed, ` +
      `${assetRows} property row(s), ${refusedT1} table-1 refusal(s)` +
      (emptyRows ? `, ${emptyRows} empty row(s) dropped` : "") +
      (noEra ? `, ${noEra} table(s) on an unmapped form revision` : "") +
      (unmerged
        ? `, ${unmerged} kind(s) recovered from a merged ordinal cell`
        : ""),
  );
  if (duplicateOrds.length)
    console.warn(
      `  ⚠️  ${duplicateOrds.length} duplicate ordinal(s) dropped — the parser has started ` +
        `merging two tables again:\n    ` +
        duplicateOrds.slice(0, 5).join("\n    "),
    );
  if (orphans)
    console.log(
      `  ${orphans} crawled filing(s) belong to names the published roster does not carry — ` +
        `not stored (see the header).`,
    );
  // The crawl is long and resumable, so a PARTIAL cache is the normal mid-run state rather
  // than an error — say which it is, so „few rows" is never read as „few declarations".
  const covered = usable.length;
  if (covered < known.size)
    console.warn(
      `  ⚠️  ${covered}/${known.size} known filings are in the cache — the crawl is ` +
        `incomplete. Re-run it, then re-run this loader.`,
    );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
