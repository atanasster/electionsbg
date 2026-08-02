// ONE-OFF: release kzk_appeals.suspension so the live status fallback works again.
//
//   npx tsx scripts/procurement/kzk_unfreeze_suspension.ts           (report only)
//   npx tsx scripts/procurement/kzk_unfreeze_suspension.ts --apply   (write)
//
// THE BUG. 042 serves the effective suspended state through
// `kzk_effective_suspension(suspension, status)` = `COALESCE(suspension, status
// ~* 'спрян')`, whose documented intent is that a live suspension shows without
// waiting for tier-2 and — unlike a stored bool — updates false→true on a
// re-scrape.
//
// That fallback has never been reachable. The column held a stored `false` on
// 7,778 of 7,886 rows, so COALESCE never saw its second argument, and the intake
// upsert is `COALESCE(kzk_appeals.suspension, EXCLUDED.suspension)` with the
// intake writing NULL — so the false could never move. 1,501 appeals requested a
// temporary measure; at most 4 could ever display as suspended.
//
// WHY NULLING THE WHOLE COLUMN IS SAFE. Measured 2026-08-02, before the run:
//
//     suspension=true  →     4 rows, ALL 4 with status ~ 'спрян'
//     suspension=false → 7,778 rows, NONE with status ~ 'спрян'
//
// i.e. the column was exactly a frozen snapshot of the expression the COALESCE
// falls back to. No value in it was ever established by a decision — the
// определения register that would set it authoritatively has never been crawled
// (plan §3c). So releasing it preserves every effective answer and makes every
// row track its status from then on.
//
// ⚠️ IT IS NOT TRUE THAT THIS CHANGES NOTHING — that claim was wrong the first
// time it was made here, and the correction is the reason 042 now has a shared
// function. `kzk_appeals_list` used to select the RAW column, so /procurement/appeals
// read a value every other surface treated as a hint: releasing the column took
// that page from 4 suspended chips to 0 while the other four consumers still
// showed 4. Do not run this against a database whose 042 predates
// `kzk_effective_suspension` — the preflight below refuses.
//
// ⚠️ OBSOLETE ONCE THE определения ARM LANDS (T4). At that point `suspension`
// gets a real authoritative source and blanket-nulling it would destroy genuine
// data. The guard below refuses in that case, and the instruction is: delete this
// file. The invariant it guards is ALSO asserted by
// scripts/db/tests/kzk_suspension.data.test.ts, which survives this deletion —
// that gate, not this comment, is what will tell you.
//
// CLOUD SQL IS A SEPARATE, MANUAL RUN — see CLAUDE.md. There is no
// db:load:kzk:pg:cloud for the intake arm, and a re-crawl cannot fix prod (it
// passes NULL into COALESCE(existing, EXCLUDED), which keeps the frozen false).
//
// One-off by convention: explicit --apply, never wired into a pipeline. See
// [[feedback_one_off_backfills]].

import { allRows, connectionUrl, withTx, end } from "../db/lib/pg";

/**
 * The premise-check. If a row is marked suspended while its status does NOT say
 * спрян, that value cannot have come from the intake snapshot — something
 * authoritative wrote it, and nulling the column would destroy it.
 *
 * ⚠️ Mirrored by scripts/db/tests/kzk_suspension.data.test.ts. When the
 * определения arm lands BOTH must change together — and this file gets deleted,
 * so the gate is the copy that matters.
 */
const AUTHORITATIVE_SQL = `SELECT count(*) n FROM kzk_appeals
   WHERE suspension IS TRUE AND status !~* 'спрян'`;

const main = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");

  // Say which database, always. This script rewrites 7,782 rows and the ambient
  // DATABASE_URL trap makes "which one" a real question.
  console.log(`→ target: ${connectionUrl().replace(/:[^:@/]*@/, ":***@")}`);

  // PREFLIGHT: 042 must already define the shared expression, or releasing the
  // column silently blanks /procurement/appeals (see the header).
  const fn = await allRows<{ ok: boolean }>(
    `SELECT true AS ok FROM pg_proc WHERE proname = 'kzk_effective_suspension'`,
  );
  if (fn.length === 0) {
    throw new Error(
      "kzk_effective_suspension() is missing — this database's 042 predates the " +
        "shared expression, so kzk_appeals_list still selects the RAW suspension " +
        "column and releasing it would blank /procurement/appeals. Apply it first:\n" +
        "  npx tsx scripts/db/apply_functions.ts 042_kzk_appeals.sql 044_procurement_ai.sql",
    );
  }

  const [before] = await allRows<{
    t: string;
    f: string;
    n: string;
    live: string;
  }>(
    `SELECT count(*) FILTER (WHERE suspension IS TRUE)  AS t,
            count(*) FILTER (WHERE suspension IS FALSE) AS f,
            count(*) FILTER (WHERE suspension IS NULL)  AS n,
            count(*) FILTER (WHERE status ~* 'спрян')   AS live
       FROM kzk_appeals`,
  );
  const frozen = Number(before.t) + Number(before.f);
  console.log(
    `→ suspension: ${before.t} true, ${before.f} false, ${before.n} null` +
      ` · ${before.live} rows currently carry a 'спрян' status`,
  );

  if (frozen === 0) {
    console.log(
      "\n✓ Already released — every row is NULL, so the status fallback is live " +
        "for all of them. Nothing to do.",
    );
    await end();
    return;
  }

  if (!apply) {
    console.log(
      `\nWould release ${frozen} row(s) to NULL, restoring the ` +
        "kzk_effective_suspension() fallback.\nRe-run with --apply.",
    );
    await end();
    return;
  }

  // Guard and write in ONE transaction: checking the premise and then acting on
  // it in a separate statement leaves a window in which a concurrent writer makes
  // the premise false.
  const released = await withTx(async (c) => {
    const [auth] = (await c.query<{ n: string }>(AUTHORITATIVE_SQL)).rows;
    if (Number(auth.n) > 0)
      throw new Error(
        `${auth.n} row(s) are marked suspended WITHOUT a 'спрян' status — that value ` +
          "cannot have come from the intake snapshot, so something authoritative wrote " +
          "it. Nulling the column would destroy it. This script is obsolete: delete it.",
      );
    const r = await c.query(
      "UPDATE kzk_appeals SET suspension = NULL WHERE suspension IS NOT NULL",
    );
    return r.rowCount ?? 0;
  });

  const [after] = await allRows<{ served: string }>(
    `SELECT count(*) served FROM kzk_appeals
      WHERE kzk_effective_suspension(suspension, status)`,
  );
  console.log(
    `✓ released ${released} row(s). ${after.served} appeal(s) now serve as suspended, ` +
      "tracked live from status rather than frozen.\n" +
      "  No JSON write-back: 042 derives this field at read time, and the intake's " +
      "own write-back mirrors PG's (now NULL) value.",
  );
  await end();
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => undefined);
  process.exit(1);
});
