// Build person_search (schema: 126_person_search.sql) — the single ranked index behind the
// combined-search "person-search" route. Reads the DB only; fetches/parses nothing.
//
// NB: the TABLE person_search coexists with a same-named FUNCTION person_search(text,int) (082,
// backs the person-lookup route) — legal in PostgreSQL, kept distinct on purpose. See the note in
// 126_person_search.sql.
//
// TWO ARMS, in order (the second reads the first):
//   P — from person_browse_table (public/resolved persons). key 'slug:<slug>'.
//   V/N — from tr_officers (officers/owners, by folded name), LEFT JOIN the BROAD money set
//         (contracts ∪ agri_subsidies ∪ fund_beneficiaries). money>0 → 'V' else 'N'.
//         key 'fold:<name_fold>', ANTI-JOINED against the P-arm folds (NOT EXISTS) so a fold
//         already a public person is served by P alone.
//
// ORDER: run AFTER db:load:persons-browse:pg (the P arm reads person_browse_table) and after any
// reload of tr_officers / contracts / agri_subsidies / fund_beneficiaries (the V/N arm + broad
// money). db:refresh sequences it right after persons-browse.
//
// CLOUD STALENESS: it is a derived search index (like contractor_search) so it carries no
// recent_updates/changelog entry — BUT unlike contractor_search (rebuilt inside db:load:pg), this
// is a STANDALONE loader with nothing running it on Cloud SQL. So on the cloud side, run
// `npm run db:load:person-search:pg:cloud` after EACH of: db:load:persons-browse:pg:cloud,
// db:load:tr:pg:cloud, and any contracts/agri/funds reload — else prod search serves the previous
// vintage (the route degrades a MISSING table to empty, but a STALE table still 200s silently).
// Also documented in CLAUDE.md next to the other person-layer "nothing runs it on the cloud side"
// loaders.
//
// Run: `npm run db:load:person-search:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, execEach, allRows, withTx, end } from "./lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/126_person_search.sql");

// position_type CODE from person_browse_table.primary_facet. The five governance facets keep
// their code; company/concession collapse to private_sector; every other facet (ngo/donor/ds/
// sanctions/…) keeps its own code and is still 'public' for the ?sector toggle. Kept as ONE SQL
// CASE (no cross-migration function) so S1 does not depend on S3's 120 helper.
const POSITION_TYPE_SQL = `CASE WHEN primary_facet IN ('company','concession')
                               THEN 'private_sector' ELSE primary_facet END`;

const main = async (): Promise<void> => {
  // Idempotent DDL (CREATE TABLE / INDEX IF NOT EXISTS): statement-by-statement so no lock is
  // held across the file (execEach), matching the other search-index loaders.
  await execEach(readFileSync(SCHEMA, "utf8"));

  await withTx(async (c) => {
    await c.query("SELECT similarity('', '')"); // pg_trgm preload (as exec does)
    await c.query("TRUNCATE person_search");

    // P arm — public/resolved persons.
    await c.query(
      `INSERT INTO person_search
         (key, name, tier, position_type, primary_role, party, place_label, top_eik,
          firms_count, public_money_eur, has_photo, identity_confidence, href, rank_static)
       SELECT 'slug:' || slug,
              name,
              'P',
              ${POSITION_TYPE_SQL},
              primary_role,
              party_primary,
              place_label,
              NULL,
              coalesce(companies_n, 0),
              coalesce(public_money_eur, 0),
              photo_url IS NOT NULL,
              'resolved',
              '/person/' || slug,
              1000 + prominence + ln(1 + greatest(0, coalesce(public_money_eur, 0)))
         FROM person_browse_table
        -- tier='P' ONLY: since S3, person_browse_table UNIONs a name-fold private arm (tier V).
        -- Those are person_search's OWN V/N territory (built below from tr_officers) — reading
        -- them here would double them into the P tier AND steal their folds from the V/N arm.
        WHERE tier = 'P'`,
    );

    // V/N arm — TR owners by folded name, with BROAD public money, anti-joined against P folds.
    await c.query(
      `INSERT INTO person_search
         (key, name, tier, position_type, primary_role, party, place_label, top_eik,
          firms_count, public_money_eur, has_photo, identity_confidence, href, rank_static)
       WITH money_eik AS (
         SELECT eik, sum(eur) AS eur FROM (
           SELECT contractor_eik AS eik, amount_eur AS eur
             FROM contracts
            WHERE contractor_eik <> '' AND tag = 'contract'
              AND consortium_role IS DISTINCT FROM 'member'  -- same basis as person_browse (120)
           UNION ALL SELECT eik, total_eur FROM agri_subsidies     WHERE eik IS NOT NULL
           UNION ALL SELECT eik, paid_eur  FROM fund_beneficiaries WHERE eik IS NOT NULL
         ) x WHERE eur IS NOT NULL GROUP BY eik
       ),
       owner_company AS (
         SELECT o.name_fold, o.uic,
                min(o.name)                 AS name,
                max(coalesce(m.eur, 0))     AS eur
           FROM tr_officers o
           LEFT JOIN money_eik m ON m.eik = o.uic
          GROUP BY o.name_fold, o.uic
       ),
       owner AS (
         SELECT name_fold,
                min(name)                                          AS name,
                count(*)                                           AS firms,
                sum(eur)                                           AS money,
                (array_agg(uic ORDER BY eur DESC NULLS LAST))[1]   AS top_eik
           FROM owner_company
          GROUP BY name_fold
       )
       SELECT 'fold:' || o.name_fold,
              o.name,
              CASE WHEN o.money > 0 THEN 'V' ELSE 'N' END,
              'private_sector',
              NULL, NULL, NULL,
              o.top_eik,
              o.firms,
              coalesce(o.money, 0),
              false,
              'name_fold',
              '/person/' || o.name,
              (CASE WHEN o.money > 0 THEN 500 ELSE 100 END) + ln(1 + greatest(0, coalesce(o.money, 0)))
         FROM owner o
        WHERE NOT EXISTS (
                SELECT 1 FROM person_search p
                 WHERE p.tier = 'P' AND p.name_fold = o.name_fold)`,
    );
  });

  // Fresh table has no stats; the fuzzy route picks bad plans otherwise.
  await exec("ANALYZE person_search");

  const [stats] = await allRows<{
    total: string;
    p: string;
    v: string;
    n: string;
  }>(
    `SELECT count(*)                          AS total,
            count(*) FILTER (WHERE tier='P')  AS p,
            count(*) FILTER (WHERE tier='V')  AS v,
            count(*) FILTER (WHERE tier='N')  AS n
       FROM person_search`,
  );
  console.log(
    `person_search: ${stats.total} rows (P ${stats.p} public, ` +
      `V ${stats.v} money-linked, N ${stats.n} other owners)`,
  );
};

// Guarded so a test can import without the loader firing against DATABASE_URL.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(end);
}
