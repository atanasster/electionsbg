// Reload a served table WITHOUT ever blocking a reader.
//
// WHY THIS EXISTS
// `TRUNCATE t; INSERT INTO t …` inside one transaction is the obvious way to
// rebuild a derived table, and it is the reason /api/db/price-history and
// /api/db/price-product returned 500 on prod most days. TRUNCATE takes an
// AccessExclusiveLock that is held until COMMIT — i.e. for the WHOLE rebuild —
// and AccessExclusive conflicts with the AccessShare every SELECT needs. The
// serving pool sets `lock_timeout: 2000` (functions/index.js), so each reader
// that arrives during the rebuild waits 2 s, raises 55P03 and 500s. Measured
// on prod: price-history 500'd in ~26-minute clusters (the price_product_days
// rebuild) and price-product in 1-2 minute bursts (the price_current reload
// inside the daily ingest transaction), every one of them at ~2.0 s.
//
// The fix is the same one the contracts corpus already uses (load_pg.ts, see
// reference_contracts_reload_lock): build the fresh rows into an UNLOGGED stage
// twin — which no route reads, so locking it costs nothing — then MERGE the
// stage into the live table. The upsert and the anti-join delete take only
// RowExclusiveLock, which does NOT conflict with AccessShare: readers keep
// serving the previous vintage throughout the build and flip to the new one at
// the merge COMMIT, never blocking. Rebuild cost moves off the serving path
// entirely; only the (short) merge touches the live table.
//
// The `IS DISTINCT FROM` guard on the upsert is not cosmetic: these rebuilds are
// mostly-identical day to day (price_product_days rewrites ~625k rows of which
// only the newest day differs), so it keeps the merge from churning dead tuples
// on every row every run — the one real cost of dropping TRUNCATE, which used to
// reset the heap outright.
//
// NOT a substitute for a rename swap: the live table keeps its identity, so its
// foreign keys, indexes and grants survive untouched (price_product_days has an
// FK to price_products, which a DROP+RENAME would have to rebuild).

import type { PoolClient } from "pg";

export type StageMergeSpec = {
  /** The live, served table. */
  table: string;
  /** Relation holding the fresh rows — a stage twin or a TEMP table. */
  source: string;
  /** Primary-key columns (must be unique in `source`). */
  keys: string[];
  /** Every column to merge, keys included. Must exist in both relations. */
  cols: string[];
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

const checkIdents = (s: StageMergeSpec): void => {
  for (const id of [s.table, s.source, ...s.keys, ...s.cols])
    if (!IDENT.test(id))
      throw new Error(`stage merge: unsafe identifier ${JSON.stringify(id)}`);
  for (const k of s.keys)
    if (!s.cols.includes(k))
      throw new Error(`stage merge: key ${k} missing from cols`);
};

/** Insert new keys + update only genuinely-changed rows. RowExclusiveLock. */
export const stageUpsertSql = (s: StageMergeSpec): string => {
  const nonKey = s.cols.filter((c) => !s.keys.includes(c));
  const set = nonKey.map((c) => `${c} = excluded.${c}`).join(", ");
  // A key-only table has nothing to update; DO NOTHING keeps the SQL valid.
  const onConflict = nonKey.length
    ? `DO UPDATE SET ${set}
WHERE (${nonKey.map((c) => `${s.table}.${c}`).join(", ")})
  IS DISTINCT FROM (${nonKey.map((c) => `excluded.${c}`).join(", ")})`
    : "DO NOTHING";
  return `INSERT INTO ${s.table} (${s.cols.join(", ")})
SELECT ${s.cols.join(", ")} FROM ${s.source}
ON CONFLICT (${s.keys.join(", ")}) ${onConflict}`;
};

/** Drop keys the fresh build no longer produces. RowExclusiveLock. */
export const stageDeleteSql = (s: StageMergeSpec): string =>
  `DELETE FROM ${s.table} t
WHERE NOT EXISTS (SELECT 1 FROM ${s.source} g
   WHERE ${s.keys.map((k) => `g.${k} = t.${k}`).join(" AND ")})`;

/**
 * Create `source` as an UNLOGGED empty twin of `table`. Unlogged because it is
 * rebuilt from scratch every run — no WAL, no replication, and it is dropped
 * before the loader returns so it never reaches a pg_dump or db:sync:cloud.
 *
 * INCLUDING GENERATED INCLUDING DEFAULTS keeps column types byte-identical, so
 * the merge's INSERT … SELECT needs no casts. Constraints and the FK are
 * deliberately NOT copied: nothing reads the stage, and skipping them keeps the
 * bulk build cheap. The PK is added AFTER the rows land (see addStagePrimaryKey)
 * because the merge's ON CONFLICT needs a unique index on the LIVE table only —
 * on the stage it exists to prove the build produced no duplicate key.
 */
export const createStageTable = async (
  c: PoolClient,
  s: StageMergeSpec,
): Promise<void> => {
  checkIdents(s);
  await c.query(`DROP TABLE IF EXISTS ${s.source}`);
  await c.query(
    `CREATE UNLOGGED TABLE ${s.source} (LIKE ${s.table} INCLUDING GENERATED INCLUDING DEFAULTS)`,
  );
};

/** Add the PK to a filled stage table (fails loudly on a duplicate key) + ANALYZE. */
export const addStagePrimaryKey = async (
  c: PoolClient,
  s: StageMergeSpec,
): Promise<void> => {
  checkIdents(s);
  await c.query(
    `ALTER TABLE ${s.source} ADD PRIMARY KEY (${s.keys.join(", ")})`,
  );
  await c.query(`ANALYZE ${s.source}`);
};

/**
 * MERGE `source` into `table`: upsert every changed/new row, delete every key
 * the build did not produce, then verify the two now match exactly.
 *
 * Run inside a transaction (withTx) so readers see the previous vintage or the
 * new one, never a half-merged mix. The parity guard is load-bearing: after
 * upsert-all + delete-absent the live table MUST equal the staged build, so a
 * mismatch means a merge bug and failing beats serving a corrupted table.
 */
export const mergeFromStage = async (
  c: PoolClient,
  s: StageMergeSpec,
): Promise<void> => {
  checkIdents(s);
  await c.query(stageUpsertSql(s));
  await c.query(stageDeleteSql(s));
  const { rows } = await c.query<{ live: string; staged: string }>(
    `SELECT (SELECT count(*) FROM ${s.table}) AS live,
            (SELECT count(*) FROM ${s.source}) AS staged`,
  );
  const { live, staged } = rows[0];
  if (live !== staged)
    throw new Error(
      `${s.table} merge parity check failed: live=${live} staged=${staged}`,
    );
};

/**
 * The parity half of `mergeFromStage`, exposed so a caller merging a CHAIN of
 * FK-related tables can interleave the phases correctly.
 *
 * `mergeFromStage` couples upsert-then-delete per table, which is right for one
 * table and wrong for a chain: upserts must run PARENT→CHILD (a child row needs
 * its parent to exist) while deletes must run CHILD→PARENT (a parent cannot go
 * while a child still references it). Running the coupled form down a chain
 * raises 23503 the first time a parent is retired while its children are still
 * live — measured on interreg_programmes → interreg_operations.
 */
export const assertStageParity = async (
  c: PoolClient,
  s: StageMergeSpec,
): Promise<void> => {
  checkIdents(s);
  const { rows } = await c.query<{ live: string; staged: string }>(
    `SELECT (SELECT count(*) FROM ${s.table}) AS live,
            (SELECT count(*) FROM ${s.source}) AS staged`,
  );
  const { live, staged } = rows[0];
  if (live !== staged)
    throw new Error(
      `${s.table} merge parity check failed: live=${live} staged=${staged}`,
    );
};

/**
 * Merge a CHAIN of FK-related stage tables, `specs` ordered parent → child.
 *
 * Upserts run in the given order and deletes in reverse, so neither direction
 * of the foreign key is ever violated mid-merge. Parity is checked for every
 * table at the end, once the whole chain is consistent — checking it per table
 * mid-chain would compare a parent that has already lost rows against children
 * that have not yet.
 */
export const mergeChainFromStage = async (
  c: PoolClient,
  specs: StageMergeSpec[],
): Promise<void> => {
  for (const s of specs) await c.query(stageUpsertSql(s));
  for (const s of [...specs].reverse()) await c.query(stageDeleteSql(s));
  for (const s of specs) await assertStageParity(c, s);
};
