/**
 * Tier A raw store for the ЦАИС ЕОП dossier crawl
 * (docs/plans/tender-dossier-ingest-v1.md §5). One gzipped JSON body per
 * (tenderId, kind), plus a SEPARATE failure ledger.
 *
 * ⚠️ THE TWO-TABLE SPLIT IS THE INVARIANT, copied deliberately from
 * cr_deeds_store.ts. `eop_dossier` holds ANSWERS ONLY — a row here means the
 * register answered. Non-answers go to `eop_dossier_failed`, which the resume query
 * never consults, so every one is retried by the next run. This is structural, not
 * a convention: `body_gz` is NOT NULL, so a failure cannot be written to the answers
 * table even by accident.
 *
 * The precedent is not hypothetical. fetch_company_founded returned a bare `null`
 * for every failure mode and persisted it; because its resume query skipped anything
 * "already present", a failed fetch became a permanent, never-retried claim that the
 * firm has no founding date, and the daily null rate climbed 4.7% → 47.2% in lockstep
 * with the source throttling. At 830k requests that would be far harder to notice.
 *
 * A confirmed empty body IS an answer: GetPublishedTenderDetails returns 200 with an
 * empty body for unpublished/draft tenderIds, and that is exactly how the id-space
 * walk tells a draft from a real procedure. It is stored with `byte_len = 0` so a
 * resume does not re-ask.
 *
 * node:sqlite, single file, WAL. Gitignored, never uploaded — same posture as
 * raw_data/tr/cr_deeds.sqlite.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

/** One fetchable document per tender-scoped API method. `announcement_docs` is
 *  keyed by announcementId, `buyer_profile` by organizationId — see `subjectId`. */
export type DossierKind =
  | "details"
  | "announcements"
  | "announcement_docs"
  | "contract_items"
  | "lots"
  | "exports"
  | "buyer_profile";

export const DOSSIER_KINDS: readonly DossierKind[] = [
  "details",
  "announcements",
  "announcement_docs",
  "contract_items",
  "lots",
  "exports",
  "buyer_profile",
] as const;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA temp_store   = MEMORY;

-- ANSWERS ONLY. A row means the register answered (a real body, or a confirmed
-- empty-200 stored with byte_len = 0). body_gz NOT NULL is what makes it
-- impossible to record a failure here.
CREATE TABLE IF NOT EXISTS eop_dossier (
  kind         TEXT    NOT NULL,
  subject_id   INTEGER NOT NULL,   -- tenderId | announcementId | organizationId
  body_gz      BLOB    NOT NULL,   -- gzip of the exact HTTP body ("" for empty-200)
  byte_len     INTEGER NOT NULL,   -- uncompressed length; 0 => "nothing here"
  content_hash TEXT    NOT NULL,   -- sha256(body) — change detection on refresh
  http_status  INTEGER NOT NULL,
  fetched_at   TEXT    NOT NULL,
  api_version  TEXT    NOT NULL,
  PRIMARY KEY (kind, subject_id)
);

-- NON-ANSWERS. Never consulted by the resume query.
CREATE TABLE IF NOT EXISTS eop_dossier_failed (
  kind        TEXT    NOT NULL,
  subject_id  INTEGER NOT NULL,
  reason      TEXT    NOT NULL,
  http_status INTEGER,
  detail      TEXT,
  failed_at   TEXT    NOT NULL,
  fail_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, subject_id)
);

-- Tier B: extracted document TEXT. Keyed on the document's MD5 (the register's own
-- hash), NOT on tenderId — the same bytes appear under different documentIds in the
-- export ZIP vs the live manifest, and one file can serve several tenders.
-- The BYTES ARE NEVER STORED (plan §12): text + provenance only.
CREATE TABLE IF NOT EXISTS eop_doc_text (
  md5         TEXT PRIMARY KEY,
  document_id INTEGER NOT NULL,   -- the id this text was fetched through
  name        TEXT    NOT NULL,
  ext         TEXT,
  size_bytes  INTEGER NOT NULL,   -- of the SOURCE file, for provenance
  text_gz     BLOB    NOT NULL,   -- gzip of extracted text ("" when none extractable)
  chars       INTEGER NOT NULL,   -- 0 => extractor ran and found no text layer
  pages       INTEGER,            -- null when unknown/not a PDF
  extractor   TEXT    NOT NULL,   -- 'pdftotext' | 'textutil' | ...
  -- The extractor's own version string. Load-bearing because the BYTES ARE
  -- DISCARDED (plan §12): if a future pdftotext changes output we cannot re-extract
  -- locally, only re-crawl — and without this we could not even tell WHICH rows to
  -- re-crawl. Nullable so a machine where the version probe fails still records.
  extractor_version TEXT,
  fetched_at  TEXT    NOT NULL
);

-- Every documentId we have ever resolved to stored text.
--
-- ⚠️ SEPARATE FROM eop_doc_text BECAUSE THE RELATION IS MANY-TO-ONE. Several ids
-- legitimately carry the same bytes (the export ZIP republishes a file under a new
-- id — see plan §9.1), and eop_doc_text is content-keyed on md5 so those collapse
-- onto ONE row. Storing the id there made resume ping-pong: the ON CONFLICT (md5)
-- upsert set document_id = excluded.document_id, so the second id evicted the
-- first, whose probe then returned false, and the pair alternated with BOTH
-- re-downloaded every run — worse than the id-prefixed scheme it replaced.
CREATE TABLE IF NOT EXISTS eop_doc_seen (
  document_id INTEGER PRIMARY KEY,
  md5         TEXT NOT NULL,
  seen_at     TEXT NOT NULL
);

-- Tier B non-answers, same split, same reason.
CREATE TABLE IF NOT EXISTS eop_doc_text_failed (
  document_id INTEGER PRIMARY KEY,
  md5         TEXT,
  reason      TEXT NOT NULL,
  detail      TEXT,
  failed_at   TEXT NOT NULL,
  fail_count  INTEGER NOT NULL DEFAULT 1
);
`;

/**
 * (table, column, type) triples that must exist on a WARM store.
 *
 * Every column added to SCHEMA after the first release needs an entry here, or it
 * never reaches a store that a multi-hour crawl earned — and the omission is silent.
 */
const RECONCILE: readonly (readonly [string, string, string])[] = [
  ["eop_doc_text", "extractor_version", "TEXT"],
];

export type DossierStats = {
  answers: number;
  empty: number;
  failures: number;
  byKind: Record<string, number>;
  docText: number;
  docTextEmpty: number;
  docTextFailed: number;
};

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

export class EopDossierStore {
  private db: DatabaseSync;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.reconcile();
  }

  /**
   * Idempotent column adds for stores created by an earlier revision.
   * `CREATE TABLE IF NOT EXISTS` is a no-op on a warm file, so a new column in
   * SCHEMA never reaches one — and the store is gitignored host state that cannot
   * simply be rebuilt from the repo (re-earning it is a multi-hour crawl).
   * SQLite has no `ADD COLUMN IF NOT EXISTS`; probe the table instead.
   *
   * Driven by RECONCILE so the next column added to SCHEMA is one line here rather
   * than a hand-rolled probe block — forgetting which fails silently, as a warm
   * store quietly missing a column.
   */
  private reconcile(): void {
    for (const [table, col, type] of RECONCILE) {
      const cols = new Set(
        (
          this.db.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
          }[]
        ).map((c) => c.name),
      );
      if (!cols.has(col))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
    // Seed the id→md5 mapping from rows written before eop_doc_seen existed.
    // Without this a warm store's MD5-less documents miss the resume probe once
    // and are re-downloaded — cheap, but pointless, and the table exists precisely
    // to stop that.
    this.db.exec(
      `INSERT INTO eop_doc_seen (document_id, md5, seen_at)
         SELECT document_id, md5, fetched_at FROM eop_doc_text
       WHERE true
       ON CONFLICT (document_id) DO NOTHING`,
    );
  }

  /** Resume predicate for tier A. Consults ANSWERS ONLY — a previous failure must
   *  not suppress a retry, which is the whole point of the two-table split. */
  has(kind: DossierKind, subjectId: number): boolean {
    const r = this.db
      .prepare(
        "SELECT 1 AS x FROM eop_dossier WHERE kind = ? AND subject_id = ?",
      )
      .get(kind, subjectId) as { x: number } | undefined;
    return r !== undefined;
  }

  /** Bulk resume: which of these subjectIds are already answered for `kind`. */
  answeredIds(kind: DossierKind): Set<number> {
    const rows = this.db
      .prepare("SELECT subject_id FROM eop_dossier WHERE kind = ?")
      .all(kind) as { subject_id: number }[];
    return new Set(rows.map((r) => Number(r.subject_id)));
  }

  /**
   * Record an ANSWER. `body` is the exact HTTP body; "" is legal and means the
   * register said "nothing here".
   */
  putAnswer(
    kind: DossierKind,
    subjectId: number,
    body: string,
    httpStatus: number,
    apiVersion: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO eop_dossier
           (kind, subject_id, body_gz, byte_len, content_hash, http_status, fetched_at, api_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, subject_id) DO UPDATE SET
           body_gz = excluded.body_gz, byte_len = excluded.byte_len,
           content_hash = excluded.content_hash, http_status = excluded.http_status,
           fetched_at = excluded.fetched_at, api_version = excluded.api_version`,
      )
      .run(
        kind,
        subjectId,
        gzipSync(Buffer.from(body, "utf8")),
        Buffer.byteLength(body, "utf8"),
        sha256(body),
        httpStatus,
        new Date().toISOString(),
        apiVersion,
      );
    // An answer supersedes any earlier failure for the same subject.
    this.db
      .prepare(
        "DELETE FROM eop_dossier_failed WHERE kind = ? AND subject_id = ?",
      )
      .run(kind, subjectId);
  }

  /** Record a NON-ANSWER. Increments fail_count so a persistently broken subject is
   *  visible rather than silently re-tried forever. */
  putFailure(
    kind: DossierKind,
    subjectId: number,
    reason: string,
    httpStatus?: number,
    detail?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO eop_dossier_failed
           (kind, subject_id, reason, http_status, detail, failed_at, fail_count)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (kind, subject_id) DO UPDATE SET
           reason = excluded.reason, http_status = excluded.http_status,
           detail = excluded.detail, failed_at = excluded.failed_at,
           fail_count = eop_dossier_failed.fail_count + 1`,
      )
      .run(
        kind,
        subjectId,
        reason,
        httpStatus ?? null,
        detail ?? null,
        new Date().toISOString(),
      );
  }

  /** Read back one answer's body, or null when never answered. Distinguish from a
   *  stored empty body (which returns ""). */
  getBody(kind: DossierKind, subjectId: number): string | null {
    const r = this.db
      .prepare(
        "SELECT body_gz FROM eop_dossier WHERE kind = ? AND subject_id = ?",
      )
      .get(kind, subjectId) as { body_gz: Uint8Array } | undefined;
    if (!r) return null;
    return gunzipSync(Buffer.from(r.body_gz)).toString("utf8");
  }

  /** Parsed convenience wrapper. Returns null for "never answered" AND for a stored
   *  empty body — callers that must tell them apart use getBody. */
  getJson<T>(kind: DossierKind, subjectId: number): T | null {
    const body = this.getBody(kind, subjectId);
    if (body === null || body === "") return null;
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }

  /**
   * Iterate every stored answer of one kind without materialising them all.
   *
   * ⚠️ KEYSET-PAGED, and it has to be. The first version called `.all(kind)`, which
   * loads every row's gzipped body into memory before the first yield: at 131,716
   * `details` rows averaging ~34 KB gzipped that is ~4.5 GB resident, and tier B's
   * work-set build is its only caller. It passed a 200-row probe and would have OOM'd
   * on the real corpus (plan §13.2).
   *
   * Keyset (`subject_id > ?`) rather than LIMIT/OFFSET: OFFSET re-scans the skipped
   * prefix on every page, which turns a linear walk into a quadratic one at this size.
   */
  *iterate<T>(
    kind: DossierKind,
    pageSize = 500,
  ): Generator<{ subjectId: number; body: T }> {
    // A zero/negative page size yields LIMIT 0, so the first page is empty and the
    // walk returns having produced nothing — indistinguishable from an empty table.
    // A silently empty work set is exactly the failure class this store guards.
    if (!Number.isInteger(pageSize) || pageSize < 1)
      throw new Error(
        `iterate: pageSize must be a positive integer, got ${pageSize}`,
      );
    const stmt = this.db.prepare(
      `SELECT subject_id, body_gz, byte_len FROM eop_dossier
        WHERE kind = ? AND subject_id > ?
        ORDER BY subject_id LIMIT ?`,
    );
    let after = -1;
    for (;;) {
      const rows = stmt.all(kind, after, pageSize) as {
        subject_id: number;
        body_gz: Uint8Array;
        byte_len: number;
      }[];
      if (rows.length === 0) return;
      for (const r of rows) {
        after = Number(r.subject_id);
        if (r.byte_len === 0) continue;
        const s = gunzipSync(Buffer.from(r.body_gz)).toString("utf8");
        try {
          yield { subjectId: Number(r.subject_id), body: JSON.parse(s) as T };
        } catch {
          /* malformed stored body — skip; the failure ledger is the record */
        }
      }
      if (rows.length < pageSize) return;
    }
  }

  // ---- tier B ---------------------------------------------------------------

  /** Resume predicate for tier B, keyed on the register's own MD5. */
  hasDocText(md5: string): boolean {
    const r = this.db
      .prepare("SELECT 1 AS x FROM eop_doc_text WHERE md5 = ?")
      .get(md5) as { x: number } | undefined;
    return r !== undefined;
  }

  /** Secondary resume predicate for the minority of manifest entries that carry no
   *  `MD5Hash`. Those cannot be content-keyed BEFORE the download, so without this
   *  they would be re-fetched on every run — the row is written under the MD5 we
   *  compute from the bytes, which no pre-download check can guess.
   *
   *  Reads `eop_doc_seen`, not `eop_doc_text`: many-to-one (above), and a PK seek
   *  rather than the table scan the content-keyed table would force on every probe. */
  hasDocTextByDocumentId(documentId: number): boolean {
    const r = this.db
      .prepare("SELECT 1 AS x FROM eop_doc_seen WHERE document_id = ?")
      .get(documentId) as { x: number } | undefined;
    return r !== undefined;
  }

  /** The extractor version a row was written with, or null when the probe could not
   *  produce one. Exists so a future extractor upgrade can select exactly the rows it
   *  invalidates — which, with the bytes discarded, is the only way to scope a
   *  re-crawl. */
  getExtractorVersion(md5: string): string | null {
    const r = this.db
      .prepare("SELECT extractor_version AS v FROM eop_doc_text WHERE md5 = ?")
      .get(md5) as { v: string | null } | undefined;
    return r?.v ?? null;
  }

  /**
   * Store extracted text.
   *
   * ⚠️ WHITESPACE-ONLY EXTRACTION IS NORMALISED TO EMPTY HERE, at the write
   * boundary, so `chars = 0` is exactly "no extractable content" for every caller.
   * A scanned PDF yields one newline per page, so `pdftotext` returns "\n\n\n" for a
   * 3-page scan — which stored verbatim gives `chars = 3` and reads as a successful
   * extraction. Measured on the first 142 specs: 12 of them (8.5%) were exactly this,
   * and the run's own counters disagreed with the store's (12 vs 0) because the
   * counter trimmed and the column did not.
   *
   * `pages` is kept so downstream can apply a chars-per-page test — a 51-page
   * document with 522 characters is a scan with a cover stamp, which this
   * normalisation alone does not catch and must not pretend to.
   */
  putDocText(rec: {
    md5: string;
    documentId: number;
    name: string;
    ext: string | null;
    sizeBytes: number;
    text: string;
    pages: number | null;
    extractor: string;
    extractorVersion?: string | null;
  }): void {
    if (rec.text.trim().length === 0) rec = { ...rec, text: "" };
    this.db
      .prepare(
        `INSERT INTO eop_doc_text
           (md5, document_id, name, ext, size_bytes, text_gz, chars, pages,
            extractor, extractor_version, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (md5) DO UPDATE SET
           document_id = excluded.document_id, name = excluded.name,
           ext = excluded.ext, size_bytes = excluded.size_bytes,
           text_gz = excluded.text_gz, chars = excluded.chars,
           pages = excluded.pages, extractor = excluded.extractor,
           extractor_version = excluded.extractor_version,
           fetched_at = excluded.fetched_at`,
      )
      .run(
        rec.md5,
        rec.documentId,
        rec.name,
        rec.ext,
        rec.sizeBytes,
        gzipSync(Buffer.from(rec.text, "utf8")),
        rec.text.length,
        rec.pages,
        rec.extractor,
        rec.extractorVersion ?? null,
        new Date().toISOString(),
      );
    // The id→md5 mapping is what makes resume work for MD5-less entries. Many ids
    // may point at one md5; that is the shape of the data, so it gets its own table.
    this.db
      .prepare(
        `INSERT INTO eop_doc_seen (document_id, md5, seen_at) VALUES (?, ?, ?)
         ON CONFLICT (document_id) DO UPDATE SET
           md5 = excluded.md5, seen_at = excluded.seen_at`,
      )
      .run(rec.documentId, rec.md5, new Date().toISOString());
    this.db
      .prepare("DELETE FROM eop_doc_text_failed WHERE document_id = ?")
      .run(rec.documentId);
  }

  putDocTextFailure(
    documentId: number,
    md5: string | null,
    reason: string,
    detail?: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO eop_doc_text_failed (document_id, md5, reason, detail, failed_at, fail_count)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT (document_id) DO UPDATE SET
           md5 = excluded.md5, reason = excluded.reason, detail = excluded.detail,
           failed_at = excluded.failed_at,
           fail_count = eop_doc_text_failed.fail_count + 1`,
      )
      .run(documentId, md5, reason, detail ?? null, new Date().toISOString());
  }

  getDocText(md5: string): string | null {
    const r = this.db
      .prepare("SELECT text_gz FROM eop_doc_text WHERE md5 = ?")
      .get(md5) as { text_gz: Uint8Array } | undefined;
    if (!r) return null;
    return gunzipSync(Buffer.from(r.text_gz)).toString("utf8");
  }

  // ---- reporting ------------------------------------------------------------

  stats(): DossierStats {
    const one = (sql: string): number =>
      Number((this.db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);
    const byKind: Record<string, number> = {};
    for (const r of this.db
      .prepare("SELECT kind, count(*) AS n FROM eop_dossier GROUP BY kind")
      .all() as { kind: string; n: number }[])
      byKind[r.kind] = Number(r.n);
    return {
      answers: one("SELECT count(*) AS n FROM eop_dossier"),
      empty: one("SELECT count(*) AS n FROM eop_dossier WHERE byte_len = 0"),
      failures: one("SELECT count(*) AS n FROM eop_dossier_failed"),
      byKind,
      docText: one("SELECT count(*) AS n FROM eop_doc_text"),
      docTextEmpty: one(
        "SELECT count(*) AS n FROM eop_doc_text WHERE chars = 0",
      ),
      docTextFailed: one("SELECT count(*) AS n FROM eop_doc_text_failed"),
    };
  }

  close(): void {
    this.db.close();
  }
}
