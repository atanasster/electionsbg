// Generates pg/189_culture_match_isun.sql, pg/190_culture_match_agri.sql and
// pg/191_culture_match_interreg.sql from src/lib/cultureMatch.ts.
//
//   npm run gen:culture-sql            # rewrite the migrations
//   npm run gen:culture-sql -- --check # exit 1 if any is stale
//
// WHY GENERATE THEM. `cultureMatch.ts` is the ONE definition of "does this
// free-text name belong to culture", and it is TypeScript. The /culture/funds
// detail pages page through the name- and theme-matched rows at request time,
// where a Cloud Function cannot import TS — so the rule needs a SQL form, and a
// hand-copied SQL form is the "computed in two places, so it will drift" case
// with a failure nobody can see: the KPI band and the table beneath it would
// count different populations and both would look right.
//
// ⚠️ WHY THREE FILES AND NOT ONE — this is the whole shape of the design.
// A view's query is resolved at CREATE time, and `exec()` sends a migration as
// ONE transaction, so a file spanning three corpora does not degrade on a
// database missing one of them: it raises 42P01 and creates NONE of the views.
// The first cut was monolithic and applied from `db:load:interreg:pg` on the
// premise that by then all three corpora exist. That premise is FALSE on a fresh
// clone: `raw_data/agri/` is gitignored, `load_agri_pg.ts` returns before
// `runAgriIngest`, and `runAgriIngest` is the only applier of 046 — so
// `agri_subsidies` never exists, and the unconditional apply aborted the whole
// db:refresh chain in its apply phase, taking the Interreg corpus and every
// later step with it.
//
// Split per corpus, each file is applied by the loader that OWNS its table, in
// the same run that created it, so the precondition holds by construction. There
// is no preflight, no cross-loader ordering rule, and a fresh clone without the
// agri cache simply has no ДФЗ view — which is the honest state, and what
// `culture_fund_sources.data.test.ts` skips on.
//
// WHY VIEWS AND NOT MATVIEWS — MEASURED, not assumed. Both name predicates are
// already served by existing trigram indexes, so there is nothing to precompute:
//
//   agri_subsidies  WHERE name ~* 'читалищ'          -- over 2,481,857 rows
//     Bitmap Index Scan on idx_agri_name_trgm → 264 rows, 370 buffers, 1.8 ms
//   fund_projects   WHERE beneficiary_name ~* '<culture pattern>'   -- over 82,162
//     Bitmap Index Scan on idx_fund_projects_bname → 1,560 rows, 1,525 buffers, 13.7 ms
//
// Both are far inside the per-view budget and far under the 10 s pool
// statement_timeout. A matview would add a refresh nobody triggers and a
// staleness nobody can see; a stored boolean column would need a backfill after
// every TRUNCATE+COPY reload and would go stale invisibly whenever the RULE moved
// without a corpus reload — the failure class CLAUDE.md documents for
// is_declared_holding, value_basis and held_scope. Re-measure before adding a term
// that could defeat the index; `culture_fund_sources.data.test.ts` holds buffer
// ceilings for exactly that.
//
// IT IS DELIBERATELY NOT NAMED `db:gen-*`. That prefix means "writes a committed
// artifact FROM POSTGRES and therefore belongs in db:refresh" —
// refresh_coverage.test.ts enumerates every such script. This one derives
// MIGRATIONS from TypeScript, runs when a human edits the rules, and would be
// meaningless inside a data reload. The gate that actually runs in CI is
// `culture_match.test.ts`'s byte-identity case (`--check` is the same assertion
// for a human at the terminal; no workflow invokes it). Same shape, and the same
// reasoning, as gen_sql/shlyo_query_fold.ts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cultureNameSql,
  chitalishteNameSql,
  interregThemeSql,
  lit,
} from "@/lib/cultureMatch";
import { CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SCHEMA_DIR = path.join(ROOT, "scripts/db/schema/pg");

export const FILES = {
  isun: "189_culture_match_isun.sql",
  agri: "190_culture_match_agri.sql",
  interreg: "191_culture_match_interreg.sql",
} as const;

export const outPath = (f: string): string => path.join(SCHEMA_DIR, f);

/**
 * The columns the /culture/funds/isun-* pages render.
 *
 * ⚠️ EXPLICIT, NEVER `SELECT *`. A star view records a `pg_depend` edge on every
 * column it expanded, which pins the WHOLE table: `ALTER TABLE fund_projects
 * ALTER COLUMN … TYPE` then fails outright (the 142 precedent — `numeric`
 * serialising as a string blanked every money cell, and the fix needed a retype),
 * and a column retirement fails too, aborting the funds loader in its apply phase
 * while the corpus keeps serving the previous vintage. The obvious workaround,
 * `ALTER TABLE … DROP COLUMN … CASCADE`, silently deletes these views at exit 0 —
 * and `migration_drop_dependents.data.test.ts` cannot see it, since its scanner
 * matches only `DROP TABLE|VIEW|MATERIALIZED VIEW`.
 *
 * A star view is also frozen against the DbDataTable column contract: its column
 * list is fixed at CREATE time, so a column added to the base table does not
 * appear until the migration is re-applied.
 */
const FUND_PROJECT_COLS = [
  "contract_number",
  "beneficiary_eik",
  "beneficiary_name",
  "program_code",
  "program_name",
  "title",
  "total_eur",
  "grant_eur",
  "own_cofinance_eur",
  "paid_eur",
  "duration_months",
  "status",
  "org_type",
  // ⚠️ ALIASED, and the alias is the point. Measured, the four culture arms carry
  // THREE incompatible oblast vocabularies under what was one column name: ИСУН
  // codes (S22, BGS), Interreg codes with a divergent Sofia (SOFIA_CITY beside
  // SFO), and ДФЗ Bulgarian NAMES („София (област)"). A facet over the bare name
  // therefore offered „S22" as a place to filter by on three of the four pages,
  // and a shared `?oblast=BGS` link matched nothing on the fourth — silently, at
  // a 200. Naming the column for the vocabulary it carries is the convention
  // db_table.js already sets with persons.oblast_code and companies.oblast_name.
  //
  // Deliberately NOT resolved to one vocabulary by joining place_dim: that table
  // is owned by db:load:place-dim:pg, and a view resolving against a relation
  // another loader owns is exactly the cross-corpus precondition this file was
  // split three ways to avoid.
  "oblast AS oblast_code",
] as const;

/** The columns /culture/funds/dfz renders. Same rule as above. */
const AGRI_COLS = [
  "id",
  "year",
  "eik",
  "name",
  // Bulgarian NAMES here, codes on the other three arms — see FUND_PROJECT_COLS.
  "oblast AS oblast_name",
  "scheme",
  "scheme_desc",
  // ⚠️ NOT `total_eur`. This is a ДФЗ farm SUBSIDY; on the two ИСУН arms
  // `total_eur` is a CONTRACT VALUE. The engine camelCases every column into the
  // payload and derives each aggregate key from it, so sharing the name shares
  // `row.totalEur` and `aggregates.sumTotalEur` — and a shared row renderer, CSV
  // export or tile keyed on that is the realistic route to the cross-arm addition
  // this whole design forbids. The Interreg arm already gets this right by
  // accident of vocabulary (`budget_eur`); this makes it deliberate everywhere.
  "total_eur AS subsidy_eur",
] as const;

const cols = (list: readonly string[]): string =>
  list.map((c) => `         ${c}`).join(",\n");

/** The register, wrapped so a 63-entry list stays readable in the emitted file. */
const eikArray = (): string => {
  const rows: string[] = [];
  const eiks = [...CULTURE_GROUP_EIKS];
  for (let i = 0; i < eiks.length; i += 6)
    rows.push(
      "    " +
        eiks
          .slice(i, i + 6)
          .map(lit)
          .join(", "),
    );
  return rows.join(",\n");
};

/**
 * ⚠️ WHY EACH FILE DROPS ITS OWN VIEW FIRST, when a DROP in a loader-applied
 * migration is normally the silent-data-loss shape (003_tr_search.sql deleted
 * three matviews on every TR load, exit 0).
 *
 * `CREATE OR REPLACE VIEW` can only APPEND columns — it refuses to rename or
 * reorder one ("cannot change name of view column"). These views deliberately
 * alias their columns (`oblast AS oblast_code`, `total_eur AS subsidy_eur`, a
 * synthetic `key`), so on any warm database a replace is rejected outright and
 * the migration fails.
 *
 * The DROP is safe here for three reasons that do NOT hold for 003's case, and a
 * future edit must keep all three: the target is a VIEW and carries no data; the
 * SAME file recreates it unconditionally a line later; and `exec()` sends the
 * file as ONE transaction, so the drop and the create commit together and no
 * reader ever observes the view missing. It is deliberately NOT `CASCADE` — if
 * something ever depends on one of these, the DROP must fail loudly (2BP01)
 * rather than delete the dependent at exit 0. `culture_match.test.ts` asserts
 * both halves, and `migration_drop_dependents.data.test.ts` covers the generic
 * rule repo-wide.
 */
const banner = (source: string, applier: string, body: string): string =>
  `-- GENERATED FILE — DO NOT EDIT.
-- Source: ${source}
-- Generator: scripts/db/gen_sql/culture_match.ts
-- Regenerate: npm run gen:culture-sql   ·   Verify: npm run gen:culture-sql -- --check
--
-- One of THREE files behind the /culture/funds source pages, split by corpus so
-- that each is applied by the loader that owns its table, in the same run that
-- created it. Applier: ${applier}.
--
-- ⚠️⚠️ THE FOUR VIEWS ACROSS THESE THREE FILES MAY NEVER BE SUMMED. They are one
-- ИСУН contract value reached by the register's EIKs, the same contract value
-- reached by a name rule (the two overlap heavily and NEITHER contains the other),
-- a ДФЗ farm SUBSIDY, and an Interreg partner's published BUDGET. No UNION of
-- them may be created, and no consumer may add two of their euro columns.
${body}`;

/** The GRANT, role-guarded in the 117/130 shape: roles are CLUSTER-wide, so a
 *  virgin pgdata volume has no app_readonly, and a bare GRANT raises 42704 —
 *  which, exec() sending a file as one transaction, would leave no views at all. */
const grant = (views: readonly string[]): string => `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON ${views.join(", ")} TO app_readonly;
  END IF;
END $$;
`;

export const buildSql = (): Record<string, string> => ({
  [FILES.isun]: banner(
    "src/lib/cultureMatch.ts + src/lib/kulturaReferenceData.ts",
    "scripts/db/load_funds_pg.ts (it owns fund_projects)",
    `
-- culture_isun_by_eik — reached by the sector register's EIKs. Reproducible, and
-- ALMOST but not quite a subset of the row below: measured 2026-08-25, 46 of its
-- 47 projects are also name-matched. See hub_stats' eikExactAlsoByName.
DROP VIEW IF EXISTS culture_isun_by_eik;
CREATE VIEW culture_isun_by_eik AS
  SELECT
${cols(FUND_PROJECT_COLS)}
    FROM fund_projects
   WHERE beneficiary_eik = ANY (ARRAY[
${eikArray()}
  ]);

-- culture_isun_by_name — a floor with a fuzzy edge; mostly народни читалища.
DROP VIEW IF EXISTS culture_isun_by_name;
CREATE VIEW culture_isun_by_name AS
  SELECT
${cols(FUND_PROJECT_COLS)}
    FROM fund_projects
   WHERE ${cultureNameSql("beneficiary_name")};
${grant(["culture_isun_by_eik", "culture_isun_by_name"])}`,
  ),

  [FILES.agri]: banner(
    "src/lib/cultureMatch.ts",
    "scripts/agri/ingest.ts (it owns agri_subsidies and applies 046)",
    `
-- culture_agri_chitalishta — a ДФЗ farm SUBSIDY, not a contract value. No state
-- cultural institution receives one: culture's presence in this corpus is народни
-- читалища, and it is reachable only by NAME (an EIK filter over the register
-- finds one music school on „Училищни схеми", €5,416 — see sectorPacks.ts).
DROP VIEW IF EXISTS culture_agri_chitalishta;
CREATE VIEW culture_agri_chitalishta AS
  SELECT
${cols(AGRI_COLS)}
    FROM agri_subsidies
   WHERE ${chitalishteNameSql("name")};
${grant(["culture_agri_chitalishta"])}`,
  ),

  [FILES.interreg]: banner(
    "src/lib/cultureMatch.ts",
    "scripts/db/load_interreg_pg.ts (it owns both interreg tables)",
    `
-- culture_interreg_thematic — a partner's published BUDGET, joined through the
-- OPERATION's THEME rather than through a beneficiary set. Those are different
-- questions, ~4.4x apart, and only this one is answerable for a corpus in which
-- ~18% of Bulgarian partner rows carry an EIK at all.
--
-- Projected explicitly rather than \`p.*, o.*\`: both tables carry keep_id, and a
-- star join would emit it twice and break the DbDataTable column contract — and,
-- as for the two ИСУН views, a star view pins every column it expanded against
-- ALTER TYPE and DROP COLUMN.
DROP VIEW IF EXISTS culture_interreg_thematic;
CREATE VIEW culture_interreg_thematic AS
  SELECT
         -- ⚠️ THE PAGING TIEBREAK, AND IT HAS TO BE SYNTHETIC. buildOrder uses
         -- the "key" column when a resource declares one and select[0]
         -- otherwise, and select[0] here would be keep_id — the OPERATION id,
         -- 144 distinct over 202 partner rows. Under the default budget sort
         -- that leaves rows in unordered tie groups, so a page turn can repeat
         -- or skip a partner. (keep_id, partner_seq) is unique 202/202, but the
         -- tiebreak is ONE column, so it is composed here rather than declared
         -- as a pair.
         p.keep_id || ':' || p.partner_seq AS key,
         p.keep_id,
         p.partner_seq,
         p.is_lead,
         p.country_department,
         p.partner_name,
         p.partner_name_en,
         p.eik,
         p.org_type,
         p.budget_eur,
         p.eu_funding_eur,
         p.budget_basis,
         p.ekatte,
         p.obshtina,
         -- A CODE, and its Sofia spelling diverges from the ИСУН arms' — see
         -- FUND_PROJECT_COLS. Named for the vocabulary it carries.
         p.oblast AS oblast_code,
         o.programme_code,
         o.period,
         o.title_en,
         o.title_bg,
         o.status,
         o.start_date,
         o.end_date
    FROM interreg_partners p
    JOIN interreg_operations o USING (keep_id)
   WHERE p.country = 'Bulgaria'
     AND ${interregThemeSql("o.title_en")};
${grant(["culture_interreg_thematic"])}`,
  ),
});

const run = (): void => {
  const files = buildSql();
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const [name, sql] of Object.entries(files)) {
    const p = outPath(name);
    const current = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (check) {
      if (current !== sql) stale.push(name);
      continue;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, sql);
  }
  if (check) {
    if (!stale.length) {
      console.log("culture_match: up to date");
      return;
    }
    console.error(
      `culture_match: ${stale.join(", ")} STALE — the rules in ` +
        `src/lib/cultureMatch.ts or the register in ` +
        `src/lib/kulturaReferenceData.ts have moved.\nRun: npm run gen:culture-sql`,
    );
    process.exit(1);
  }
  console.log(
    `culture_match: wrote ${Object.keys(files).join(", ")} ` +
      `(4 views, ${CULTURE_GROUP_EIKS.length} register EIKs)`,
  );
};

// Exact path, not a substring: `includes("culture_match")` also matches this
// module's own TEST file, so running that file directly under tsx would rewrite
// the migrations as a side effect of a test run.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  run();
