// Build the static ВиК-operator geo crosswalk (water_operator_geo, schema
// 073_water_operator_map.sql) that the /water operator map is drawn from. SERVING
// loader — never writes JSON back; the map's metric comes LIVE from the contracts
// corpus per scope, so there is no per-water dataset to ingest here. Twin of
// load_nzok_hospital_map_pg.ts / load_mvr_directorate_map_pg.ts.
//
// It resolves one HQ point per operator EIK via the same bridge the by-settlement
// rollup uses:
//
//   EIK  ->  awarder_seats (buyer seat: ekatte · settlement · município · oblast)
//        ->  data/settlements.json centroid  ->  [lng, lat]
//
// The operator universe is the hand-curated WATER_SECTOR_EIKS constant; the display
// name is its canonical vikReferenceData label. Operators whose seat did not
// geo-resolve (a handful of small municipal operators) are stored with NULL lng/lat
// and omitted from the map by water_operator_map(). Sofia (ekatte 68134) is pinned
// here — it has no settlements.json row — exactly as scripts/judiciary/__write_court_load.ts.
//
// Run: `npm run db:load:water-operator-map:pg` (local) / `:cloud` (Cloud SQL proxy).
// Must run AFTER db:load:awarder-seats:pg (it reads awarder_seats).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  WATER_SECTOR_EIKS,
  operatorByEik,
} from "../../src/lib/vikReferenceData";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/073_water_operator_map.sql",
);
const SETTLEMENTS = path.join(ROOT, "data/settlements.json");

// Sofia (the capital) is not a settlement row in settlements.json; pin its centre —
// same coordinate the court-load writer uses.
const SOFIA_EKATTE = "68134";
const SOFIA_LOC: [number, number] = [23.3219, 42.6977];

interface Settlement {
  ekatte: string;
  loc?: string;
}
interface Seat {
  eik: string;
  ekatte: string | null;
  settlement: string | null;
  municipality: string | null;
  oblast: string | null;
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  // ekatte -> [lng, lat] from settlements.json, plus the Sofia pin.
  const settlements = JSON.parse(
    readFileSync(SETTLEMENTS, "utf8"),
  ) as Settlement[];
  const locByEkatte = new Map<string, [number, number]>();
  for (const s of settlements) {
    if (!s.loc) continue;
    const [lng, lat] = s.loc.split(",").map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat))
      locByEkatte.set(s.ekatte, [lng, lat]);
  }
  locByEkatte.set(SOFIA_EKATTE, SOFIA_LOC);

  // Resolved buyer seats for exactly the operator universe.
  const seats = await allRows<Seat>(
    `SELECT eik, ekatte, settlement, municipality, oblast
       FROM awarder_seats WHERE eik = ANY($1)`,
    [WATER_SECTOR_EIKS],
  );
  const seatByEik = new Map(seats.map((s) => [s.eik, s]));

  const rows = WATER_SECTOR_EIKS.map((eik) => {
    const op = operatorByEik(eik);
    const seat = seatByEik.get(eik);
    const loc = seat?.ekatte ? (locByEkatte.get(seat.ekatte) ?? null) : null;
    return {
      eik,
      name: op?.name ?? `ЕИК ${eik}`,
      // Prefer the resolved seat's oblast; fall back to the curated one.
      oblast: seat?.oblast ?? op?.oblast ?? null,
      ekatte: seat?.ekatte ?? null,
      settlement: seat?.settlement ?? null,
      municipality: seat?.municipality ?? null,
      lng: loc ? loc[0] : null,
      lat: loc ? loc[1] : null,
    };
  });

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE water_operator_geo");
    await copyRows(
      client,
      "water_operator_geo",
      [
        "eik",
        "name",
        "oblast",
        "ekatte",
        "settlement",
        "municipality",
        "lng",
        "lat",
      ],
      (function* () {
        for (const r of rows)
          yield [
            r.eik,
            r.name,
            r.oblast,
            r.ekatte,
            r.settlement,
            r.municipality,
            r.lng,
            r.lat,
          ];
      })(),
    );
    await client.query("COMMIT");
  });

  const geocoded = rows.filter((r) => r.lng != null).length;
  console.log(
    `water_operator_geo: loaded ${rows.length} operators (${geocoded} geolocated, ` +
      `${rows.length - geocoded} without a point)`,
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
