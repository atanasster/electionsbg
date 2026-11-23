// The Commerce Registry's announced-acts index (205, db:load:tr-announced-acts:pg) —
// the ГФО / доклад / декларация list per company. docs/plans/tr-gfo-ingest-v1.md Phase 0.
//
// WHY: the feed stopped listing ГФО on 2026-10-12 (ДВ бр. 92/2026 moved it into a
// separate stream). Until then nothing in Postgres recorded which statements a company
// had filed, so „no ГФО here" and „we never looked" were the same answer. This gate keeps
// the index from silently regressing to that state, and keeps the cutover canary honest.
//
// ⚠️ SKIPS WITH A DISTINCT REASON when the table is absent or empty — both inputs are
// gitignored host state (the feed archive, the CR capture), so a fresh clone has neither.
// That is not „the index is correct" and must never read as one.
//
//   pnpm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end, pinLocalDatabase } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

pinLocalDatabase();
const haveDb = await dbReachable();
const one = async (sql: string): Promise<number> =>
  Number(
    (await allRows<{ n: string }>(sql).catch(() => [{ n: "-1" }]))[0]?.n ?? 0,
  );

const total = haveDb
  ? await one("SELECT count(*) n FROM tr_announced_act")
  : -1;
const skip = !haveDb
  ? "Postgres unreachable"
  : total < 0
    ? "migration 205 not applied — run `pnpm run db:load:tr-announced-acts:pg`"
    : total === 0
      ? "announced-acts index empty (no feed archive / CR capture on this host) — " +
        "run `pnpm run db:load:tr-announced-acts:pg`, or this gate is vacuous"
      : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("every act names a company and a source", async () => {
  const bad = await one(
    `SELECT count(*) n FROM tr_announced_act
      WHERE uic !~ '^([0-9]{9}|[0-9]{13})$' OR NOT (in_feed OR in_cr)`,
  );
  assert.equal(bad, 0, `${bad} act(s) with a malformed UIC or no source flag`);
});

test.skipIf(skip)("acts join the registry's companies", async () => {
  // Measured 2026-11-23: 0 of 5.2M acts name a UIC absent from tr_companies. The floor
  // leaves room for a company the next TR load has not reached yet, nothing more.
  const companies = await one("SELECT count(*) n FROM tr_companies");
  if (companies <= 0) return; // TR corpus not loaded on this host.
  const orphans = await one(
    `SELECT count(*) n FROM tr_announced_act a
      WHERE NOT EXISTS (SELECT 1 FROM tr_companies c WHERE c.uic = a.uic)`,
  );
  assert.ok(
    orphans / total <= 0.01,
    `${orphans}/${total} acts name a UIC missing from tr_companies`,
  );
});

test.skipIf(skip)(
  "fiscal_year is set only on the ГФО family, and on most of it",
  async () => {
    const outside = await one(
      `SELECT count(*) n FROM tr_announced_act
        WHERE fiscal_year IS NOT NULL
          AND coalesce(field_ident, '') NOT IN ('10019B','1001BH','1001BI')
          AND coalesce(act_mode, 0) NOT IN (2, 60, 61)`,
    );
    assert.equal(
      outside,
      0,
      `${outside} non-ГФО act(s) carry a fiscal year — a year inside an устав is not one`,
    );
    const [r] = await allRows<{ gfo: string; dated: string }>(
      `SELECT count(*) gfo, count(fiscal_year) dated FROM tr_announced_act
        WHERE field_ident = '10019B' OR act_mode = 2`,
    );
    const gfo = Number(r.gfo);
    if (gfo > 0)
      assert.ok(
        Number(r.dated) / gfo >= 0.9,
        `only ${r.dated}/${gfo} ГФО acts resolve a fiscal year — the year parse regressed`,
      );
  },
);

test.skipIf(skip)(
  "a CR-only act gets the feed's mode where its label is unambiguous",
  async () => {
    // tr_act_mode is learnt from the feed; a label it knows must not stay unmoded.
    const unmoded = await one(
      `SELECT count(*) n FROM tr_announced_act a
         JOIN (SELECT act_mode_text FROM tr_act_mode
                GROUP BY act_mode_text HAVING count(*) = 1) m USING (act_mode_text)
        WHERE a.act_mode IS NULL`,
    );
    assert.equal(
      unmoded,
      0,
      `${unmoded} act(s) left without a resolvable mode`,
    );
  },
);

test.skipIf(skip)(
  "the feed ledger records the 2026-10-12 cutover rather than hiding it",
  async () => {
    // Before the cutover the feed listed thousands of ГФО-family acts per working day;
    // after it, none. If the archive spans both sides, both must be visible — a ledger
    // that reads 0 throughout means the feed extractor stopped seeing StatementsB.
    const [r] = await allRows<{ before: string; after: string; files: string }>(
      `SELECT coalesce(sum(gfo_acts) FILTER (WHERE day <  '2026-10-12'), 0) before,
              coalesce(sum(gfo_acts) FILTER (WHERE day >= '2026-10-12'), 0) after,
              count(*) files
         FROM tr_announced_act_feed_file`,
    );
    if (Number(r.files) === 0) return; // CR-only host: nothing to check here.
    assert.ok(
      Number(r.before) > 100_000,
      `the feed ledger holds only ${r.before} pre-cutover ГФО-family acts`,
    );
    // ⚠️ If this fails, the Agency may have RESTORED ГФО to the feed — good news, and the
    // plan (§6) says to drop the CR-only reliance. Re-measure, do not just raise a bound.
    assert.ok(
      Number(r.after) < 5_000,
      `${r.after} ГФО-family acts in post-cutover feed files — has StatementsB returned?`,
    );
  },
);

test.skipIf(skip)(
  "the CR pass decodes ActIDs that agree with the feed",
  async () => {
    // The ActID is recovered from the DocumentAccess token, not matched by text. An act
    // seen by both sources proves the decode; if CR captures exist but none overlaps the
    // feed, the token format has changed.
    const [r] = await allRows<{ cr: string; both: string }>(
      `SELECT count(*) FILTER (WHERE in_cr) cr,
            count(*) FILTER (WHERE in_cr AND in_feed) both
       FROM tr_announced_act`,
    );
    if (Number(r.cr) === 0) return;
    assert.ok(
      Number(r.both) / Number(r.cr) >= 0.5,
      `only ${r.both}/${r.cr} CR-decoded acts are also in the feed — the token decode may be wrong`,
    );
  },
);
