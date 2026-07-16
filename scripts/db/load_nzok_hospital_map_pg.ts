// Build the static НЗОК-hospital geo crosswalk (nzok_hospital_geo, schema
// 075_nzok_hospital_map.sql) that the health-pack hospital map is drawn from. SERVING
// loader — never writes JSON back. Mirrors load_water_operator_map_pg.ts: it resolves
// one HQ point per hospital EIK via the same bridge the by-settlement rollup uses:
//
//   EIK  ->  awarder_seats (buyer seat: ekatte · settlement · município · oblast)
//        ->  data/settlements.json centroid  ->  [lng, lat]
//
// The hospital universe is the set of EIKs present in nzok_hospital_payments (the same
// facilities the pack's payments tile ranks). The display name is the latest-period
// top-paid facility per EIK. Hospitals whose seat did not geo-resolve (many private
// clinics are not public buyers, so they carry no awarder_seats row) are stored with
// NULL lng/lat and omitted from the map by nzok_hospital_map(). Sofia (ekatte 68134)
// is pinned here — it has no settlements.json row — exactly as
// scripts/judiciary/__write_court_load.ts does.
//
// Run: `npm run db:load:nzok-hospital-map:pg` (local) / `:cloud` (Cloud SQL proxy).
// Must run AFTER db:load:awarder-seats:pg AND the НЗОК hospital-payments load (it
// reads awarder_seats + nzok_hospital_payments).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/075_nzok_hospital_map.sql",
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
interface Hospital {
  eik: string;
  name: string;
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

  // Hospital universe + display name: one row per EIK, labelled by the latest-period
  // top-paid facility (deterministic tiebreak on reg_no).
  const hospitals = await allRows<Hospital>(
    `WITH lp AS (SELECT max(period) AS p FROM nzok_hospital_payments)
     SELECT eik,
            (array_agg(name ORDER BY cumulative_eur DESC, reg_no))[1] AS name
       FROM nzok_hospital_payments
      WHERE period = (SELECT p FROM lp) AND eik IS NOT NULL
      GROUP BY eik`,
    [],
  );

  const eiks = hospitals.map((h) => h.eik);
  const seats = await allRows<Seat>(
    `SELECT eik, ekatte, settlement, municipality, oblast
       FROM awarder_seats WHERE eik = ANY($1)`,
    [eiks],
  );
  const seatByEik = new Map(seats.map((s) => [s.eik, s]));

  const rows = hospitals.map((hosp) => {
    const seat = seatByEik.get(hosp.eik);
    const loc = seat?.ekatte ? (locByEkatte.get(seat.ekatte) ?? null) : null;
    return {
      eik: hosp.eik,
      name: hosp.name,
      oblast: seat?.oblast ?? null,
      ekatte: seat?.ekatte ?? null,
      settlement: seat?.settlement ?? null,
      municipality: seat?.municipality ?? null,
      lng: loc ? loc[0] : null,
      lat: loc ? loc[1] : null,
    };
  });

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE nzok_hospital_geo");
    await copyRows(
      client,
      "nzok_hospital_geo",
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
    `nzok_hospital_geo: loaded ${rows.length} hospitals (${geocoded} geolocated, ` +
      `${rows.length - geocoded} without a point)`,
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
