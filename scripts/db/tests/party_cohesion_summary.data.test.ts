// party_cohesion_summary (181) — the per-(ns, party) rollup /parliament/cohesion and the
// dashboard tile render, and the two invariants Tier 3a rests on.
//
// Plan: docs/plans/json-retirement-v2.md Tier 3a.

import { afterAll, describe, expect, test } from "vitest";
import { allRows, end, dbReachable } from "../lib/pg";

const haveDb = await dbReachable();
const built = haveDb
  ? (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class
          WHERE relname = 'party_cohesion_summary' AND relkind = 'm'`,
      ).catch(() => [{ n: "0" }])
    )[0].n !== "0"
  : false;
const populated =
  built &&
  Number(
    (
      await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM party_cohesion_summary`,
      ).catch(() => [{ n: "0" }])
    )[0].n,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !built
    ? "181 not applied — run db:load:rollcall-derived:pg"
    : !populated
      ? "party_cohesion_summary is WITH NO DATA — run db:load:rollcall-derived:pg"
      : false;

afterAll(async () => {
  if (haveDb) await end();
});

describe("party_cohesion_summary", () => {
  test.skipIf(skip)("is non-vacuous and per-parliament", async () => {
    const [r] = await allRows<{ rows: string; parliaments: string }>(
      `SELECT count(*)::text AS rows, count(DISTINCT ns)::text AS parliaments
         FROM party_cohesion_summary`,
    );
    expect(Number(r.rows)).toBeGreaterThan(40);
    expect(Number(r.parliaments)).toBeGreaterThan(5);
  });

  // THE FOLD. The source renames a group mid-term — the 51st carries both `ГЕРБ - СДС` and
  // `ГЕРБ-СДС` under different party_id rows — and the route folds them at query time.
  // A median cannot be folded afterwards, so this matview has to do it, and the proof that
  // it did is that no parliament carries two rows whose labels differ only by spacing.
  test.skipIf(skip)("folds the mid-term spelling variants", async () => {
    // NOT "no two rows share a folded key" — the unique index forbids that, so asserting it
    // tests Postgres rather than the fold. The reachable failure is two rows whose LABELS
    // differ only by the spacing the fold is supposed to remove, which the index permits
    // because the keys would then differ too.
    const dupes = await allRows<{ ns: number; a: string; b: string }>(
      `SELECT x.ns, x.party_label AS a, y.party_label AS b
         FROM party_cohesion_summary x
         JOIN party_cohesion_summary y
           ON y.ns = x.ns AND y.party_label > x.party_label
          AND upper(replace(btrim(y.party_label), ' ', ''))
            = upper(replace(btrim(x.party_label), ' ', ''))`,
    );
    expect(
      dupes,
      "two rows differ only by spacing — the fold did not run",
    ).toEqual([]);
    // And the fold is genuinely doing work: at least one parliament must have FEWER summary
    // rows than it has distinct party_ids in party_cohesion, or the fold is a no-op and the
    // test above passes vacuously.
    const [r] = await allRows<{ folded: string }>(
      `SELECT count(*)::text AS folded FROM (
         SELECT c.ns FROM party_cohesion c
          GROUP BY c.ns
         HAVING count(DISTINCT c.party_id)
              > (SELECT count(*) FROM party_cohesion_summary s WHERE s.ns = c.ns)) x`,
    );
    expect(
      Number(r.folded),
      "no parliament has fewer summary rows than party_ids — the fold is a no-op",
    ).toBeGreaterThan(0);
  });

  // The two columns that DO fold must agree with party_cohesion, or the table and the chart
  // beside it disagree about the same group on the same page.
  test.skipIf(skip)(
    "agrees with party_cohesion on the foldable columns",
    async () => {
      const bad = await allRows<{
        ns: number;
        party: string;
        a: string;
        b: string;
      }>(
        `WITH series AS (
         SELECT c.ns,
                upper(replace(btrim(p.short), ' ', '')) AS party_key,
                sum(c.items) AS items,
                sum(c.cohesion * c.items) / NULLIF(sum(c.items), 0) AS mean
           FROM party_cohesion c JOIN party_dim p ON p.party_id = c.party_id
          GROUP BY 1, 2)
       SELECT s.ns, s.party_key AS party,
              s.items::text AS a, y.items_covered::text AS b
         FROM series s JOIN party_cohesion_summary y
           ON y.ns = s.ns AND y.party_key = s.party_key
        WHERE s.items <> y.items_covered
           OR abs(s.mean - y.mean_cohesion) > 0.0001`,
      );
      expect(bad, "the summary and the series disagree").toEqual([]);
      // The comparison above is an INNER JOIN: with a fold that produced different keys on
      // the two sides it would match nothing and pass. Assert it compared a real corpus.
      const [{ n }] = await allRows<{ n: string }>(
        `WITH series AS (
           SELECT c.ns, upper(replace(btrim(p.short), ' ', '')) AS party_key
             FROM party_cohesion c JOIN party_dim p ON p.party_id = c.party_id
            GROUP BY 1, 2)
         SELECT count(*)::text AS n
           FROM series s JOIN party_cohesion_summary y
             ON y.ns = s.ns AND y.party_key = s.party_key`,
      );
      expect(
        Number(n),
        "the summary and the series share no keys — the two folds have diverged",
      ).toBeGreaterThan(40);
    },
  );

  test.skipIf(skip)(
    "every rendered column is present and in range",
    async () => {
      const bad = await allRows<{ ns: number; party_label: string }>(
        `SELECT ns, party_label FROM party_cohesion_summary
        WHERE party_label IS NULL
           OR items_covered <= 0
           OR mean_cohesion   NOT BETWEEN 0 AND 1
           OR median_cohesion NOT BETWEEN 0 AND 1
           OR members_tracked <= 0`,
      );
      expect(bad, "a rendered column is null or out of range").toEqual([]);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE ATTENDANCE PARTY INVARIANT.
//
// /api/db/mp-attendance labels each member from mp_seat -> party_dim, while the retired
// attendance.json kept "the most-recently-seen party" from the day files. Those are the same
// answer ONLY because mp_seat.party_id happens to equal each member's latest cast-time party
// — measured 0 drift across 2,366 seats — and that is a property of how load_rollcall_pg
// builds the seat, not a constraint anything enforces.
//
// If it ever breaks, up to 179 members get a party chip naming a group they had already left,
// on a page that ranks them BY party. Nothing else would notice: the counts stay right.
// ⚠️ Gated on the CORPUS, not on 181. This block is about vote_cast and mp_seat and has
// nothing to do with party_cohesion_summary — sharing `skip` would silently stop checking the
// attendance route's party labels on any database where 181 merely had not been refreshed.
const seatSkip = !haveDb ? "Postgres unreachable" : false;

describe("mp_seat party labelling", () => {
  test.skipIf(seatSkip)(
    "equals each member's latest cast-time party",
    async () => {
      const [r] = await allRows<{ differ: string; total: string }>(
        `WITH latest AS (
         SELECT DISTINCT ON (c.ns, c.mp_id) c.ns, c.mp_id, c.party_id
           FROM vote_cast c JOIN vote_item i ON i.item_id = c.item_id
          ORDER BY c.ns, c.mp_id, i.date DESC, i.item_no DESC)
       SELECT count(*) FILTER (WHERE s.party_id IS DISTINCT FROM l.party_id)::text AS differ,
              count(*)::text AS total
         FROM latest l JOIN mp_seat s ON s.ns = l.ns AND s.mp_id = l.mp_id`,
      );
      expect(Number(r.total), "no seats to compare").toBeGreaterThan(2000);
      expect(
        Number(r.differ),
        `${r.differ}/${r.total} seats carry a party_id that is NOT the member's latest ` +
          `cast-time party — /api/db/mp-attendance's chips are now wrong for them, and the ` +
          `route must join vote_cast instead of mp_seat`,
      ).toBe(0);
    },
  );

  // The converse, so the assertion above cannot be satisfied by a corpus where nobody ever
  // changes party: mid-term switches DO exist, which is why per-ITEM aggregates must group
  // on vote_cast.party_id and not on the seat.
  test.skipIf(seatSkip)(
    "mid-term switches exist, so the seat is not a per-item basis",
    async () => {
      const [r] = await allRows<{ n: string }>(
        `SELECT count(*)::text AS n FROM (
         SELECT c.ns, c.mp_id
           FROM vote_cast c JOIN mp_seat s ON s.ns = c.ns AND s.mp_id = c.mp_id
          WHERE c.party_id IS DISTINCT FROM s.party_id
          GROUP BY 1, 2) x`,
      );
      expect(
        Number(r.n),
        "no seat ever votes under a party other than its own — the invariant above is vacuous",
      ).toBeGreaterThan(50);
    },
  );
});
