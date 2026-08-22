// mp_loyalty (182) — the last arm of the per-MP shard tree, and the one whose failure mode
// is a wrong percentage on a named member's page rather than a missing one.
//
// Plan: docs/plans/json-retirement-v2.md Tier 2.

import { afterAll, describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, dbReachable } from "../lib/pg";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const LOYALTY_JSON = path.join(
  REPO,
  "data/parliament/votes/derived/loyalty.json",
);

const haveDb = await dbReachable();
const populated =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM mp_loyalty`,
      ).catch(() => [{ n: "0" }])
    )[0].n,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !populated
    ? "mp_loyalty is absent or WITH NO DATA — run db:load:rollcall-derived:pg"
    : false;

afterAll(async () => {
  if (haveDb) await end();
});

describe("mp_loyalty", () => {
  test.skipIf(skip)("covers the chamber and stays in range", async () => {
    const [r] = await allRows<{ rows: string; parliaments: string }>(
      `SELECT count(*)::text AS rows, count(DISTINCT ns)::text AS parliaments
         FROM mp_loyalty`,
    );
    expect(Number(r.rows)).toBeGreaterThan(2000);
    expect(Number(r.parliaments)).toBeGreaterThan(5);
    const bad = await allRows<{ ns: number; mp_id: number }>(
      `SELECT ns, mp_id FROM mp_loyalty
        WHERE votes_cast <= 0
           OR with_party < 0
           OR with_party > votes_cast
           OR (loyalty_pct IS NOT NULL AND loyalty_pct NOT BETWEEN 0 AND 1)`,
    );
    expect(bad, "a loyalty row is out of range").toEqual([]);
  });

  // THE DERIVATION. `with_party` is the COMPLEMENT of mp_dissent, so the two must reconcile
  // exactly — a drift here is a wrong percentage beside a named member's name, and the row
  // count would not move.
  test.skipIf(skip)(
    "with_party is exactly votes_cast minus dissents",
    async () => {
      const bad = await allRows<{ ns: number; mp_id: number }>(
        `WITH d AS (SELECT ns, mp_id, count(*) AS n FROM mp_dissent GROUP BY ns, mp_id)
       SELECT l.ns, l.mp_id
         FROM mp_loyalty l LEFT JOIN d ON d.ns = l.ns AND d.mp_id = l.mp_id
        WHERE l.with_party <> l.votes_cast - COALESCE(d.n, 0)`,
      );
      expect(bad, "with_party disagrees with mp_dissent").toEqual([]);
      // Non-vacuity: the two must actually differ for a real number of members, or the
      // assertion above is satisfied by a corpus where nobody ever dissents.
      const [{ n }] = await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM mp_loyalty WHERE with_party < votes_cast`,
      );
      expect(
        Number(n),
        "no member has ever dissented — the complement is untested",
      ).toBeGreaterThan(500);
    },
  );

  // ⚠️ THE TWO DENOMINATORS ON THE CANDIDATE PAGE. mp_attendance.present counts every
  // non-absent cast; mp_loyalty.votes_cast counts only casts made WHILE AFFILIATED. They are
  // different definitions that currently produce the same number — 0 of 4,017,519 casts carry
  // a NULL party_id, so the filter is a no-op — and this pins that as a measured FACT rather
  // than a requirement.
  //
  // Both directions matter. Equality going away means the corpus grew unaffiliated casts, at
  // which point the two figures on the candidate page legitimately diverge and somebody
  // should read 182's header before deciding which is which. votes_cast EXCEEDING present is
  // impossible in either world: a member cannot vote while affiliated more often than they
  // voted at all.
  test.skipIf(skip)(
    "tracks mp_attendance.present, and never exceeds it",
    async () => {
      const [r] = await allRows<{ differ: string; total: string }>(
        `SELECT count(*) FILTER (WHERE l.votes_cast <> a.present)::text AS differ,
              count(*)::text AS total
         FROM mp_loyalty l
         JOIN mp_attendance a ON a.ns = l.ns AND a.mp_id = l.mp_id`,
      );
      expect(Number(r.total)).toBeGreaterThan(2000);
      expect(
        Number(r.differ),
        `${r.differ}/${r.total} members now have votes_cast <> mp_attendance.present. That is ` +
          `NOT a bug: it means the corpus has grown casts with a NULL party_id, which loyalty ` +
          `must exclude and attendance must not. Re-read 182's header, confirm the candidate ` +
          `page labels the two denominators distinctly, then update this expectation.`,
      ).toBe(0);
      const impossible = await allRows<{ ns: number; mp_id: number }>(
        `SELECT l.ns, l.mp_id FROM mp_loyalty l
         JOIN mp_attendance a ON a.ns = l.ns AND a.mp_id = l.mp_id
        WHERE l.votes_cast > a.present`,
      );
      expect(impossible, "affiliated casts exceed total casts").toEqual([]);
    },
  );

  // PARITY with the artifact it replaces, while that artifact is still on disk.
  test.skipIf(skip)(
    "reproduces loyalty.json, bar the duplicate casts",
    async () => {
      if (!existsSync(LOYALTY_JSON)) {
        console.warn("mp_loyalty: loyalty.json absent — parity arm skipped");
        return;
      }
      const file = JSON.parse(readFileSync(LOYALTY_JSON, "utf8")) as {
        byNs: Record<
          string,
          {
            entries: Array<{
              mpId: number;
              votesCast: number;
              withParty: number;
            }>;
          }
        >;
      };
      const rows = await allRows<{
        ns: number;
        mp_id: number;
        votes_cast: string;
        with_party: string;
      }>(
        `SELECT ns, mp_id, votes_cast::text, with_party::text FROM mp_loyalty`,
      );
      const pg = new Map(
        rows.map((r) => [
          `${r.ns}/${r.mp_id}`,
          [Number(r.votes_cast), Number(r.with_party)] as const,
        ]),
      );

      let compared = 0;
      let identical = 0;
      const missing: string[] = [];
      for (const [ns, slice] of Object.entries(file.byNs))
        for (const e of slice.entries) {
          const got = pg.get(`${ns}/${e.mpId}`);
          if (!got) {
            missing.push(`${ns}/${e.mpId}`);
            continue;
          }
          compared++;
          if (got[0] === e.votesCast && got[1] === e.withParty) identical++;
        }
      // Every member the artifact knows must exist here — a MISSING member is a page with no
      // loyalty figure, which the differences below are not.
      expect(missing, "loyalty.json has members mp_loyalty does not").toEqual(
        [],
      );
      expect(compared, "compared nothing").toBeGreaterThan(2000);
      // ⚠️ NOT an equality. 9 of 2,330 members legitimately differ, and Postgres is the
      // correct side: they are members of the 52nd carrying 9 DUPLICATE (item, mp) casts each
      // that the JSON counts twice and vote_cast_pkey collapses. The loader reports those 84
      // duplicates on every run. A floor rather than an exact count because the duplicate set
      // moves with the corpus — but a collapse would mean the derivation changed.
      expect(
        identical / compared,
        `only ${identical}/${compared} members match loyalty.json — more than the known ` +
          `duplicate-cast class`,
      ).toBeGreaterThan(0.99);
    },
  );
});
