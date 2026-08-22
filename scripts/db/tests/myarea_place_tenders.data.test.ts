// myarea_place_tenders() (179) — the My-Area "открити поръчки тук" tile, which replaced the
// 265-file data/myarea/place_tenders/<obshtina>.json shard family in json-retirement-v2
// Tier 4a.
//
// The shards are the specification here, so where they still exist on disk this file
// compares against them directly. That is deliberately temporary — they stop being written
// by this same change — so every assertion degrades to a shape/invariant check when they are
// gone, rather than silently passing on an empty comparison.

import { afterAll, describe, expect, test } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, end, dbReachable } from "../lib/pg";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SHARD_DIR = path.join(REPO, "data/myarea/place_tenders");

const haveDb = await dbReachable();
const skip = haveDb ? false : "Postgres unreachable";

afterAll(async () => {
  if (haveDb) await end();
});

interface Row {
  obshtina: string;
  since: string;
  total_count: string;
  cancelled_count: string;
  total_estimated_eur: number;
  top: Array<{
    unp: string;
    buyer_name: string | null;
    estimated_value_eur: number | null;
    publication_date: string;
    is_cancelled: boolean;
  }>;
}

const call = async (obshtina: string): Promise<Row | undefined> =>
  (
    await allRows<Row>(
      `SELECT obshtina, since, total_count, cancelled_count,
              total_estimated_eur, top
         FROM myarea_place_tenders($1)`,
      [obshtina],
    )
  )[0];

const shardKeys = (): string[] =>
  existsSync(SHARD_DIR)
    ? readdirSync(SHARD_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
    : [];

describe("myarea_place_tenders", () => {
  test.skipIf(skip)("answers for every município that has a page", async () => {
    const codes = await allRows<{ code: string }>(
      `SELECT code FROM place_dim WHERE kind = 'obshtina' AND seat_ekatte IS NOT NULL`,
    );
    expect(codes.length).toBeGreaterThan(250);
    // A handful of the largest, rather than all 288 — the point is that the function
    // RETURNS for a real code, and the parity test below covers breadth.
    for (const { code } of codes.slice(0, 12)) {
      const r = await call(code);
      expect(r, code).toBeDefined();
      expect(r!.obshtina, code).toBe(code);
    }
  });

  // THE SEAT CROSSWALK IS THE THING MOST LIKELY TO SILENTLY REGRESS. `seat_ekatte` (117) is
  // not derivable from `obshtina_code`, and the plausible substitute — every settlement in
  // the obshtina — zeroes 28 municipalities, 24 of them Sofia/Plovdiv rayons whose municipal
  // buyer really is the parent city's община. That failure is invisible per-município (a
  // legitimately quiet município also reports zero), so it is asserted in aggregate.
  test.skipIf(skip)("the seat crosswalk resolves the rayons", async () => {
    const rayons = await allRows<{ code: string }>(
      `SELECT code FROM place_dim
        WHERE kind = 'obshtina' AND code LIKE 'S2%' AND seat_ekatte IS NOT NULL
        ORDER BY code`,
    );
    expect(rayons.length).toBeGreaterThan(20);
    const answered = [];
    for (const { code } of rayons) {
      const r = await call(code);
      if (r && Number(r.total_count) > 0) answered.push(code);
    }
    // Every Sofia rayon shares Столична община's seat, so either they all resolve or the
    // crosswalk is broken. Asserted as a SHARE so a genuinely quiet corpus is not a failure.
    expect(
      answered.length,
      `only ${answered.length}/${rayons.length} rayons resolved a buyer — seat_ekatte likely regressed to obshtina_code`,
    ).toBeGreaterThan(rayons.length * 0.5);
  });

  // INDEPENDENT RE-DERIVATION, not a comparison against the shards.
  //
  // The shards WERE the specification, and this arm compared against all 286 of them while
  // they existed (measured 2026-08-21: identical on since/count/cancelled; 43 differed in
  // total only, every one a same-day tie at the per-buyer cap that the old builder broke by
  // ingest order — 179's header carries the worked example). They were git-TRACKED and were
  // deleted by the same change that added this file, so that arm would now be a permanently
  // green no-op reading an empty directory.
  //
  // This recomputes the answer in TypeScript from the base tables instead — a second
  // implementation of the same rule rather than a second reading of the same SQL, which is
  // what makes a disagreement mean something. It re-derives the corpus anchor, the per-buyer
  // cap and the cancelled split independently of the function's CTEs.
  test.skipIf(skip)("agrees with an independent re-derivation", async () => {
    const [{ since }] = await allRows<{ since: string }>(
      `SELECT to_char(max(publication_date)::date - 180, 'YYYY-MM-DD') AS since FROM tenders`,
    );
    const codes = (
      await allRows<{ code: string }>(
        `SELECT pd.code
           FROM place_dim pd
           JOIN awarder_seats s ON s.ekatte = pd.seat_ekatte
            AND s.source = 'geo' AND s.is_local_hq AND s.tier = 'municipal'
          WHERE pd.kind = 'obshtina'
          GROUP BY pd.code ORDER BY pd.code`,
      )
    ).map((r) => r.code);
    expect(
      codes.length,
      "no município resolves a municipal buyer",
    ).toBeGreaterThan(200);

    let compared = 0;
    const bad: string[] = [];
    for (const code of codes.slice(0, 80)) {
      // Every candidate row for this município's buyers, UNCAPPED and unordered by the
      // database — the cap and the ordering are applied here, in JS.
      const rows = await allRows<{
        buyer_eik: string;
        unp: string;
        publication_date: string;
        estimated_value_eur: number | null;
        is_cancelled: boolean;
      }>(
        `SELECT t.buyer_eik, t.unp, t.publication_date, t.estimated_value_eur, t.is_cancelled
           FROM place_dim pd
           JOIN awarder_seats s ON s.ekatte = pd.seat_ekatte
            AND s.source = 'geo' AND s.is_local_hq AND s.tier = 'municipal'
           JOIN tenders t ON t.buyer_eik = s.eik AND t.publication_date >= $2
          WHERE pd.kind = 'obshtina' AND pd.code = $1`,
        [code, since],
      );
      const byBuyer = new Map<string, typeof rows>();
      for (const r of rows) {
        const a = byBuyer.get(r.buyer_eik) ?? [];
        a.push(r);
        byBuyer.set(r.buyer_eik, a);
      }
      const capped = [...byBuyer.values()].flatMap((a) =>
        a
          .sort(
            (x, y) =>
              y.publication_date.localeCompare(x.publication_date) ||
              y.unp.localeCompare(x.unp),
          )
          .slice(0, 6),
      );
      const live = capped.filter((t) => !t.is_cancelled);
      const expected = {
        count: live.length,
        cancelled: capped.length - live.length,
        total: live.reduce((n, t) => n + (t.estimated_value_eur ?? 0), 0),
      };

      const r = await call(code);
      const got = r
        ? {
            count: Number(r.total_count),
            cancelled: Number(r.cancelled_count),
            total: Number(r.total_estimated_eur),
          }
        : { count: 0, cancelled: 0, total: 0 };
      compared++;
      if (
        got.count !== expected.count ||
        got.cancelled !== expected.cancelled ||
        Math.abs(got.total - expected.total) > 0.01
      )
        bad.push(
          `${code}: expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}`,
        );
    }
    expect(compared, "compared nothing").toBeGreaterThan(50);
    expect(
      bad,
      "the function disagrees with an independent re-derivation",
    ).toEqual([]);
  });

  // Every invariant here is one the tile renders directly, so a violation is a wrong number
  // on a page rather than an internal inconsistency.
  test.skipIf(skip)("the payload is internally consistent", async () => {
    const keys = shardKeys();
    const codes = keys.length
      ? keys
      : (
          await allRows<{ code: string }>(
            `SELECT code FROM place_dim WHERE kind = 'obshtina' AND seat_ekatte IS NOT NULL LIMIT 40`,
          )
        ).map((r) => r.code);
    let checked = 0;
    for (const k of codes.slice(0, 60)) {
      const r = await call(k);
      if (!r || Number(r.total_count) === 0) continue;
      checked++;
      // `top` is the top FIVE, so it can never exceed the count it is drawn from.
      expect(r.top.length, `${k}: top longer than count`).toBeLessThanOrEqual(
        Math.min(5, Number(r.total_count)),
      );
      // A cancelled procedure is not a forecast — it is counted separately and must not
      // reach `top` or the total.
      expect(
        r.top.filter((t) => t.is_cancelled),
        `${k}: a cancelled procedure reached top`,
      ).toEqual([]);
      // Descending by value, which is what the tile claims to show.
      const vals = r.top.map((t) => t.estimated_value_eur ?? -1);
      expect(
        [...vals].sort((a, b) => b - a),
        `${k}: top is not value-sorted`,
      ).toEqual(vals);
      // Every row is inside the declared window — the label above the tile.
      for (const t of r.top)
        expect(
          t.publication_date >= r.since,
          `${k}: ${t.unp} predates the declared window`,
        ).toBe(true);
    }
    // Without this the whole loop is vacuous the moment every município returns nothing —
    // which is exactly the state a broken seat crosswalk produces.
    expect(
      checked,
      "no município had a populated tile to check",
    ).toBeGreaterThan(10);
  });

  // MUTATION CHECK. The parity assertion above is satisfied by any implementation that
  // happens to agree on the aggregates, including one whose per-buyer cap has silently gone
  // away — because for the ~250 municípios with a single quiet buyer, capped and uncapped
  // are the same set. Re-derive one busy município BOTH ways and require them to differ.
  test.skipIf(skip)("the per-buyer cap still bites", async () => {
    const [busy] = await allRows<{ code: string; uncapped: string }>(
      `SELECT pd.code,
              count(*) AS uncapped
         FROM place_dim pd
         JOIN awarder_seats s ON s.ekatte = pd.seat_ekatte
          AND s.source = 'geo' AND s.is_local_hq AND s.tier = 'municipal'
         JOIN tenders t ON t.buyer_eik = s.eik
          AND t.publication_date >= (SELECT to_char(max(publication_date)::date - 180, 'YYYY-MM-DD') FROM tenders)
        WHERE pd.kind = 'obshtina'
        GROUP BY pd.code
        ORDER BY count(*) DESC
        LIMIT 1`,
    );
    expect(busy, "no município has tenders in the window").toBeDefined();
    const r = await call(busy.code);
    expect(
      Number(r!.total_count) + Number(r!.cancelled_count),
      `${busy.code}: capped total equals the uncapped ${busy.uncapped} — RECENT_PER_BUYER is not being applied`,
    ).toBeLessThan(Number(busy.uncapped));
  });
});
