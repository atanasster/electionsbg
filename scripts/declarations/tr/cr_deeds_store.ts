/**
 * Layer 1 of the CR Deeds capture (docs/plans/cr-deeds-capture-v1.md §2): the
 * durable, immutable raw store. One gzipped HTTP body per EIK, plus a SEPARATE
 * failure ledger.
 *
 * ⚠️ THE TWO-TABLE SPLIT IS THE §0 INVARIANT, ONE LAYER DOWN. `cr_deeds` holds
 * ANSWERS ONLY — a row here means the register answered. Failures go to
 * `cr_deeds_failed`, which the resume query (`hasFresh`) never consults. This is
 * structural: `raw_gz` is NOT NULL, so a non-answer cannot be written to `cr_deeds`
 * even by accident, and a failed fetch therefore stays un-captured and is retried
 * by the next run. The founding-date crawler learned this the hard way — it wrote a
 * bare null for every failure and poisoned ~4,100 firms because its resume query
 * skipped anything "already present".
 *
 * A confirmed empty-200 ("no such company") IS an answer: it is stored with a real
 * (gzipped-empty) body and `byte_len = 0`, so resume skips it — we do not re-ask the
 * register about an EIK it has already told us does not exist.
 *
 * node:sqlite (same engine as sqlite_writer.ts): single-writer batch import, one file.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

export const CR_DEEDS_API_VERSION = "portal.registryagency.bg/CR/api/Deeds/v1";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA temp_store   = MEMORY;

-- ANSWERS ONLY. A row here means the register answered (a real body, or a
-- confirmed empty-200 "no such company" stored with byte_len = 0).
CREATE TABLE IF NOT EXISTS cr_deeds (
  uic          TEXT PRIMARY KEY,
  raw_gz       BLOB NOT NULL,     -- gzip of the exact HTTP body ("" for empty-200)
  byte_len     INTEGER NOT NULL,  -- uncompressed length; 0 ⇒ no such company
  content_hash TEXT NOT NULL,     -- sha256(body) for change detection on refresh
  http_status  INTEGER NOT NULL,
  fetched_at   TEXT NOT NULL,
  api_version  TEXT NOT NULL
);

-- NON-ANSWERS. Never consulted by the resume query, so every one is retried.
CREATE TABLE IF NOT EXISTS cr_deeds_failed (
  uic          TEXT PRIMARY KEY,
  reason       TEXT NOT NULL,
  http_status  INTEGER,
  attempts     INTEGER,
  failed_at    TEXT NOT NULL,
  fail_count   INTEGER NOT NULL DEFAULT 1
);
`;

export type CrDeedsStats = {
  captures: number; // rows in cr_deeds
  empty: number; // captures that were "no such company" (byte_len 0)
  failures: number; // rows in cr_deeds_failed
};

export class CrDeedsStore {
  private db: DatabaseSync;
  // Prepared once and reused — the resume filter alone runs one lookup per
  // candidate (hundreds of thousands at tier 3), so re-parsing per call is pure waste.
  private readonly selFresh;
  private readonly insAnswer;
  private readonly delFailed;
  private readonly insFailure;
  private readonly selBody;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    this.selFresh = this.db.prepare(
      `SELECT fetched_at FROM cr_deeds WHERE uic = ?`,
    );
    this.insAnswer = this.db.prepare(
      `INSERT INTO cr_deeds
         (uic, raw_gz, byte_len, content_hash, http_status, fetched_at, api_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uic) DO UPDATE SET
         raw_gz = excluded.raw_gz, byte_len = excluded.byte_len,
         content_hash = excluded.content_hash, http_status = excluded.http_status,
         fetched_at = excluded.fetched_at, api_version = excluded.api_version`,
    );
    this.delFailed = this.db.prepare(
      `DELETE FROM cr_deeds_failed WHERE uic = ?`,
    );
    this.insFailure = this.db.prepare(
      `INSERT INTO cr_deeds_failed
         (uic, reason, http_status, attempts, failed_at, fail_count)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(uic) DO UPDATE SET
         reason = excluded.reason, http_status = excluded.http_status,
         attempts = excluded.attempts, failed_at = excluded.failed_at,
         fail_count = cr_deeds_failed.fail_count + 1`,
    );
    this.selBody = this.db.prepare(
      `SELECT raw_gz, byte_len FROM cr_deeds WHERE uic = ?`,
    );
  }

  /**
   * True when this EIK is already captured and need not be re-fetched. A capture
   * is fresh unless `minFetchedAt` is given (a `--refresh-before` boundary), in
   * which case only captures at/after that timestamp count as fresh. Failures are
   * in the other table and never make an EIK "fresh".
   */
  hasFresh(uic: string, minFetchedAt?: string | null): boolean {
    const row = this.selFresh.get(uic) as { fetched_at: string } | undefined;
    if (!row) return false;
    if (!minFetchedAt) return true;
    return row.fetched_at >= minFetchedAt;
  }

  /**
   * The set of already-fresh EIKs, read in ONE query — the crawler's resume
   * filter over a whole tier, so it is not N per-EIK `hasFresh` lookups before a
   * tier-3 run even begins. Same freshness rule as `hasFresh`.
   */
  freshSet(minFetchedAt?: string | null): Set<string> {
    const rows = this.db
      .prepare(
        minFetchedAt
          ? `SELECT uic FROM cr_deeds WHERE fetched_at >= ?`
          : `SELECT uic FROM cr_deeds`,
      )
      .all(...(minFetchedAt ? [minFetchedAt] : [])) as Array<{ uic: string }>;
    return new Set(rows.map((r) => r.uic));
  }

  /**
   * Persist an ANSWER. `body === null` is the confirmed empty-200 "no such
   * company" — stored as a gzipped empty string with byte_len 0. Any prior
   * failure row for this EIK is cleared, since it is now answered. Idempotent.
   */
  putAnswer(
    uic: string,
    body: string | null,
    httpStatus: number,
    fetchedAt: string,
    apiVersion: string = CR_DEEDS_API_VERSION,
  ): void {
    const text = body ?? "";
    const gz = gzipSync(Buffer.from(text, "utf8"));
    const hash = createHash("sha256").update(text, "utf8").digest("hex");
    this.insAnswer.run(
      uic,
      gz,
      Buffer.byteLength(text, "utf8"),
      hash,
      httpStatus,
      fetchedAt,
      apiVersion,
    );
    this.delFailed.run(uic);
  }

  /**
   * Record a NON-answer. Bumps fail_count on re-attempt. NEVER written to
   * cr_deeds, so the EIK stays un-captured and the next run retries it.
   */
  putFailure(
    uic: string,
    reason: string,
    httpStatus: number | null,
    attempts: number,
    failedAt: string,
  ): void {
    this.insFailure.run(uic, reason, httpStatus, attempts, failedAt);
  }

  /** Read a captured body back (gunzip). null when absent or a "no such company". */
  getBody(uic: string): string | null {
    const row = this.selBody.get(uic) as
      | { raw_gz: Uint8Array; byte_len: number }
      | undefined;
    if (!row || row.byte_len === 0) return null;
    return gunzipSync(Buffer.from(row.raw_gz)).toString("utf8");
  }

  /**
   * Iterate every real capture (byte_len > 0 — skips the "no such company" rows)
   * as (uic, body, httpStatus), one gunzip at a time so the projection over ~478k
   * companies never holds them all in memory. The uic list is loaded up front;
   * bodies stream. httpStatus is yielded so the founding-date fold can record the
   * REAL status rather than assuming 200.
   */
  *captured(): Generator<{ uic: string; body: string; httpStatus: number }> {
    const rows = this.db
      .prepare(
        `SELECT uic, http_status FROM cr_deeds WHERE byte_len > 0 ORDER BY uic`,
      )
      .all() as Array<{ uic: string; http_status: number }>;
    for (const { uic, http_status } of rows) {
      const body = this.getBody(uic);
      if (body) yield { uic, body, httpStatus: http_status };
    }
  }

  stats(): CrDeedsStats {
    const c = this.db
      .prepare(
        `SELECT count(*) AS captures,
                sum(CASE WHEN byte_len = 0 THEN 1 ELSE 0 END) AS empty
           FROM cr_deeds`,
      )
      .get() as { captures: number; empty: number | null };
    const f = this.db
      .prepare(`SELECT count(*) AS failures FROM cr_deeds_failed`)
      .get() as { failures: number };
    return { captures: c.captures, empty: c.empty ?? 0, failures: f.failures };
  }

  close(): void {
    this.db.close();
  }
}
