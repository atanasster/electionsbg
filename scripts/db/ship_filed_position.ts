/**
 * Ship `declaration.filed_institution` / `filed_position` from one database to another.
 *
 *   npx tsx scripts/db/ship_filed_position.ts                      # dry run, local -> cloud
 *   npx tsx scripts/db/ship_filed_position.ts --apply
 *   npx tsx scripts/db/ship_filed_position.ts --from <url> --to <url> --apply
 *
 * ── WHY SHIP RATHER THAN RE-CRAWL ───────────────────────────────────────────────────────
 *
 * The two columns are derived from each filing's own `<Personal><Work>` / `<Personal>
 * <Position>`, and a filing is immutable once published — so the values are identical
 * whichever database derives them. Re-running `backfill_filed_position.ts` against Cloud SQL
 * would spend ~5 hours re-fetching a rate-limited public register to recompute bytes we
 * already hold. Measured 2026-08-17: the local corpus took 54,071 fetches to fill.
 *
 * ── WHY NOT shipTable() ─────────────────────────────────────────────────────────────────
 *
 * `lib/shipTable.ts` is TRUNCATE + COPY of a whole table. `declaration` on the serving side
 * is not a derived cache: it carries `person_id`, resolved there by `db:resolve:persons`, and
 * truncating it would destroy that resolution and every join that depends on it. This ships
 * TWO COLUMNS into the rows that are already there.
 *
 * ── WHY THE KEY IS source_url ───────────────────────────────────────────────────────────
 *
 * `declaration_id` is a `bigserial` handed out in insertion order by `load_declarations_pg`,
 * so it is a property of how a database was loaded rather than of the filing. It happens to
 * agree across local and Cloud SQL today — verified 2026-08-17, the md5 of the whole ordered
 * (id, source_url) mapping matches on both — but nothing enforces that, and a partial or
 * re-ordered load would silently write every value onto the wrong filing.
 *
 * `source_url` is the register's own URL for the document and is declared `NOT NULL UNIQUE`
 * in 089. It is the only key here that means something outside one database.
 */

import { Pool } from "pg";
import { copyRows } from "./lib/copy";
import { LOCAL_DATABASE_URL, DATABASE_URL, redactUrl } from "./lib/pg";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (f: string): boolean => process.argv.includes(f);

/** Below this share of shipped rows matching a target row, refuse rather than write.
 *  A low match rate means the two corpora are not the same vintage, and a partial write
 *  would leave the target with some filings labelled from the filing and others from the
 *  listing bucket — the exact mixture that makes a column untrustworthy. */
const MIN_MATCH_SHARE = 0.95;

const main = async (): Promise<void> => {
  const fromUrl = arg("--from") ?? LOCAL_DATABASE_URL;
  const toUrl = arg("--to") ?? DATABASE_URL;
  const apply = has("--apply");
  if (fromUrl === toUrl)
    // DATABASE_URL falls back to the LOCAL url when unset, so an unset environment silently
    // aims this at the database it reads from. Name the fix rather than reporting a no-op.
    throw new Error(
      `--from and --to are the same database (${redactUrl(fromUrl)}) — nothing to ship.\n` +
        `  Point --to at the target, e.g. the Cloud SQL proxy from \`npm run db:proxy:cloud\`:\n` +
        `    npx tsx scripts/db/ship_filed_position.ts --to postgres://postgres@127.0.0.1:5434/electionsbg`,
    );

  console.log(`from: ${redactUrl(fromUrl)}`);
  console.log(`to:   ${redactUrl(toUrl)}${apply ? "" : "   (dry run)"}`);

  const src = new Pool({ connectionString: fromUrl, max: 1 });
  const dst = new Pool({ connectionString: toUrl, max: 1 });
  try {
    // Preflight the TARGET's schema. 089 is additive, but a target that never had it applied
    // would fail mid-COPY with 42703 and leave a stage table behind.
    const cols = await dst.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'declaration'
          AND column_name IN ('filed_institution', 'filed_position')`,
    );
    if (cols.rowCount !== 2)
      throw new Error(
        `target is missing declaration.filed_institution / filed_position — apply 089 first:\n` +
          `  DATABASE_URL=${redactUrl(toUrl)} npx tsx scripts/db/apply_functions.ts 089_declarations.sql`,
      );

    const rows = await src.query<{
      source_url: string;
      filed_institution: string | null;
      filed_position: string | null;
    }>(
      `SELECT source_url, filed_institution, filed_position
         FROM declaration
        WHERE filed_institution IS NOT NULL OR filed_position IS NOT NULL
        ORDER BY source_url`,
    );
    if (!rows.rowCount)
      throw new Error(
        "source has no filed_institution/filed_position at all — run " +
          "scripts/declarations/backfill_filed_position.ts there first",
      );
    console.log(`  ${rows.rowCount} row(s) carry an office in the source`);

    await withClientOn(dst, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          `CREATE TEMP TABLE ship_filed_position (
             source_url text PRIMARY KEY,
             filed_institution text,
             filed_position text
           ) ON COMMIT DROP`,
        );
        const sent = await copyRows(
          c,
          "ship_filed_position",
          ["source_url", "filed_institution", "filed_position"],
          rows.rows.map((r) => [
            r.source_url,
            r.filed_institution,
            r.filed_position,
          ]),
        );

        const [{ matched }] = (
          await c.query<{ matched: string }>(
            `SELECT count(*)::text AS matched
               FROM ship_filed_position s
               JOIN declaration d USING (source_url)`,
          )
        ).rows;
        const share = Number(matched) / sent;
        console.log(
          `  ${matched}/${sent} match a filing on the target (${(share * 100).toFixed(1)}%)`,
        );
        if (share < MIN_MATCH_SHARE)
          throw new Error(
            `only ${(share * 100).toFixed(1)}% of shipped rows match a target filing ` +
              `(floor ${(MIN_MATCH_SHARE * 100).toFixed(0)}%). The two corpora are not the ` +
              `same vintage — load declarations on the target before shipping these columns.`,
          );

        if (!apply) {
          console.log("dry run — pass --apply to write");
          await c.query("ROLLBACK");
          return;
        }
        const upd = await c.query(
          `UPDATE declaration d
              SET filed_institution = s.filed_institution,
                  filed_position    = s.filed_position
             FROM ship_filed_position s
            WHERE d.source_url = s.source_url
              AND (d.filed_institution IS DISTINCT FROM s.filed_institution
                OR d.filed_position    IS DISTINCT FROM s.filed_position)`,
        );
        await c.query("COMMIT");
        console.log(`updated ${upd.rowCount} row(s) on the target`);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      }
    });
  } finally {
    await src.end();
    await dst.end();
  }
};

/** `withClient` in lib/pg is bound to the shared pool; this ships between two explicit
 *  databases, so it needs the same shape against a pool it was handed. */
const withClientOn = async <T>(
  pool: Pool,
  fn: (c: import("pg").PoolClient) => Promise<T>,
): Promise<T> => {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
};

main().catch((e) => {
  console.error(`ship_filed_position: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
