// Load magistrates-with-declared-companies + their informational financials
// (data/judiciary/magistrate_holdings.json, written by
// scripts/judiciary/__write_magistrate_holdings.ts) into Postgres (schema:
// 070_magistrates.sql). SERVING loader — never writes JSON back. The person /
// company / search / judiciary surfaces then query by name / eik instead of
// downloading the whole holdings + company-index + search JSON.
//
// Run: `npm run db:load:magistrates:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allRows,
  end,
  exec,
  refreshMatviewConcurrently,
  vacuumAfterReload,
  withClient,
} from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";
// Shared with the client hook (usePersonMagistrateHoldings) so the /person lookup key
// can never drift — see the module comment. tsx resolves the @/ alias in scripts.
import { normName } from "@/data/judiciary/normName";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/070_magistrates.sql");
// The magistrate→politician bridge function. Depends on 008 (company_politicians,
// officer_name_counts, tr_officers) — which db:refresh loads before magistrates — and
// on the tables 070 creates just above, so it is applied here after the schema.
const CONNECTIONS_FN = path.join(
  ROOT,
  "scripts/db/schema/pg/071_magistrate_connections.sql",
);
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const SRC = path.join(ROOT, "data/judiciary/magistrate_holdings.json");

interface Company {
  name: string;
  stakePct: number | null;
  eik: string | null;
  eikAmbiguous: boolean;
}
interface Financials {
  bankCashLv: number;
  securitiesLv: number;
  realEstateCount: number;
}
/** One declaration the register lists under this NAME — NOT one we have parsed, and not
 *  necessarily one this person filed (see `Magistrate.filingsNameAmbiguous`). */
interface Filing {
  year: number;
  /** The register's DIRECTORY, not the declaration type — see 070's column comment. */
  registerDir: string;
  ref: string;
  sourceUrl: string;
}

interface Magistrate {
  name: string;
  /** Year of the filing this record was parsed from. The roster spans years (a magistrate
   *  who left the bench keeps their last filing), so the file-level `year` — the register's
   *  latest — is not a truthful stand-in. Optional: older artifacts predate the field. */
  declYear?: number;
  /** The document the figures were parsed from. Optional: older artifacts predate it. */
  sourceUrl?: string;
  position: string | null;
  court: string | null;
  companies: Company[];
  financials?: Financials;
  /** Every declaration the register lists under this NAME, newest first. Optional for the
   *  same reason — an artifact written before 2026-08-24 carries none, and the loader must
   *  degrade to an empty history rather than throwing on a stale checkout. */
  filings?: Filing[];
  /** Whether this NAME provably covers more than one human, so `filings` is a name's
   *  history rather than a person's — see 070's column comment. Optional for the same
   *  reason as `filings`; absent means the artifact predates the check, and `false` is the
   *  safe default only because the history it qualifies is absent too. */
  filingsNameAmbiguous?: boolean;
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));
  // Best-effort: the bridge function needs the connections tables (008). In a full
  // db:refresh they exist; on a bare magistrate-only load they may not, so don't let
  // a missing dependency abort the data load — the route degrades to empty.
  try {
    await exec(readFileSync(CONNECTIONS_FN, "utf8"));
    // company_officer_counts is created empty by 071; populate it from the freshly
    // loaded tr_officers so the bridge's hub-company guard has current counts.
    //
    // CONCURRENTLY once populated, matching load_tr_pg — this matview is READ on a serving
    // path (magistrate_politician_links() in 071, and 099), so a plain REFRESH blocks those
    // readers for its whole duration. It was a plain REFRESH here while the other loader
    // refreshed the same object concurrently: same matview, same readers, two answers.
    // The first-ever run still pays the blocking form, because 071 creates it WITH NO DATA
    // and CONCURRENTLY raises 55000 on an unpopulated matview.
    await refreshMatviewConcurrently("company_officer_counts");
  } catch (e) {
    console.warn(
      `magistrate: skipped 071 bridge fn (connections tables not present yet): ${
        (e as Error).message
      }`,
    );
  }

  const file = JSON.parse(readFileSync(SRC, "utf8")) as {
    year: number;
    stats: { magistratesScanned: number };
    magistrates: Magistrate[];
  };
  const ms = file.magistrates;

  // Collected during the COPY generators (which cannot log usefully mid-stream) and
  // reported after the commit. Both are silent data loss otherwise: rows the artifact
  // carried and the table does not.
  const duplicateFilings: string[] = [];
  const malformedFilings: string[] = [];

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE magistrate CASCADE");
    await copyRows(
      client,
      "magistrate",
      [
        "name",
        "name_norm",
        "position",
        "court",
        "decl_year",
        "company_count",
        "bank_cash_lv",
        "securities_lv",
        "real_estate_count",
        "source_url",
        "filings_name_ambiguous",
      ],
      (function* () {
        for (const m of ms)
          yield [
            m.name,
            normName(m.name),
            m.position,
            m.court,
            m.declYear ?? file.year,
            m.companies.length,
            m.financials?.bankCashLv ?? null,
            m.financials?.securitiesLv ?? null,
            m.financials?.realEstateCount ?? null,
            m.sourceUrl ?? null,
            m.filingsNameAmbiguous ?? false,
          ];
      })(),
    );
    await copyRows(
      client,
      "magistrate_company",
      ["magistrate_name", "name", "stake_pct", "eik", "eik_ambiguous", "ord"],
      (function* () {
        for (const m of ms)
          for (let i = 0; i < m.companies.length; i++) {
            const c = m.companies[i];
            yield [m.name, c.name, c.stakePct, c.eik, c.eikAmbiguous, i];
          }
      })(),
    );
    // The filing history. TRUNCATE magistrate CASCADE above already emptied this table.
    //
    // De-duplicated on (name, sourceUrl), which is the table's PK: a magistrate re-spelled
    // by the register has their history folded across spellings by the writer, and although
    // the index is deduped on pdf path, folding is exactly the operation that could bring
    // the same document in twice. COPY does not enforce the PK mid-stream, so a duplicate
    // would abort the whole load at COMMIT with a constraint violation naming a URL rather
    // than a cause.
    await copyRows(
      client,
      "magistrate_filing",
      ["magistrate_name", "year", "register_dir", "ref", "source_url", "ord"],
      (function* () {
        for (const m of ms) {
          const seen = new Set<string>();
          let ord = 0;
          for (const f of m.filings ?? []) {
            // Every NOT NULL column is defended, not just `ref`. copyRows renders
            // `undefined` as \N, so ONE malformed filing raises 23502 and rolls back the
            // whole transaction — roster and companies with it — behind an error naming a
            // column rather than a cause. Skip the row and name the magistrate instead.
            if (
              f?.sourceUrl == null ||
              f.year == null ||
              f.registerDir == null
            ) {
              malformedFilings.push(`${m.name} (${f?.sourceUrl ?? "no url"})`);
              continue;
            }
            if (seen.has(f.sourceUrl)) {
              duplicateFilings.push(`${m.name} → ${f.sourceUrl}`);
              continue;
            }
            seen.add(f.sourceUrl);
            // `ref` is NOT NULL DEFAULT '' and '' MEANS „the register published no входящ
            // номер" (334 real cases). A missing field is a different thing — a writer
            // regression — so it is reported above rather than silently folded into ''.
            yield [
              m.name,
              f.year,
              f.registerDir,
              f.ref ?? "",
              f.sourceUrl,
              ord++,
            ];
          }
        }
      })(),
    );
    await recordIngestBatch(client, {
      source: "magistrate",
      table: "magistrate",
      keyExpr: "t.name",
      nameExpr: "t.name",
      detailExpr:
        "coalesce(t.court, '') || ' · ' || t.company_count || ' дружества'",
      amountExpr: "NULL::double precision",
      // rows_total carries the scanned corpus (3.1k) so the tile can show
      // "N of M scanned"; rows_new is the real magistrate delta.
      rowsTotal: file.stats.magistratesScanned,
    });
    await client.query("COMMIT");
  });

  // Count what was WRITTEN, not what the artifact offered — the two differ by whatever the
  // generators skipped, and reporting the artifact's number would hide exactly that.
  const filingsOffered = ms.reduce((s, m) => s + (m.filings?.length ?? 0), 0);
  const filingsLoaded =
    filingsOffered - duplicateFilings.length - malformedFilings.length;
  console.log(
    `magistrate: loaded ${ms.length} magistrates, ${ms.reduce(
      (s, m) => s + m.companies.length,
      0,
    )} companies, ${filingsLoaded} filings listed`,
  );
  for (const [label, rows] of [
    ["duplicate", duplicateFilings],
    ["malformed", malformedFilings],
  ] as const)
    if (rows.length)
      console.warn(
        `  ⚠️  ${rows.length} ${label} filing row(s) skipped:\n    ` +
          rows.slice(0, 5).join("\n    "),
      );

  // TRUNCATE + COPY inside one transaction mints a new relfilenode whose visibility map is
  // EMPTY, and every page is written by a transaction that has not committed — so nothing
  // can be marked all-visible and no index-only scan is plannable on these tables again.
  // The insert-threshold autovacuum that follows runs under a held-back xmin horizon, marks
  // nothing, resets its counter and never returns. Outside `withTx`, because VACUUM cannot
  // run in a transaction block.
  //
  // This loader had no such call at all: measured before adding it, `magistrate_company`
  // sat at 0% all-visible, and the other two were healthy only because autovacuum happened
  // to reach them. `magistrate_filing` is 37k rows read on the /person path, so it is the
  // one that would have cost something.
  await vacuumAfterReload(
    "magistrate",
    "magistrate_company",
    "magistrate_filing",
  );
  // An artifact predating the filing history loads cleanly and serves an empty list, which
  // is correct but silent — and the /person tile then shows no source link at all. Say so
  // rather than leaving the operator to notice a missing section.
  if (!filingsLoaded)
    console.warn(
      "  ⚠️  no filings in the artifact — rebuild it with " +
        "scripts/judiciary/__write_magistrate_holdings.ts, or the person page ships " +
        "without declaration links.",
    );

  // ⚠️ THIS RELOAD JUST BLANKED THE PROPERTY COUNT ON EVERY MAGISTRATE CARD, and nothing
  // else will say so. The TRUNCATE above clears magistrate.real_estate_count_parsed and the
  // magistrate_filing.kind metadata its derivation needs; only
  // db:load:magistrate-filing-assets:pg can refill them. The card renders no count rather
  // than falling back to the old heuristic — deliberate, since that heuristic fabricates
  // property — which makes the failure invisible unless it is announced here.
  //
  // ⚠️ THIS WARNING IS FOR THE STANDALONE AND CLOUD PATHS, NOT FOR db:refresh, and it used
  // to say the opposite ("that loader is a REFRESH_EXCLUSIONS member, so db:refresh does
  // NOT run it"). Since 2026-08-28 the chain runs the repair immediately after this loader
  // and refresh_coverage.test.ts's ORDER_PAIRS pins it there, so a full local refresh
  // self-heals. What still does NOT self-heal is every other way this loader runs: a
  // hand-run `npm run db:load:magistrates:pg`, and above all
  // `db:load:magistrates:pg:cloud`, which nothing follows automatically — that is the path
  // an ivss_declarations watcher flip takes, so the warning stays.
  // ⚠️ TWO STATEMENTS, NOT ONE GUARDED BY to_regclass. 185 is applied only by the asset
  // loader, so on a database that has never run the operator crawl the table does not exist —
  // and a `WHERE to_regclass(...) IS NOT NULL` guard does NOT save a query that names it,
  // because Postgres resolves every relation at PARSE time, before any predicate runs. The
  // guarded single-statement form raises 42P01 exactly where it is supposed to be safe.
  // (Measured on Cloud SQL: the reload itself committed and this threw afterwards, so the
  // loader exited non-zero on a successful load.)
  //
  // ⚠️ SECOND OCCURRENCE — load_grant_links_pg.ts's `relationExists` already documents this
  // exact trap, file-locally. Two loaders having learned it independently is the argument for
  // lifting that helper into scripts/db/lib/pg.ts; until someone does, this comment is what
  // stops a third.
  const [{ present }] = await allRows<{ present: boolean }>(
    "SELECT to_regclass('public.magistrate_filing_asset') IS NOT NULL AS present",
  );
  const assets = present
    ? (
        await allRows<{ assets: string }>(
          "SELECT count(*)::text AS assets FROM magistrate_filing_asset",
        )
      )[0].assets
    : "0";
  if (Number(assets) > 0)
    console.warn(
      `  ⚠️  ${assets} parsed property row(s) are still loaded, but this reload cleared the ` +
        `per-magistrate counts derived from them — every card now shows NO property count. ` +
        `Re-run: npm run db:load:magistrate-filing-assets:pg`,
    );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
