// Is the committed override map actually PUBLISHED?
//
// `data/procurement/awarder_geo_overrides.json` decides where an address-less
// procurement buyer sits, and it reaches the site through three hops of which
// only the first two are gated:
//
//   awarder_geo_map.ts  →  awarder_geo_overrides.json   ← awarder_geo_overrides.test.ts
//        ↓ buildRollups (rollups.ts loadGeoOverrides, FILL-MISSING)
//   data/procurement/awarders/*.json (geo.ekatte)       ← gitignored, no gate
//        ↓ db:load:awarder-seats:pg[:cloud]
//   awarder_seats                                       ← THIS FILE
//
// A map rebuilt and never loaded is otherwise invisible: the artifact's own
// invariants hold, every tier says `ok`, `lastFreshAt` is today, row counts
// reconcile — and the site keeps serving the previous placements at a 200.
// Measured 2026-08-24: prod kept ЕИК 106633686 in Дърманци (24668) for hours
// after the map said Мездра (47714). The failure names a real place, which is
// what makes it quiet: the wrong municipality looks exactly as plausible as the
// right one. Plan: docs/plans/awarder-seats-freshness-gate-v1.md.
//
// The rule itself is `compareSeatsToMap`, pure and unit-tested next to the
// merge; this file is the thin Postgres caller.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { allRows, dbReachable, end, pinLocalDatabase, withTx } from "../lib/pg";
import {
  compareSeatsToMap,
  type GeoEntry,
} from "../../procurement/awarder_geo_merge";

// LOCAL, always. `scripts/db/lib/pg.ts` documents the recurring hazard of a
// Cloud SQL proxy target left in the shell, and graph.data.test.ts has already
// produced one false "prod is broken" reading from exactly that. The cloud side
// is checked deliberately, by `npm run proc:verify-seats:cloud`, never here — a
// test that connects to prod would skip whenever the proxy is down, which is
// most of the time and always in CI, so it would be vacuous precisely when
// relied upon while LOOKING like production coverage.
pinLocalDatabase();

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MAP_FILE = path.join(ROOT, "data/procurement/awarder_geo_overrides.json");

// A floor rather than an equality — see the contract on SeatsDrift.checked for
// why `checked === Object.keys(map).length` is the wrong assertion (it is
// 0 === 0 on an empty map, the one state this guards).
//
// Deliberately FAR below the 2,174 the map holds, and matching the sibling
// artifact gate's own `> 1000`. This exists to separate "nothing was compared"
// from "nothing is wrong" — it is not a size ratchet, and must not become one:
// SHRINK_TOLERANCE lets a single build lose 5% of the map legitimately, so a
// floor set just under today's count would fail on ordinary churn while adding
// nothing to the vacuity guarantee.
const CHECKED_FLOOR = 1_000;

const loadMap = (): Record<string, GeoEntry> => {
  const j = JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) as {
    awarders?: Record<string, GeoEntry>;
  };
  // Named rather than left to `Object.keys(undefined)`, whose TypeError is the
  // least informative possible failure for the one scenario this file is about.
  if (!j.awarders || typeof j.awarders !== "object")
    throw new Error(
      `${MAP_FILE} has no \`awarders\` block — the artifact's shape changed, or ` +
        `the file is truncated. Re-run: npx tsx scripts/procurement/awarder_geo_map.ts`,
    );
  return j.awarders;
};

// The repo's convention for a rollback sentinel (db_table_sort_indexes.data.test.ts),
// preferred over a string message: this callback writes to a REAL serving table,
// and an `e.message === "rollback"` comparison silently stops matching the day
// anyone rewords it — at which point the throw propagates as a genuine failure
// or, worse, a refactor turns it into a clean return and the tx COMMITS.
class Rollback extends Error {}

// ONE definition of the query the gate actually runs. The mutation check below
// must execute it on its own transaction client, so without this it would be a
// second copy — and a later narrowing of the real query (a `source` arm, a join)
// would leave the mutation check exercising a shape that no longer ships, which
// is exactly the "two implementations that both forgot the filter" trap.
const SEATS_SQL =
  "SELECT eik, ekatte FROM awarder_seats WHERE eik = ANY($1::text[])";

type SeatRow = { eik: string; ekatte: string | null };

const toSeats = (rows: SeatRow[]): Map<string, string | null> =>
  new Map(rows.map((r) => [r.eik, r.ekatte]));

/** eik → ekatte for exactly the buyers the map names. Restricted in SQL rather
 *  than in JS so the ~1,707 address-derived / curated / name-parsed rows never
 *  cross the boundary — the map is applied fill-missing and does not speak for
 *  them. */
const seatsFor = async (eiks: string[]): Promise<Map<string, string | null>> =>
  toSeats(await allRows<SeatRow>(SEATS_SQL, [eiks]));

const up = await dbReachable();

afterAll(async () => {
  await end();
});

describe.skipIf(!up)(
  "awarder_seats agrees with the committed override map",
  () => {
    it("compared the whole map — not a map that failed to load", () => {
      // Arm 3, and the one that keeps the other two honest. Both arms come back
      // empty for an empty or unparseable map, so without a floor here the gate
      // reports a clean bill of health on a file it never read.
      const map = loadMap();
      expect(Object.keys(map).length).toBeGreaterThan(CHECKED_FLOOR);
    });

    it("publishes every buyer the map names, at the EKATTE the map names", async () => {
      const map = loadMap();
      const drift = compareSeatsToMap(map, await seatsFor(Object.keys(map)));

      expect(drift.checked).toBeGreaterThan(CHECKED_FLOOR);
      const fix =
        "\nThe map has been rebuilt without publishing it, or vice versa. Re-run BOTH:\n" +
        "  npx tsx scripts/procurement/awarder_geo_map.ts && npx tsx scripts/procurement/rebuild_from_cache.ts\n" +
        "  npm run db:load:awarder-seats:pg\n" +
        "and for production: npm run db:load:awarder-seats:pg:cloud\n" +
        "(`npm run proc:verify-seats:cloud` checks prod without reloading it.)";

      expect(
        drift.missing,
        `${drift.missing.length} buyer(s) in the map have no awarder_seats row.${fix}`,
      ).toEqual([]);
      expect(
        drift.disagreeing,
        `awarder_seats disagrees with the map on ${drift.disagreeing.length} buyer(s):\n` +
          drift.disagreeing
            .slice(0, 10)
            .map((d) => `  ${d.eik}  map ${d.map}  seats ${d.seats}`)
            .join("\n") +
          fix,
      ).toEqual([]);
    });

    it("still discriminates — a moved seat is caught", async () => {
      // The mutation check. "0 disagreements" is satisfiable by any query that
      // quietly returns nothing, which is exactly how a gate like this goes
      // vacuous. Rolled back, so the corpus is untouched — and deliberately NOT
      // done by editing the committed artifact, which another process may commit.
      const map = loadMap();
      // The probe must be a buyer that HAS a seats row. Picking blind (the first
      // key by sort order) blames the comparator for a corpus defect: on a
      // database where that buyer is unpublished the UPDATE matches nothing, no
      // disagreement appears, and the test fails saying "the comparison is not
      // discriminating" — false, and it fires on precisely the `missing` shape the
      // gate primarily exists to report.
      const published = await seatsFor(Object.keys(map));
      const eik = [...published.entries()]
        .filter(([, ekatte]) => ekatte != null)
        .map(([e]) => e)
        .sort()[0];
      expect(
        eik,
        "no map buyer has a published seat — nothing to mutate; the gate above " +
          "has already reported this as `missing`",
      ).toBeDefined();

      let rolledBack = false;
      await withTx(async (client) => {
        const updated = await client.query(
          "UPDATE awarder_seats SET ekatte = '00000' WHERE eik = $1",
          [eik],
        );
        // Proves the probe LANDED. Without it a zero-row UPDATE produces the same
        // "no disagreement" result as a broken comparator.
        expect(updated.rowCount, `probe UPDATE matched no row for ${eik}`).toBe(
          1,
        );

        const drift = compareSeatsToMap(
          map,
          toSeats(
            (await client.query<SeatRow>(SEATS_SQL, [Object.keys(map)])).rows,
          ),
        );
        // CONTAINMENT, not equality. Equality would also assert the corpus is
        // otherwise clean — which is the job of the test above — so on a genuinely
        // drifted corpus BOTH arms fail, turning one real defect into two failures
        // and burying the actionable one. This arm has exactly one question: does a
        // seat we moved show up?
        expect(
          drift.disagreeing,
          "the mutated seat did not surface — the comparison is not discriminating",
        ).toContainEqual({ eik, map: map[eik].ekatte, seats: "00000" });
        throw new Rollback();
      }).catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e;
        rolledBack = true;
      });

      // The rollback is the whole safety story for a test that writes to a serving
      // table, so it is asserted rather than assumed — a refactor that returns
      // cleanly instead of throwing would COMMIT the mutation, and every assertion
      // above would still pass.
      expect(rolledBack, "the transaction did not roll back").toBe(true);
      expect(
        (await seatsFor([eik])).get(eik),
        `the probe leaked — ${eik} is still mutated in awarder_seats`,
      ).toBe(map[eik].ekatte);
    });
  },
);
