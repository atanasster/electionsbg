// Raw store for the Държавен вестник material crawl: one row per idMat. node:sqlite,
// single file, gitignored, never uploaded — the loader re-parses it, so a parser fix
// needs no re-crawl.
//
// Every answered id keeps its HEADER (issuer, issue, title) so a resume never re-asks
// it; only Council of Ministers spending decrees keep their BODY (gzip'd), since those
// are the only pages the corpus models. Ids DV never issued are stored with no header.
// Network errors and 5xx go to `dv_failed` and are retried on the next run.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { DvHeader } from "./dv_decree";

export const DEFAULT_STORE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../raw_data/budget/dv_decrees.sqlite",
);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
CREATE TABLE IF NOT EXISTS dv_material (
  id          INTEGER PRIMARY KEY,   -- idMat
  issuer      TEXT,                  -- NULL: an id DV never issued
  issue_no    INTEGER,
  issue_date  TEXT,
  official    INTEGER,
  title       TEXT,
  body_gz     BLOB,                  -- spending decrees only
  fetched_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dv_failed (
  id        INTEGER PRIMARY KEY,
  reason    TEXT NOT NULL,
  failed_at TEXT NOT NULL
);
`;

export class DvStore {
  readonly db: DatabaseSync;
  constructor(file = DEFAULT_STORE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
  }

  put(id: number, header: DvHeader | null, body: string | null) {
    this.db
      .prepare(
        `INSERT INTO dv_material (id, issuer, issue_no, issue_date, official, title, body_gz, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET issuer = excluded.issuer, issue_no = excluded.issue_no,
           issue_date = excluded.issue_date, official = excluded.official, title = excluded.title,
           body_gz = excluded.body_gz, fetched_at = excluded.fetched_at`,
      )
      .run(
        id,
        header?.issuer ?? null,
        header?.issueNo ?? null,
        header?.issueDate ?? null,
        header ? (header.official ? 1 : 0) : null,
        header?.title ?? null,
        body == null ? null : gzipSync(Buffer.from(body, "utf8")),
        new Date().toISOString(),
      );
    this.db.prepare("DELETE FROM dv_failed WHERE id = ?").run(id);
  }

  fail(id: number, reason: string) {
    this.db
      .prepare(
        `INSERT INTO dv_failed (id, reason, failed_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET reason = excluded.reason, failed_at = excluded.failed_at`,
      )
      .run(id, reason.slice(0, 500), new Date().toISOString());
  }

  answeredIds(): Set<number> {
    const rows = this.db.prepare("SELECT id FROM dv_material").all() as {
      id: number;
    }[];
    return new Set(rows.map((r) => r.id));
  }

  /** Ids that failed on an earlier run — retried whatever range a run walks. */
  failedIds(): number[] {
    return (
      this.db.prepare("SELECT id FROM dv_failed ORDER BY id").all() as {
        id: number;
      }[]
    ).map((r) => r.id);
  }

  /** The highest id answered — where a nightly run resumes from. */
  maxId(): number | null {
    const r = this.db.prepare("SELECT max(id) AS m FROM dv_material").get() as {
      m: number | null;
    };
    return r.m;
  }

  /** Every stored decree body, in id order. */
  *decrees(): Generator<{ id: number; header: DvHeader; html: string }> {
    const it = this.db
      .prepare(
        `SELECT id, issuer, issue_no, issue_date, official, title, body_gz
           FROM dv_material WHERE body_gz IS NOT NULL ORDER BY id`,
      )
      .iterate() as Iterable<{
      id: number;
      issuer: string;
      issue_no: number;
      issue_date: string;
      official: number;
      title: string;
      body_gz: Uint8Array;
    }>;
    for (const r of it)
      yield {
        id: r.id,
        header: {
          issuer: r.issuer,
          issueNo: r.issue_no,
          issueDate: r.issue_date,
          official: r.official === 1,
          title: r.title,
        },
        html: gunzipSync(r.body_gz).toString("utf8"),
      };
  }

  counts(): { answered: number; decrees: number; failed: number } {
    const one = (sql: string) =>
      Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      answered: one("SELECT count(*) n FROM dv_material"),
      decrees: one(
        "SELECT count(*) n FROM dv_material WHERE body_gz IS NOT NULL",
      ),
      failed: one("SELECT count(*) n FROM dv_failed"),
    };
  }

  close() {
    this.db.close();
  }
}
