// The I/O half of "is the committed override map published to this database" —
// the pieces the local data test (scripts/db/tests/awarder_seats_freshness.data.test.ts)
// and the operator CLI (verify_awarder_seats.ts) must agree on exactly.
//
// Separate from awarder_geo_merge.ts on purpose: that module is PURE and a test
// asserts it imports nothing, which is what lets the comparison rule be unit-
// tested. This file reads the filesystem, so it cannot live there. It holds no
// rule — only the artifact path, the query, and the floor.
//
// Why single-sourced rather than copied into both callers: the two answer the
// same question about two different databases, and a divergence would be
// invisible in the direction that matters. If the query is ever narrowed (a
// `source` arm, a join) or the floor retuned in one copy, the other keeps
// reporting on a shape that no longer ships — and the CLI is the ONLY thing that
// ever looks at production.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GeoEntry, SeatsDrift } from "./awarder_geo_merge";

export const MAP_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/procurement/awarder_geo_overrides.json",
);

// A floor, never an equality — see the contract on SeatsDrift.checked. It
// separates "nothing was compared" from "nothing is wrong", and is deliberately
// far below the ~2,174 the map holds (matching the sibling artifact gate's own
// `> 1000`). It must NOT become a size ratchet: SHRINK_TOLERANCE lets one build
// lose 5% of the map legitimately, so a floor just under today's count would
// fail on ordinary churn while adding nothing to the vacuity guarantee.
export const CHECKED_FLOOR = 1_000;

// ONE definition of the query both callers run — including the data test's
// mutation check, which must execute it on its own transaction client.
export const SEATS_SQL =
  "SELECT eik, ekatte FROM awarder_seats WHERE eik = ANY($1::text[])";

export type SeatRow = { eik: string; ekatte: string | null };

export const toSeats = (rows: SeatRow[]): Map<string, string | null> =>
  new Map(rows.map((r) => [r.eik, r.ekatte]));

export const loadMap = (): Record<string, GeoEntry> => {
  const j = JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) as {
    awarders?: Record<string, GeoEntry>;
  };
  // Named rather than left to `Object.keys(undefined)`, whose TypeError is the
  // least informative possible failure for exactly this scenario.
  if (!j.awarders || typeof j.awarders !== "object")
    throw new Error(
      `${MAP_FILE} has no \`awarders\` block — the artifact's shape changed, or ` +
        `the file is truncated. Re-run: npx tsx scripts/procurement/awarder_geo_map.ts`,
    );
  return j.awarders;
};

/** Why a drift report cannot be trusted, or null when it can.
 *
 *  THE VACUITY VECTOR, and it points at the map rather than the database. An
 *  empty `awarder_seats` is loud — every entry lands in `missing`. An empty,
 *  truncated or shape-drifted MAP is silent: both arms come back clean and the
 *  caller reports a healthy publish for a file it never read. Every consumer
 *  must run this before believing an all-clear. */
export const vacuityReason = (
  drift: SeatsDrift,
  mapEntries: number,
): string | null => {
  if (mapEntries <= CHECKED_FLOOR)
    return (
      `${MAP_FILE} holds ${mapEntries} entries, at or below the ${CHECKED_FLOOR} ` +
      `floor — too few to conclude anything. Re-run: npx tsx scripts/procurement/awarder_geo_map.ts`
    );
  if (drift.checked <= CHECKED_FLOOR)
    return (
      `only ${drift.checked} of ${mapEntries} map entries carry an ekatte and ` +
      `could be compared — the artifact is malformed rather than unpublished. ` +
      `Re-run: npx tsx scripts/procurement/awarder_geo_map.ts`
    );
  return null;
};
