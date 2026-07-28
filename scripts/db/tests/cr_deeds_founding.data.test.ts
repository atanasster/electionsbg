// Tier-3 (Postgres-native) regression gate for the CR Deeds founding-date fold
// (docs/plans/cr-deeds-capture-v1.md §6): upsertFoundingDates writes company_founded
// honestly end-to-end — a real row with the CR source + a RECORDED http_status
// (never the poisoning NULL), idempotent on re-fold, dropping non-company EIKs.
//
//   npm run test:data
//
// Auto-skips when Postgres is unreachable or company_founded lacks the migration-033
// provenance columns — exactly like the other *.data.test.ts gates, so CI skips it.
// Uses a synthetic, guaranteed-absent EIK and deletes it afterwards, so it never
// mutates real data.
//
// NB: a corpus-wide "no CR-source row has a NULL http_status" assertion is NOT made
// here — local company_founded still holds ~15.8k pre-provenance rows from the
// retired fetch_company_founded crawler (its own --requeue-nulls repair owns those).
// The new fold always records http_status; the synthetic write below proves it.

import { describe, it, afterAll, expect } from "vitest";
import { allRows, withClient, end } from "../lib/pg";
import { upsertFoundingDates } from "../../declarations/tr/project_cr_deeds";
import { recordIngestBatch } from "../lib/ingest_changelog";

const SYNTH_EIK = "999999991"; // 9 digits, not a real company

// Isolation model: upsertFoundingDates owns its own connection and auto-commits, so
// it cannot be wrapped in a caller-owned rollback (unlike the inRollback sibling
// gates). Instead the synthetic row is COMMITTED and reclaimed by the unconditional
// module-scope afterAll below — which also runs when the suite is skipped, so a row
// leaked by a crashed prior run self-heals. Keep the DELETE at module scope; do NOT
// move it inside a describe. The write `it`s are intentionally SEQUENTIAL (each
// assumes the prior left the row present).

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.company_founded') IS NOT NULL
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name='company_founded'
                             AND column_name='http_status') AS ok`,
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
// Never clobber a real row: only run the write test if the synthetic EIK is absent.
const synthFree =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM company_founded WHERE eik = $1`,
        [SYNTH_EIK],
      ).catch(() => [{ n: "1" }])
    )[0]?.n ?? "1",
  ) === 0;

afterAll(async () => {
  if (haveDb)
    await withClient((c) =>
      c.query(`DELETE FROM company_founded WHERE eik = $1`, [SYNTH_EIK]),
    ).catch(() => {});
  await end();
});

describe.skipIf(!synthFree)("upsertFoundingDates → company_founded", () => {
  it("writes a real answer with the CR source and a recorded http_status", async () => {
    const n = await upsertFoundingDates([
      { eik: SYNTH_EIK, date: "2015-05-05", httpStatus: 200 },
    ]);
    expect(n).toBe(1);
    const [row] = await allRows<{
      founded_date: string;
      source: string;
      http_status: number;
      attempts: number;
    }>(
      `SELECT founded_date::text, source, http_status, attempts
         FROM company_founded WHERE eik = $1`,
      [SYNTH_EIK],
    );
    expect(row.founded_date).toBe("2015-05-05");
    expect(row.source).toBe("registryagency:CR/Deeds");
    expect(row.http_status).toBe(200); // provenance recorded, not assumed
    expect(row.attempts).toBe(1);
  });

  it("upserts idempotently — a re-fold refreshes the same row, no duplicate", async () => {
    await upsertFoundingDates([
      { eik: SYNTH_EIK, date: "2015-05-05", httpStatus: 200 },
    ]);
    await upsertFoundingDates([
      { eik: SYNTH_EIK, date: "2016-06-06", httpStatus: 200 },
    ]);
    const [row] = await allRows<{ n: string; d: string }>(
      `SELECT count(*)::text AS n, max(founded_date)::text AS d
         FROM company_founded WHERE eik = $1`,
      [SYNTH_EIK],
    );
    expect(row.n).toBe("1");
    expect(row.d).toBe("2016-06-06"); // refreshed
  });

  it("drops a non-9-digit (branch) eik rather than writing a bad company row", async () => {
    const n = await upsertFoundingDates([
      { eik: "1234567890123", date: "2015-05-05", httpStatus: 200 },
    ]);
    expect(n).toBe(0);
  });

  it("records the REAL capture status, not an assumed 200", async () => {
    // A non-200 answer-with-body (hypothetical future crawler state) is recorded
    // as-is, so the provenance never lies about how the row was obtained.
    await upsertFoundingDates([
      { eik: SYNTH_EIK, date: "2015-05-05", httpStatus: 203 },
    ]);
    const [row] = await allRows<{ http_status: number }>(
      `SELECT http_status FROM company_founded WHERE eik = $1`,
      [SYNTH_EIK],
    );
    expect(row.http_status).toBe(203);
  });

  it("the changelog batch's rows_total is the CR corpus size, not the fold delta", async () => {
    // Guards FINDING-001: rows_total must equal count of CR-sourced rows so the
    // recent_updates "N new · M total" line can never read new > total. Recorded
    // inside a rolled-back tx so this assertion writes no changelog rows.
    const CR =
      "(SELECT eik, founded_date FROM company_founded WHERE source = 'registryagency:CR/Deeds')";
    const [{ n }] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${CR} t`,
    );
    const corpus = Number(n);
    expect(corpus).toBeGreaterThan(0); // the synthetic row is CR-sourced
    // withClient + manual BEGIN/ROLLBACK so this probe commits NO changelog rows.
    const res = await withClient(async (c) => {
      await c.query("BEGIN");
      const r = await recordIngestBatch(c, {
        source: "cr_deeds_founding_test",
        table: CR,
        keyExpr: "t.eik",
        rowsTotal: corpus,
      });
      const [batch] = (
        await c.query(
          `SELECT rows_total FROM ingest_batches WHERE source = 'cr_deeds_founding_test'
            ORDER BY id DESC LIMIT 1`,
        )
      ).rows as Array<{ rows_total: number }>;
      await c.query("ROLLBACK");
      return { batch, rowsNew: r.rowsNew };
    });
    expect(res.batch.rows_total).toBe(corpus);
    // rows_new counts the whole CR corpus as first-seen ⇒ never exceeds rows_total.
    expect(res.rowsNew).toBeLessThanOrEqual(corpus);
  });
});
