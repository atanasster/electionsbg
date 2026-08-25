// The generated migration is in sync with the rules it is generated from.
//
// Without this, editing `src/lib/cultureMatch.ts` (or the register in
// `kulturaReferenceData.ts`) and forgetting to regenerate leaves the four serving
// views on the OLD rule while `hub_stats.json`, every loader and every data test
// use the new one — which is the exact "computed in two places" failure the
// generator exists to prevent, arrived at one step later. Nothing else reports
// it: both sides compile, both return rows, and only the population differs.
//
// Hermetic — no Postgres. `culture_fund_sources.data.test.ts` is what checks the
// views against the corpus.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { readFileSync as read } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSql, FILES, outPath } from "./culture_match";
import {
  CULTURE_NAME_INCLUDE,
  CULTURE_NAME_EXCLUDE,
  INTERREG_CULTURE_THEME_INCLUDE,
  CHITALISHTE_NAME_INCLUDE,
} from "@/lib/cultureMatch";
import { CULTURE_GROUP_EIKS } from "@/lib/kulturaReferenceData";

/** The emitted file with its `--` comment lines removed.
 *
 *  ⚠️ Load-bearing, and the same rule `scripts/lib/strip_comments.ts` exists for
 *  one language over: PROSE THAT MENTIONS A PATTERN IS NOT AN OCCURRENCE OF IT.
 *  This file's header says „No UNION of these views may be created" and „never
 *  DROPs", so a scan of the raw text finds both words and fails on its own
 *  documentation. Line-anchored, because the generated statements carry no
 *  trailing `--`. */
const stripSqlComments = (sql: string): string =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

/** Every emitted file's body, concatenated — the four views live across three
 *  migrations now, so an assertion about "the views" has to read all of them. */
const sqlBody = (): string =>
  Object.values(buildSql()).map(stripSqlComments).join("\n");

describe("189_culture_match.sql", () => {
  it("every emitted file is byte-identical to what the generator produces", () => {
    for (const [name, sql] of Object.entries(buildSql())) {
      const p = outPath(name);
      expect(
        existsSync(p),
        `${name} is missing — run npm run gen:culture-sql`,
      ).toBe(true);
      expect(readFileSync(p, "utf8"), `${name} is stale`).toBe(sql);
    }
  });

  it("splits the views across one file per corpus", () => {
    // ⚠️ THE SPLIT IS THE DESIGN, not tidiness. A view's query resolves at CREATE
    // time and exec() sends a file as ONE transaction, so a file spanning three
    // corpora raises 42P01 and creates NONE of its views on a database missing
    // one. That is not hypothetical: the monolithic first cut aborted db:refresh
    // on every fresh clone, because raw_data/agri/ is gitignored and
    // `agri_subsidies` therefore never exists there.
    const files = buildSql();
    expect(Object.keys(files).sort()).toEqual(
      [FILES.isun, FILES.agri, FILES.interreg].sort(),
    );
    const viewsIn = (f: string) =>
      (stripSqlComments(files[f]).match(/CREATE VIEW (\w+)/g) ?? []).map((m) =>
        m.replace("CREATE VIEW ", ""),
      );
    expect(viewsIn(FILES.isun)).toEqual([
      "culture_isun_by_eik",
      "culture_isun_by_name",
    ]);
    expect(viewsIn(FILES.agri)).toEqual(["culture_agri_chitalishta"]);
    expect(viewsIn(FILES.interreg)).toEqual(["culture_interreg_thematic"]);

    // No file may read a corpus its applier does not own — that is the whole
    // point of the split, and a `SELECT … FROM agri_subsidies` slipping into the
    // ИСУН file would restore the abort with nothing else changing.
    expect(stripSqlComments(files[FILES.isun])).not.toMatch(
      /\b(agri_subsidies|interreg_partners|interreg_operations)\b/,
    );
    expect(stripSqlComments(files[FILES.agri])).not.toMatch(
      /\b(fund_projects|interreg_partners)\b/,
    );
    expect(stripSqlComments(files[FILES.interreg])).not.toMatch(
      /\b(fund_projects|agri_subsidies)\b/,
    );
  });

  it("is shipped by a loader — a migration nothing applies goes stale silently", () => {
    // The "applied, never loaded" drift CLAUDE.md records for migration 144:
    // deleting an applier leaves a warm database serving the old views for ever,
    // and the data test only notices once the RULES change AND the corpus is
    // present. Each file must be named by the loader that owns its base table.
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const appliers: [string, string][] = [
      [FILES.isun, "scripts/db/load_funds_pg.ts"],
      [FILES.agri, "scripts/agri/ingest.ts"],
      [FILES.interreg, "scripts/db/load_interreg_pg.ts"],
    ];
    for (const [file, applier] of appliers)
      expect(
        read(path.join(root, applier), "utf8"),
        `${file} is applied by nothing — ${applier} no longer names it, so a ` +
          `rule change will never reach a database that is not rebuilt by hand`,
      ).toContain(file);
  });

  it("every file says it is generated, and names its source and its applier", () => {
    // A generated file that does not announce itself gets hand-edited once; and
    // one that does not name its applier cannot be checked against the loader.
    for (const [name, sql] of Object.entries(buildSql())) {
      expect(sql, name).toMatch(/GENERATED FILE — DO NOT EDIT/);
      expect(sql, name).toContain("src/lib/cultureMatch.ts");
      expect(sql, name).toContain("npm run gen:culture-sql");
      expect(sql, name).toMatch(/-- Applier: |Applier: /);
    }
    expect(buildSql()[FILES.isun]).toContain("src/lib/kulturaReferenceData.ts");
  });

  it("carries the include AND exclude half of every guarded predicate", () => {
    // The include half alone is the defect cultureMatch.ts's header documents at
    // length: unguarded, „култур" matches аквакултури and one grid operator's two
    // ИСУН rows outweigh the entire true sector. An emitter that dropped the
    // exclusions would still produce four working views.
    const sql = sqlBody();
    expect(sql).toContain(CULTURE_NAME_INCLUDE);
    expect(sql).toContain(CULTURE_NAME_EXCLUDE);
    expect(sql).toContain(INTERREG_CULTURE_THEME_INCLUDE);
    expect(sql).toContain(CHITALISHTE_NAME_INCLUDE);
  });

  it("carries every register EIK, and only as a quoted literal", () => {
    const sql = buildSql()[FILES.isun];
    for (const eik of CULTURE_GROUP_EIKS) expect(sql).toContain(`'${eik}'`);
    // The array is what makes the EIK view reproducible; a truncated one would
    // silently narrow the sector rather than fail.
    // Sliced out of the BODY: both view names appear in the header comment
    // first, so slicing the raw text lands between two prose mentions and finds
    // no EIKs at all — a green assertion over an empty string.
    const body = stripSqlComments(sql);
    const arraySection = body.slice(
      body.indexOf("VIEW culture_isun_by_eik"),
      body.indexOf("VIEW culture_isun_by_name"),
    );
    expect((arraySection.match(/'\d{9,13}'/g) ?? []).length).toBe(
      CULTURE_GROUP_EIKS.length,
    );
  });

  it("emits exactly the four views across the three files, and no UNION", () => {
    // §0's rule, in the one place a future edit would break it cheaply. The four
    // arms are a contract value, a contract value, a farm subsidy and a published
    // budget; a UNION here would put a summable relation one step from a page
    // whose whole thesis is that they do not sum.
    const sql = sqlBody();
    const views = sql.match(/CREATE VIEW (\w+)/g) ?? [];
    expect(views).toEqual([
      "CREATE VIEW culture_isun_by_eik",
      "CREATE VIEW culture_isun_by_name",
      "CREATE VIEW culture_agri_chitalishta",
      "CREATE VIEW culture_interreg_thematic",
    ]);
    expect(sql).not.toMatch(/\bUNION\b/i);
  });

  it("every DROP is a non-CASCADE view drop the same file recreates", () => {
    // ⚠️ A DROP in a loader-applied migration is normally the silent data-loss
    // shape 003_tr_search.sql shipped — three matviews deleted on every TR load,
    // exit 0. It is admissible here for three reasons that must ALL hold, and
    // this asserts each: the target is a VIEW (no data), the SAME file recreates
    // it, and there is no CASCADE, so a future dependent makes the drop fail
    // loudly (2BP01) instead of being deleted silently.
    //
    // It exists because `CREATE OR REPLACE VIEW` can only APPEND columns — it
    // refuses to rename one ("cannot change name of view column") — and these
    // views deliberately alias theirs (`oblast AS oblast_code`,
    // `total_eur AS subsidy_eur`, a synthetic `key`).
    for (const [name, raw] of Object.entries(buildSql())) {
      const sql = stripSqlComments(raw);
      const drops = [
        ...sql.matchAll(
          /DROP\s+(\w+)(?:\s+IF\s+EXISTS)?\s+([a-z0-9_]+)([^;]*);/gi,
        ),
      ];
      expect(drops.length, `${name} emits no DROP`).toBeGreaterThan(0);
      for (const [, kind, target, tail] of drops) {
        expect(kind.toUpperCase(), `${name}: only a VIEW may be dropped`).toBe(
          "VIEW",
        );
        expect(
          tail.toUpperCase().includes("CASCADE"),
          `${name}: DROP VIEW ${target} CASCADE would delete a dependent at exit 0`,
        ).toBe(false);
        expect(sql, `${name} drops ${target} without recreating it`).toMatch(
          new RegExp(`CREATE\\s+VIEW\\s+${target}\\b`),
        );
      }
    }
  });

  it("never emits a table, matview or index", () => {
    // A matview or a stored column would reintroduce the staleness the measured
    // EXPLAIN in the generator's header rules out.
    const sql = sqlBody();
    expect(sql).not.toMatch(/CREATE (TABLE|MATERIALIZED VIEW|INDEX)/i);
    expect(sql).not.toMatch(/ALTER TABLE|GENERATED ALWAYS AS/);
  });

  it("gives the Interreg view a composed, unique paging key", () => {
    // buildOrder appends ONE tiebreak. select[0] there would be keep_id — the
    // OPERATION id, 144 distinct over 202 partner rows — so a page turn repeats
    // or skips a partner. (keep_id, partner_seq) is unique, and the view has to
    // compose it because the tiebreak cannot be a pair.
    const sql = stripSqlComments(buildSql()[FILES.interreg]);
    expect(sql).toMatch(
      /p\.keep_id\s*\|\|\s*':'\s*\|\|\s*p\.partner_seq\s+AS\s+key/,
    );
  });

  it("names each oblast column for the vocabulary it carries", () => {
    // Three incompatible vocabularies across the arms — ИСУН codes, Interreg
    // codes with a divergent Sofia, ДФЗ Bulgarian names. Under one bare `oblast`
    // a facet offered „S22" as a place to filter by. Convention:
    // persons.oblast_code / companies.oblast_name.
    const files = buildSql();
    expect(stripSqlComments(files[FILES.isun])).toContain(
      "oblast AS oblast_code",
    );
    expect(stripSqlComments(files[FILES.interreg])).toContain(
      "p.oblast AS oblast_code",
    );
    expect(stripSqlComments(files[FILES.agri])).toContain(
      "oblast AS oblast_name",
    );
  });

  it("aliases the ДФЗ money away from the ИСУН arms' column name", () => {
    // The engine camelCases every column into the payload and derives each
    // aggregate key from it, so a shared `total_eur` hands a client one
    // `row.totalEur` over an ИСУН contract value and a ДФЗ farm subsidy — the
    // realistic route to the cross-arm addition this design forbids.
    expect(stripSqlComments(buildSql()[FILES.agri])).toContain(
      "total_eur AS subsidy_eur",
    );
  });

  it("guards its GRANT on the role existing", () => {
    // Roles are CLUSTER-wide, so a virgin pgdata volume has no app_readonly and a
    // bare GRANT raises 42704 — which, exec() sending the file as one
    // transaction, would leave no views at all.
    // Per file: each ships on its own, so each needs its own guard.
    for (const [name, sql] of Object.entries(buildSql())) {
      expect(sql, name).toMatch(/rolname = 'app_readonly'/);
      expect(
        sql.indexOf("GRANT SELECT"),
        `${name}: the GRANT is not inside the role check`,
      ).toBeGreaterThan(sql.indexOf("rolname = 'app_readonly'"));
    }
  });

  it("never emits `SELECT *` — a star view pins every column of its base table", () => {
    // A star view records a pg_depend edge on EVERY column it expanded, so
    // `ALTER TABLE … ALTER COLUMN … TYPE` then fails outright (the migration-142
    // precedent) and a column retirement aborts the owning loader in its apply
    // phase. The escape hatch, `ALTER TABLE … DROP COLUMN … CASCADE`, deletes
    // these views at exit 0 — and migration_drop_dependents.data.test.ts cannot
    // see it, since its scanner matches only DROP TABLE/VIEW/MATERIALIZED VIEW.
    expect(sqlBody()).not.toMatch(/SELECT\s+\*/i);
    expect(sqlBody()).not.toMatch(/\bp\.\*|\bo\.\*/);
  });

  it("warns against summing across the arms, in every file", () => {
    // The pages' whole thesis. Each file is read on its own, so the rule has to
    // be on each of them rather than only on the first.
    for (const [name, sql] of Object.entries(buildSql()))
      expect(sql, name).toMatch(/MAY NEVER BE SUMMED/);
  });

  it("escapes quotes in a pattern or an EIK", () => {
    // Nothing contains one today; this asserts a future rule cannot break out of
    // its literal and turn a rule edit into an injection into our own migration.
    const all = sqlBody();
    const body = all.slice(all.indexOf("CREATE VIEW"));
    expect((body.match(/'/g) ?? []).length % 2).toBe(0);
  });
});
