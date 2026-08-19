/**
 * Ship the held-place columns of `declaration_asset` from one database to another —
 * `held_scope`, `held_country`, `held_raw_in_country`, `held_raw_abroad`.
 *
 *   npx tsx scripts/db/ship_held_abroad.ts                      # dry run, local -> cloud
 *   npx tsx scripts/db/ship_held_abroad.ts --apply
 *   npx tsx scripts/db/ship_held_abroad.ts --from <url> --to <url> --apply
 *
 * ── WHY SHIP RATHER THAN RELOAD ─────────────────────────────────────────────────────────
 *
 * The four columns are derived from each filing's own „В страната" / „В чужбина" cells by
 * classifyHeldPlace, and a filing is immutable once published — so the values are identical
 * whichever database derives them. The documented alternative is the full
 * `db:load:declarations:pg:cloud` phase 1 + `--resolve`, which TRUNCATEs `declaration`, NULLs
 * every `person_id`, and then runs 090's `DROP MATERIALIZED VIEW person_wealth_year CASCADE`
 * — measured at 8m02s on Cloud SQL with /persons, /officials/assets, /mp-assets and
 * /declarations/crypto answering 500 throughout, because a DbDataTable resource has no
 * `missingMigration` degrade. This writes into the rows that are already there and takes only
 * a RowExclusiveLock, so readers stay on their MVCC snapshot and nothing goes down.
 *
 * Same reasoning, and the same shape, as ship_filed_position.ts. Use that one's route (a full
 * reload) when the SHARDS themselves have moved for some other reason; use this one when the
 * only difference between the two databases is this backfill.
 *
 * ── WHY THE KEY IS (source_url, seq) ────────────────────────────────────────────────────
 *
 * `declaration_id` is a `bigserial` handed out in insertion order by `load_declarations_pg`,
 * so it is a property of how a database was loaded rather than of the filing — the same trap
 * ship_filed_position.ts documents. `source_url` is the register's own URL for the document
 * and is `NOT NULL UNIQUE` in 089; `seq` is the row's position within that filing, written by
 * the loader straight from the shard's array order.
 *
 * ⚠️ `seq` ALONE IS NOT AN IDENTITY, so the payload also carries `category` and every matched
 * row must agree on it. `backfill_asset_held_abroad.ts` only ever ADDS fields — it never
 * reorders, inserts or drops a row, and it skips a filing whose row set has moved — so the
 * two sides' seq numbering is the same by construction. This check is what would catch it if
 * that ever stopped being true, and it is the one thing standing between a mis-keyed write
 * and publishing „Белгия" against somebody else's bank account. ANY disagreement refuses.
 */

import { Pool } from "pg";
import { copyRows } from "./lib/copy";
import { LOCAL_DATABASE_URL, DATABASE_URL, redactUrl } from "./lib/pg";

const arg = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (f: string): boolean => process.argv.includes(f);

/** Below this share of shipped rows matching a target row, refuse rather than write. A low
 *  match rate means the two corpora are not the same vintage, and a partial write would leave
 *  the target with some money rows carrying a place and others not — the mixture that makes
 *  „how much is held abroad" quietly under-count instead of failing. */
const MIN_MATCH_SHARE = 0.95;

const SHIP_COLS = [
  "held_scope",
  "held_country",
  "held_raw_in_country",
  "held_raw_abroad",
] as const;

type Row = {
  source_url: string;
  seq: number;
  category: string;
  held_scope: string | null;
  held_country: string | null;
  held_raw_in_country: string | null;
  held_raw_abroad: string | null;
};

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
        `    npx tsx scripts/db/ship_held_abroad.ts --to postgres://postgres@127.0.0.1:5434/electionsbg`,
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
        WHERE table_name = 'declaration_asset' AND column_name = ANY($1)`,
      [[...SHIP_COLS]],
    );
    if (cols.rowCount !== SHIP_COLS.length)
      throw new Error(
        `target is missing declaration_asset.held_* — apply 089 first:\n` +
          `  DATABASE_URL=${redactUrl(toUrl)} npx tsx scripts/db/apply_functions.ts 089_declarations.sql`,
      );

    // Only the rows that carry a place. held_scope is non-null for exactly tables 5 and 8, so
    // this is that set; a row the backfill skipped is NULL here and stays NULL on the target,
    // which is what 089 defines as "this row's table has no such question".
    const rows = await src.query<Row>(
      `SELECT d.source_url, a.seq, a.category,
              a.held_scope, a.held_country, a.held_raw_in_country, a.held_raw_abroad
         FROM declaration_asset a
         JOIN declaration d USING (declaration_id)
        WHERE a.held_scope IS NOT NULL
        ORDER BY d.source_url, a.seq`,
    );
    if (!rows.rowCount)
      throw new Error(
        "source has no held_scope at all — run " +
          "scripts/declarations/backfill_asset_held_abroad.ts --apply there, then reload",
      );
    console.log(`  ${rows.rowCount} money row(s) carry a place in the source`);

    await withClientOn(dst, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          `CREATE TEMP TABLE ship_held_abroad (
             source_url text NOT NULL,
             seq int NOT NULL,
             category text NOT NULL,
             held_scope text,
             held_country text,
             held_raw_in_country text,
             held_raw_abroad text,
             PRIMARY KEY (source_url, seq)
           ) ON COMMIT DROP`,
        );
        const sent = await copyRows(
          c,
          "ship_held_abroad",
          ["source_url", "seq", "category", ...SHIP_COLS],
          rows.rows.map((r) => [
            r.source_url,
            r.seq,
            r.category,
            r.held_scope,
            r.held_country,
            r.held_raw_in_country,
            r.held_raw_abroad,
          ]),
        );

        const [{ matched }] = (
          await c.query<{ matched: string }>(
            `SELECT count(*)::text AS matched
               FROM ship_held_abroad s
               JOIN declaration d USING (source_url)
               JOIN declaration_asset a
                 ON a.declaration_id = d.declaration_id AND a.seq = s.seq`,
          )
        ).rows;
        const share = Number(matched) / sent;
        console.log(
          `  ${matched}/${sent} match a money row on the target (${(share * 100).toFixed(1)}%)`,
        );
        if (share < MIN_MATCH_SHARE)
          throw new Error(
            `only ${(share * 100).toFixed(1)}% of shipped rows match a target row ` +
              `(floor ${(MIN_MATCH_SHARE * 100).toFixed(0)}%). The two corpora are not the ` +
              `same vintage — load declarations on the target before shipping these columns.`,
          );

        // The identity check. A (source_url, seq) that lands on a row of a different category
        // is a mis-key, not a near miss, so ANY disagreement refuses the whole ship.
        const drift = await c.query<{
          source_url: string;
          seq: number;
          src_cat: string;
          dst_cat: string;
        }>(
          `SELECT s.source_url, s.seq, s.category AS src_cat, a.category AS dst_cat
             FROM ship_held_abroad s
             JOIN declaration d USING (source_url)
             JOIN declaration_asset a
               ON a.declaration_id = d.declaration_id AND a.seq = s.seq
            WHERE a.category IS DISTINCT FROM s.category
            LIMIT 10`,
        );
        if (drift.rowCount) {
          throw new Error(
            `(source_url, seq) lands on a DIFFERENT row on the target — the two corpora ` +
              `disagree about row order, so shipping would write a place onto the wrong ` +
              `asset. Reload declarations on the target instead. Sample:\n  ` +
              drift.rows
                .map(
                  (r) =>
                    `${r.source_url} seq=${r.seq}: source ${r.src_cat}, target ${r.dst_cat}`,
                )
                .join("\n  "),
          );
        }
        console.log("  row identity verified — every match agrees on category");

        const changing = (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n
               FROM ship_held_abroad s
               JOIN declaration d USING (source_url)
               JOIN declaration_asset a
                 ON a.declaration_id = d.declaration_id AND a.seq = s.seq
              WHERE ${SHIP_COLS.map((k) => `a.${k} IS DISTINCT FROM s.${k}`).join(" OR ")}`,
          )
        ).rows[0].n;
        console.log(`  ${changing} row(s) would change`);

        if (!apply) {
          console.log("dry run — pass --apply to write");
          await c.query("ROLLBACK");
          return;
        }
        const upd = await c.query(
          `UPDATE declaration_asset a
              SET ${SHIP_COLS.map((k) => `${k} = s.${k}`).join(", ")}
             FROM ship_held_abroad s
             JOIN declaration d USING (source_url)
            WHERE a.declaration_id = d.declaration_id
              AND a.seq = s.seq
              AND (${SHIP_COLS.map((k) => `a.${k} IS DISTINCT FROM s.${k}`).join(" OR ")})`,
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
  console.error(`ship_held_abroad: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
