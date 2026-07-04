// Shared "what changed" changelog writer for PG loaders. Records one ingest
// batch + the per-row first-seen delta for a freshly (re)loaded dataset, so the
// user-facing recent_updates(days, lim) feed (schema/pg/007) can surface it.
//
// Call INSIDE the loader's existing BEGIN/COMMIT so the changelog row commits
// atomically with the data — a rolled-back load leaves no orphan batch/changelog
// records, and a committed load can never lose its changelog.
//
// Flexibility (see 005_ingest_tracking.sql): the write is per-row by default, so
// day-to-day deltas (e.g. +87 tenders) are itemised. Only when a single load's
// new-row count exceeds `threshold` (a bulk backfill or the first cold load) is
// the batch marked 'summary' — the feed then shows one "N new · M total" line
// instead of 100k+ per-row records. In summary mode the first-seen rows are still
// inserted (key + batch only, no rich name/detail) so future deltas dedup
// correctly, but nothing floods the feed.
//
// Requires 005_ingest_tracking.sql applied (ingest_batches + ingest_first_seen).

import type { PoolClient } from "pg";

/** A load bringing more than this many NEW rows is summarised, not itemised. */
export const INGEST_SUMMARY_THRESHOLD = 500;

export interface IngestChangelogOpts {
  /** Stable machine source id — also the recent_updates `kind` for detail rows
   *  (e.g. 'tender', 'fund_project', 'ngo_funding'). */
  source: string;
  /** Table (aliased `t`) whose current rows are the corpus after (re)load. */
  table: string;
  /** SQL expression (t-qualified) yielding a STABLE natural key per row — must
   *  survive TRUNCATE+reload. e.g. `t.unp`, `t.contract_number`, or an
   *  `md5(...)` over the row's content columns when the PK is a serial. */
  keyExpr: string;
  /** t-qualified expression for the changelog display name (nullable). */
  nameExpr?: string;
  /** t-qualified expression for the changelog detail line (nullable). */
  detailExpr?: string;
  /** t-qualified expression (::double precision) for a money figure (nullable). */
  amountExpr?: string;
  /** Corpus size after this load (rows_total on the batch). */
  rowsTotal: number;
  /** Override the summary threshold for an unusually large or small dataset. */
  threshold?: number;
}

export interface IngestChangelogResult {
  batchId: number;
  rowsNew: number;
  mode: "detail" | "summary";
}

/** Open a batch, record first-seen for genuinely-new keys, and pick detail vs
 *  summary mode. Idempotent across reloads: existing (source,key) pairs keep
 *  their original batch (ON CONFLICT DO NOTHING), so rows_new = the real delta. */
export const recordIngestBatch = async (
  c: PoolClient,
  opts: IngestChangelogOpts,
): Promise<IngestChangelogResult> => {
  const threshold = opts.threshold ?? INGEST_SUMMARY_THRESHOLD;

  const batch = await c.query(
    "INSERT INTO ingest_batches (source, rows_total) VALUES ($1, $2) RETURNING id",
    [opts.source, opts.rowsTotal],
  );
  const batchId = batch.rows[0].id as number;

  // First-seen for new keys only. Rich columns stay NULL here; they're backfilled
  // below for detail batches only (a summary batch keeps just key+batch_id).
  const ins = await c.query(
    `INSERT INTO ingest_first_seen (source, key, batch_id)
     SELECT $1, (${opts.keyExpr})::text, $2 FROM ${opts.table} t
     ON CONFLICT (source, key) DO NOTHING`,
    [opts.source, batchId],
  );
  const rowsNew = ins.rowCount ?? 0;
  const mode: "detail" | "summary" = rowsNew > threshold ? "summary" : "detail";

  await c.query(
    "UPDATE ingest_batches SET rows_new = $1, mode = $2 WHERE id = $3",
    [rowsNew, mode, batchId],
  );

  // Snapshot the rich changelog fields for the small delta only.
  if (mode === "detail" && rowsNew > 0) {
    await c.query(
      `UPDATE ingest_first_seen f
       SET name       = ${opts.nameExpr ?? "NULL"},
           detail     = ${opts.detailExpr ?? "NULL"},
           amount_eur = ${opts.amountExpr ?? "NULL::double precision"}
       FROM ${opts.table} t
       WHERE f.source = $1 AND f.batch_id = $2
         AND f.key = (${opts.keyExpr})::text`,
      [opts.source, batchId],
    );
  }

  return { batchId, rowsNew, mode };
};
