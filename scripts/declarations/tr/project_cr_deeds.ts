/**
 * Layer 2 projection (docs/plans/cr-deeds-capture-v1.md §2): merge the parsed CR
 * Deeds captures into state.sqlite.company_persons — the Cause-2 fix that recovers
 * the pre-2021 owners the daily feed never saw.
 *
 * ⚠️ ADDITIVE, not replace-per-uic. §0a proved the CR body carries NO history and NO
 * erasure, so overwriting a uic's rows would destroy the daily feed's role history
 * (ex-managers, prior owners) that tr_person_roles serves. Instead CR rows live in
 * their OWN record_id namespace ("cr:<i>"), the daily rows are left untouched, and
 * downstream dedup (company_person_roles' DISTINCT ON) collapses a CR owner that
 * merely corroborates a daily one. persons_source='cr' marks every projected row.
 *
 * ⚠️ Runs INSIDE the daily rebuild (Step 5 wiring): reconstructState writes
 * state.sqlite from scratch every run, so a projection written once would be wiped
 * on the next refresh. It must re-run after each reconstruct, before db:load:tr:pg.
 *
 * Guard: a uic's CR rows are (re)written only from a successfully-parsed body that
 * yields ≥1 party — never from an empty/partial/errored parse, so a fetch glitch
 * can't blank a company. Legal-entity owners (община/state/company) ARE stored,
 * matching the daily feed; Bridge B's 3-part-public-figure guard keeps them out of
 * the person graph (plan §8.4).
 */

import { DatabaseSync } from "node:sqlite";
import { normalizePersonName } from "./state_replay";
import { parseCrDeed, type CrDeedParsed } from "./parse_cr_deeds";
import { isDeletedFactPlaceholder, ownerSharePercents } from "./owner_share";
import type { CrDeedsStore } from "./cr_deeds_store";
import { allRows, withClient } from "../../db/lib/pg";

export const CR_PERSONS_SOURCE = "cr";

/** One company_persons row as projected from a CR deed. */
export type CrPersonRow = {
  uic: string;
  role: string;
  name: string;
  nameNorm: string;
  positionLabel: string | null;
  country: string | null;
  sharePercent: number | null;
  recordId: string;
  fieldIdent: string;
  addedAt: string | null;
};

/**
 * Map a parsed deed to its company_persons rows (pure — no DB). record_id is
 * "cr:<global index>" so multiple parties from one field (e.g. three managers in
 * CR_F_7_L) stay distinct under the (uic, record_id, field_ident) primary key
 * without colliding with the daily feed's numeric RecordIDs.
 */
export const deedToPersonRows = (parsed: CrDeedParsed): CrPersonRow[] => {
  // ⚠️ The sole-owner 100% needs the SAME guard as owner_share.ts's refusal 1: it is
  // 100% by law only when it is the company's ONLY owner. An unconditional 100 is what
  // published companies whose shares summed to a mean of 200.8%. The deed is a capture
  // of the company's whole file, so its own party list is the right scope to count —
  // and on THAT population the guard's target is 39 uics, not the 4,517 measured on the
  // daily display dedup. CR owner fields carry no per-partner amount, so every other
  // owner is null and the daily writer's amounts are what produce a real percentage.
  //
  // The placeholder exclusion is what keeps that 39 from being ~4,300: without it the
  // register's deleted-fact marker counts as a second owner.
  const owners = parsed.parties.filter(
    (p) =>
      (p.role === "partner" || p.role === "sole_owner") &&
      !isDeletedFactPlaceholder(p.name),
  );
  return parsed.parties.map((p, i) => ({
    uic: parsed.uic,
    role: p.role,
    name: p.name,
    nameNorm: normalizePersonName(p.name),
    positionLabel: p.positionLabel,
    country: p.country,
    sharePercent: p.role === "sole_owner" && owners.length === 1 ? 100 : null,
    recordId: `cr:${i}`,
    fieldIdent: p.fieldIdent,
    addedAt: p.entryDate,
  }));
};

/** ADD the persons_source column to a state.sqlite built before it existed. */
const ensurePersonsSourceColumn = (db: DatabaseSync): void => {
  const cols = db.prepare(`PRAGMA table_info(company_persons)`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === "persons_source"))
    db.exec(`ALTER TABLE company_persons ADD COLUMN persons_source TEXT`);
};

/** A founding-date answer, carrying the REAL capture status for provenance. */
export type FoundingAnswer = {
  eik: string;
  date: string | null;
  httpStatus: number;
};

/** The single (uic, parsed, status) → FoundingAnswer mapping, so the two producers
 * (projectCrDeedsToState's loop and foundingDatesFromStore) can't drift. */
const captureToFounding = (
  uic: string,
  parsed: CrDeedParsed,
  httpStatus: number,
): FoundingAnswer => ({ eik: uic, date: parsed.foundingDate, httpStatus });

export type ProjectStats = {
  companies: number; // deeds that contributed ≥1 party
  parties: number; // company_persons rows written
  founding: FoundingAnswer[]; // for company_founded (fetch_company_founded's job)
};

/**
 * Merge every capture in `store` into `state.sqlite` at `stateDbPath`. Returns the
 * founding dates too, so the caller can fold them into company_founded (retiring
 * fetch_company_founded) without a second parse pass.
 */
export const projectCrDeedsToState = (
  stateDbPath: string,
  store: CrDeedsStore,
): ProjectStats => {
  const db = new DatabaseSync(stateDbPath);
  const stats: ProjectStats = { companies: 0, parties: 0, founding: [] };
  try {
    ensurePersonsSourceColumn(db);
    const delCr = db.prepare(
      `DELETE FROM company_persons WHERE uic = ? AND persons_source = 'cr'`,
    );
    const insPerson = db.prepare(
      `INSERT OR REPLACE INTO company_persons
         (uic, role, name, name_norm, position_label, country, share_percent,
          share_amount, share_currency, record_id, group_id, field_ident,
          added_at, erased_at, persons_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, 'cr')`,
    );

    // Every uic whose rows this run rewrote — the re-derivation pass below reads them
    // back with the CR rows in place.
    const touched = new Set<string>();

    db.exec("BEGIN");
    try {
      for (const { uic, body, httpStatus } of store.captured()) {
        const parsed = parseCrDeed(body);
        if (!parsed) continue; // unparseable — never touch this uic's rows
        // A founding date is an answer even for a party-less company (e.g. an ET).
        stats.founding.push(captureToFounding(uic, parsed, httpStatus));

        const rows = deedToPersonRows(parsed);
        if (rows.length === 0) continue; // ≥1-party guard: don't wipe on empty parse

        delCr.run(uic); // idempotent re-run: replace only THIS uic's prior CR rows
        for (const r of rows) {
          insPerson.run(
            r.uic,
            r.role,
            r.name,
            r.nameNorm,
            r.positionLabel,
            r.country,
            r.sharePercent,
            r.recordId,
            r.fieldIdent,
            r.addedAt,
          );
          stats.parties++;
        }
        stats.companies++;
        touched.add(uic);
      }

      // ⚠️ RE-DERIVE OVER THE MERGED ROW SET. sqlite_writer.ts computed every
      // percentage over the DAILY replay state, before these CR rows existed — but
      // tr_owner_share partitions over daily ∪ CR, so without this pass the stored
      // value and the served one are computed from different rows and cannot agree by
      // construction. Measured: 28 companies carry both, and in 10 the CR row is later
      // than every daily row, so the view's current vintage becomes the CR rows (which
      // carry no amount, hence a refusal) while the store still published a percentage
      // from the superseded daily vintage — /company/:eik rendering "—" while
      // /mp-company/:eik rendered 50% / 50% for the same company.
      const readRows = db.prepare(
        `SELECT record_id, field_ident, name, name_norm, role, added_at, erased_at,
                share_amount, share_currency
           FROM company_persons WHERE uic = ?`,
      );
      const setPct = db.prepare(
        `UPDATE company_persons SET share_percent = ?
          WHERE uic = ? AND record_id = ? AND field_ident = ?`,
      );
      for (const uic of touched) {
        const rows = readRows.all(uic) as Array<Record<string, unknown>>;
        const pcts = ownerSharePercents(
          rows.map((r) => ({
            key: `${String(r.record_id)}|${String(r.field_ident)}`,
            name: (r.name as string | null) ?? null,
            nameNormalized: String(r.name_norm ?? ""),
            role: String(r.role ?? ""),
            addedAt: (r.added_at as string | null) ?? null,
            erasedAt: (r.erased_at as string | null) ?? null,
            shareAmount: r.share_amount == null ? null : Number(r.share_amount),
            shareCurrency: (r.share_currency as string | null) ?? null,
          })),
        );
        for (const r of rows)
          setPct.run(
            pcts.get(`${String(r.record_id)}|${String(r.field_ident)}`) ?? null,
            uic,
            String(r.record_id),
            String(r.field_ident),
          );
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  return stats;
};

/**
 * Founding dates for every real capture — the input to the standalone company_founded
 * loader (load_cr_founding_pg.ts), which is a SEPARATE process from the sqlite persons
 * projection, so this single parse pass is not paired with projectCrDeedsToState's.
 * (In-process, read `stats.founding` instead — do not call both.)
 */
export const foundingDatesFromStore = (
  store: CrDeedsStore,
): FoundingAnswer[] => {
  const out: FoundingAnswer[] = [];
  for (const { uic, body, httpStatus } of store.captured()) {
    const parsed = parseCrDeed(body);
    if (parsed) out.push(captureToFounding(uic, parsed, httpStatus));
  }
  return out;
};

/** Only company-level 9-digit EIKs belong in company_founded (a 13-digit клон ЕИК
 * is not a company). Pure — separated so the drop is testable and countable. */
export const eligibleFounding = (
  founding: FoundingAnswer[],
): FoundingAnswer[] => founding.filter((f) => /^[0-9]{9}$/.test(f.eik));

/** Build one chunk's `VALUES (...)` list + its bind params (pure, testable). */
export const foundingChunkSql = (
  chunk: FoundingAnswer[],
): { values: string; params: unknown[] } => {
  const params: unknown[] = [];
  const values = chunk
    .map((r, j) => {
      params.push(r.eik, r.date, r.httpStatus);
      return `($${j * 3 + 1}, $${j * 3 + 2}, 'registryagency:CR/Deeds', now(), $${j * 3 + 3}, 1)`;
    })
    .join(", ");
  return { values, params };
};

/**
 * Fold the CR founding dates into the PG `company_founded` table — subsuming
 * scripts/procurement/fetch_company_founded.ts, now off the cached raw. Every row
 * comes from a stored capture, so it respects that table's invariant: a row means
 * "the register answered", a null founded_date means "answered, no dated deed" —
 * never "unreachable". The REAL capture http_status is recorded (not an assumed
 * 200), attempts=1. Upsert so a re-capture refreshes the date.
 *
 * Caller owns the pool lifecycle (does not call end()). Chunked to bound the
 * per-statement parameter count for the ~478k-row corpus.
 */
export const upsertFoundingDates = async (
  founding: FoundingAnswer[],
  chunkSize = 500,
): Promise<number> => {
  // Preflight: the upsert names http_status/attempts (migration 033).
  const [col] = await allRows<{ n: string }>(
    `SELECT count(*)::text AS n FROM information_schema.columns
      WHERE table_name = 'company_founded' AND column_name = 'http_status'`,
  );
  if (col?.n === "0")
    throw new Error(
      "company_founded is missing http_status/attempts — apply 033 first:\n" +
        "  npx tsx scripts/db/apply_functions.ts 033_procurement_risk_indexes.sql",
    );

  const rows = eligibleFounding(founding);
  const dropped = founding.length - rows.length;
  if (dropped > 0)
    console.warn(
      `upsertFoundingDates: skipped ${dropped} non-9-digit eik(s) (not company-level)`,
    );

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { values, params } = foundingChunkSql(rows.slice(i, i + chunkSize));
    await withClient((c) =>
      c.query(
        `INSERT INTO company_founded
           (eik, founded_date, source, fetched_at, http_status, attempts)
         VALUES ${values}
         ON CONFLICT (eik) DO UPDATE
           SET founded_date = EXCLUDED.founded_date, source = EXCLUDED.source,
               fetched_at = now(), http_status = EXCLUDED.http_status,
               attempts = EXCLUDED.attempts`,
        params,
      ),
    );
    written += rows.slice(i, i + chunkSize).length;
  }
  return written;
};
