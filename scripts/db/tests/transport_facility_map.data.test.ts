// Gate for the transport facility-map crosswalk (migration 132, gaps plan §5).
// The two ways a curated geo table goes quietly wrong: it drifts from the
// sector's EIK set (an entity added to TRANSPORT_ENTITIES never appears on the
// map, or a stale EIK lingers), and a row loses its point (the entity silently
// vanishes — transport_facility_map() drops NULL-loc rows). Also pins the
// Варна override: without it the map collapses to a single София pin, which
// was the original design's known weakness.
//
// Auto-skips ONLY when Postgres is down. An EMPTY crosswalk is an assertion
// failure, not a skip: the loader is unconditional in db:refresh and reads only
// committed inputs, so empty always means a defect — the cpv_catalog /
// contractor_rank convention, not the gitignored-input one.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { TRANSPORT_SECTOR_EIKS } from "../../../src/lib/transportReferenceData";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the crosswalk covers exactly the transport sector EIK set",
  async () => {
    const rows = await allRows<{ eik: string }>(
      "SELECT eik FROM transport_facility_geo",
    ).catch(() => [] as { eik: string }[]);
    assert.ok(
      rows.length > 0,
      "transport_facility_geo is empty or absent — the loader is unconditional in db:refresh with committed-only inputs, so this is always a defect",
    );
    assert.deepEqual(
      rows.map((r) => r.eik).sort(),
      [...TRANSPORT_SECTOR_EIKS].sort(),
      "transport_facility_geo has drifted from TRANSPORT_SECTOR_EIKS — re-run db:load:transport-facility-map:pg",
    );
  },
);

test.skipIf(skip)("every entity carries a point", async () => {
  const rows = await allRows<{ eik: string; name: string }>(
    "SELECT eik, name FROM transport_facility_geo WHERE lng IS NULL OR lat IS NULL",
  );
  assert.deepEqual(
    rows,
    [],
    "entities without coordinates vanish from the map silently",
  );
});

test.skipIf(skip)(
  "the Варна physical-facility override is in effect for the two maritime bodies",
  async () => {
    const rows = await allRows<{ eik: string; settlement: string }>(
      `SELECT eik, settlement FROM transport_facility_geo
        WHERE eik IN ('121797867', '130316140')
        ORDER BY eik`,
    );
    assert.equal(rows.length, 2);
    for (const r of rows)
      assert.equal(
        r.settlement,
        "Варна",
        `${r.eik}: the maritime body reverted to its Sofia registered seat — the map is a single pin again`,
      );
  },
);
