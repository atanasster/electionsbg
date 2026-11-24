// Raw store for the pitay.government.bg crawl: one gzip'd HTTP body per
// application id. node:sqlite, single file, gitignored, never uploaded — the
// loader re-parses it, so a parser fix needs no re-crawl.
//
// ANSWERS ONLY in `pitay_page`: a 200 with an application, or the platform's real
// not-found page (a removed or never-published id, stored with byte_len = 0 so a
// resume does not re-ask). Anything else — network errors, 5xx, a 200 that is not
// an application — goes to `pitay_failed` and is retried on the next run.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { redactRequester } from "./pitay_parse";

export const DEFAULT_STORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../raw_data/zdoi/pitay.sqlite",
);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA secure_delete = ON;
CREATE TABLE IF NOT EXISTS pitay_page (
  id          INTEGER PRIMARY KEY,
  http_status INTEGER NOT NULL,
  body_gz     BLOB    NOT NULL,
  byte_len    INTEGER NOT NULL,
  status      TEXT,              -- the application status as parsed at fetch time
  fetched_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS pitay_failed (
  id         INTEGER PRIMARY KEY,
  reason     TEXT    NOT NULL,
  failed_at  TEXT    NOT NULL
);
`;

export class PitayStore {
  readonly db: DatabaseSync;
  constructor(file = DEFAULT_STORE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  /** Store one answer. The body is redacted HERE, the store's only write path, so
   *  a requester's name or contacts never reach disk (see pitay_parse PRIVACY). */
  put(id: number, httpStatus: number, body: string, status: string | null) {
    const safe = redactRequester(body);
    this.db
      .prepare(
        `INSERT INTO pitay_page (id, http_status, body_gz, byte_len, status, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET http_status = excluded.http_status,
           body_gz = excluded.body_gz, byte_len = excluded.byte_len,
           status = excluded.status, fetched_at = excluded.fetched_at`,
      )
      .run(
        id,
        httpStatus,
        gzipSync(Buffer.from(safe, "utf8")),
        httpStatus === 200 ? Buffer.byteLength(safe) : 0,
        status,
        new Date().toISOString(),
      );
    this.db.prepare("DELETE FROM pitay_failed WHERE id = ?").run(id);
  }

  fail(id: number, reason: string) {
    this.db
      .prepare(
        `INSERT INTO pitay_failed (id, reason, failed_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET reason = excluded.reason, failed_at = excluded.failed_at`,
      )
      .run(id, reason.slice(0, 500), new Date().toISOString());
  }

  /** Re-apply the redaction to every stored page — for pages written before a
   *  redaction rule existed. Returns how many pages changed. */
  redactExisting(): number {
    let changed = 0;
    const ids = (
      this.db
        .prepare(
          "SELECT id FROM pitay_page WHERE http_status = 200 ORDER BY id",
        )
        .all() as { id: number }[]
    ).map((r) => r.id);
    const read = this.db.prepare("SELECT body_gz FROM pitay_page WHERE id = ?");
    const update = this.db.prepare(
      "UPDATE pitay_page SET body_gz = ?, byte_len = ? WHERE id = ?",
    );
    // One page at a time, so memory does not grow with the store.
    for (const id of ids) {
      const row = read.get(id) as { body_gz: Uint8Array };
      const html = gunzipSync(row.body_gz).toString("utf8");
      const safe = redactRequester(html);
      if (safe === html) continue;
      update.run(
        gzipSync(Buffer.from(safe, "utf8")),
        Buffer.byteLength(safe),
        id,
      );
      changed++;
    }
    // An UPDATE leaves the old bytes in the WAL and in free pages; purge them so
    // the redacted contacts are not recoverable from the file.
    if (changed) {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      this.db.exec("VACUUM");
    }
    return changed;
  }

  /** Ids already answered (200 or 404). */
  answeredIds(): Set<number> {
    const rows = this.db.prepare("SELECT id FROM pitay_page").all() as {
      id: number;
    }[];
    return new Set(rows.map((r) => r.id));
  }

  /** Ids to re-read on a refresh: every request whose stored status can still
   *  move, plus every page fetched before `staleBefore` — a final request can be
   *  re-opened („Възобновено"), and only a re-read notices. */
  refreshIds(finals: ReadonlySet<string>, staleBefore: Date): number[] {
    const rows = this.db
      .prepare(
        "SELECT id, status, fetched_at FROM pitay_page WHERE http_status = 200 ORDER BY id",
      )
      .all() as { id: number; status: string | null; fetched_at: string }[];
    const cutoff = staleBefore.toISOString();
    return rows
      .filter(
        (r) => !r.status || !finals.has(r.status) || r.fetched_at < cutoff,
      )
      .map((r) => r.id);
  }

  /** Ids stored as missing. */
  missingIds(): number[] {
    const rows = this.db
      .prepare("SELECT id FROM pitay_page WHERE http_status = 404 ORDER BY id")
      .all() as { id: number }[];
    return rows.map((r) => r.id);
  }

  /** Every stored 200 page, in id order. */
  *pages(): Generator<{ id: number; html: string; fetchedAt: string }> {
    const it = this.db
      .prepare(
        "SELECT id, body_gz, fetched_at FROM pitay_page WHERE http_status = 200 ORDER BY id",
      )
      .iterate() as Iterable<{
      id: number;
      body_gz: Uint8Array;
      fetched_at: string;
    }>;
    for (const r of it)
      yield {
        id: r.id,
        html: gunzipSync(r.body_gz).toString("utf8"),
        fetchedAt: r.fetched_at,
      };
  }

  counts(): { pages: number; missing: number; failed: number } {
    const one = (sql: string) =>
      Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      pages: one("SELECT count(*) n FROM pitay_page WHERE http_status = 200"),
      missing: one("SELECT count(*) n FROM pitay_page WHERE http_status = 404"),
      failed: one("SELECT count(*) n FROM pitay_failed"),
    };
  }

  close() {
    this.db.close();
  }
}

export const storeExists = (file = DEFAULT_STORE): boolean =>
  fs.existsSync(file);
