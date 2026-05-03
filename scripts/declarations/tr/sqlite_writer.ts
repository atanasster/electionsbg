/**
 * Persist a reconstructed TR `Map<uic, TrCompanyState>` into a SQLite file
 * using Node's built-in `node:sqlite`. Schema matches Phase 4 in
 * docs/plans/mp-financial-connections-slice3-tr-design.md.
 *
 * Querying example (from any consumer):
 *
 *   SELECT uic, role, added_at FROM company_persons
 *   WHERE name_norm = 'ИВАН АНГЕЛОВ АНГЕЛОВ' AND erased_at IS NULL;
 *
 * `node:sqlite` is experimental in Node 22 but stable enough for a single-
 * writer batch import — we open the file, run one big WAL transaction, close.
 */

import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import type { TrCompanyState } from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA temp_store   = MEMORY;

CREATE TABLE IF NOT EXISTS companies (
  uic            TEXT PRIMARY KEY,
  name           TEXT,
  legal_form     TEXT,
  seat           TEXT,
  funds_amount   REAL,
  funds_currency TEXT,
  status         TEXT,
  last_updated   TEXT
);

-- NB: no person_hash column. The TR open-data dump Indent element
-- contains a hash+salt of the person EGN; we treat it the same as the
-- EGN itself and never persist or expose it. Cross-filing person joins
-- are by name_norm (uppercased plain-text name) only.
CREATE TABLE IF NOT EXISTS company_persons (
  uic            TEXT NOT NULL,
  role           TEXT NOT NULL,
  name           TEXT NOT NULL,
  name_norm      TEXT NOT NULL,
  position_label TEXT,
  share_percent  REAL,
  record_id      TEXT NOT NULL,
  group_id       TEXT,
  field_ident    TEXT NOT NULL,
  added_at       TEXT,
  erased_at      TEXT,
  PRIMARY KEY (uic, record_id, field_ident)
);

CREATE INDEX IF NOT EXISTS idx_persons_name_norm ON company_persons(name_norm);
CREATE INDEX IF NOT EXISTS idx_persons_uic       ON company_persons(uic);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

export type WriteSqliteOpts = {
  /** Output DB file. Overwrites any existing file. */
  outPath: string;
  state: Map<string, TrCompanyState>;
  /** Stamped into the `meta` table for traceability. */
  generatedAt?: string;
  sourceLabel?: string;
};

export type WriteSqliteResult = {
  outPath: string;
  companies: number;
  persons: number;
};

export const writeStateToSqlite = (
  opts: WriteSqliteOpts,
): WriteSqliteResult => {
  // Always start from a clean DB to avoid stale rows from a previous run.
  if (fs.existsSync(opts.outPath)) fs.unlinkSync(opts.outPath);
  // node:sqlite also writes a -wal/-shm sidecar; remove any stragglers.
  for (const ext of ["-wal", "-shm", "-journal"]) {
    const p = opts.outPath + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const db = new DatabaseSync(opts.outPath);
  db.exec(SCHEMA);

  const insertCompany = db.prepare(
    `INSERT INTO companies
       (uic, name, legal_form, seat, funds_amount, funds_currency, status, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPerson = db.prepare(
    `INSERT INTO company_persons
       (uic, role, name, name_norm, position_label, share_percent,
        record_id, group_id, field_ident, added_at, erased_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMeta = db.prepare(
    `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
  );

  let companies = 0;
  let persons = 0;

  db.exec("BEGIN");
  try {
    for (const c of opts.state.values()) {
      const fundsAmount = c.funds ? Number(c.funds.amount) : null;
      const fundsCurrency = c.funds ? c.funds.currency : null;
      insertCompany.run(
        c.uic,
        c.name,
        c.legalForm,
        c.seat,
        fundsAmount != null && Number.isFinite(fundsAmount)
          ? fundsAmount
          : null,
        fundsCurrency,
        c.status,
        c.lastUpdated,
      );
      companies++;

      for (const p of c.persons.values()) {
        insertPerson.run(
          c.uic,
          p.role,
          p.name,
          p.nameNormalized,
          p.positionLabel,
          p.sharePercent,
          p.recordId,
          p.groupId,
          p.fieldIdent,
          p.addedAt,
          p.erasedAt,
        );
        persons++;
      }
    }

    insertMeta.run(
      "generated_at",
      opts.generatedAt ?? new Date().toISOString(),
    );
    if (opts.sourceLabel) insertMeta.run("source_label", opts.sourceLabel);
    insertMeta.run("companies", String(companies));
    insertMeta.run("persons", String(persons));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    db.close();
    throw err;
  }

  // Tighten on-disk file (drops free pages from the WAL).
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();

  return { outPath: opts.outPath, companies, persons };
};
