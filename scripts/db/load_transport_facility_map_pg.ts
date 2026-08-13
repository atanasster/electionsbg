// Build the static transport-entity geo crosswalk (transport_facility_geo,
// schema 132_transport_facility_map.sql) that the /sector/transport marker map
// is drawn from. A SERVING loader — never writes JSON back. Mirrors
// load_mvr_directorate_map_pg.ts: one point per budget-unit EIK via
//
//   EIK  ->  awarder_seats (buyer seat: ekatte · settlement · município · oblast)
//        ->  data/settlements.json centroid  ->  [lng, lat]
//
// SEAT REALITY (derived in the map's caption too, never restated there): almost
// every МТС-group entity is Sofia-REGISTERED, so the seat bridge alone lands
// nearly everything on София. A small curated PHYSICAL-facility override pins
// ДППИ and ИА „Морска администрация" to Варна, where their actual operations
// sit. ⚠ Since the 2026-08-13 audit that is no longer the only non-Sofia point:
// ИАППД (000513106) is genuinely SEATED in Русе and needs no override — it
// resolves through awarder_seats, which makes db:load:awarder-seats:pg a hard
// prerequisite for its placement and not merely for the join. The map is София
// (12, paginating cluster) + Варна (2) + Русе (1). Networks (rail, roads) have
// no single point; АПИ roads are a separate sector (see transportReferenceData.ts).
//
// The entity universe is TRANSPORT_ENTITIES — the same constant the sector
// dashboard, browse pack and awarder-group endpoint use, so the map cannot
// drift from the sector definition (the audit-sectors lockstep rule). A row
// that resolves to no point is stored with NULL lng/lat and omitted from the
// map by transport_facility_map().
//
// Run: `npm run db:load:transport-facility-map:pg` (local) / `:cloud`.
// Must run AFTER db:load:awarder-seats:pg (it reads awarder_seats).
// This is the REBUILD of an uncommitted 2026-07-16 loader — see gaps plan §5.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, end } from "./lib/pg";
import {
  TRANSPORT_ENTITIES,
  TRANSPORT_SECTOR_EIKS,
} from "../../src/lib/transportReferenceData";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/132_transport_facility_map.sql",
);
const SETTLEMENTS = path.join(ROOT, "data/settlements.json");

// Sofia (the capital) is not a settlement row in settlements.json; pin its
// centre — same coordinate the МВР / court-load / water loaders use.
const SOFIA = "София";
const SOFIA_EKATTE = "68134";
const SOFIA_LOC: [number, number] = [23.3219, 42.6977];

// Curated physical-facility override: registered seat ≠ where the operation
// lives. These two maritime bodies are Sofia-registered but run out of Варна.
// The third maritime body (ИАППД) needs no entry — its registered seat IS Русе,
// so the awarder_seats bridge places it correctly on its own.
const FACILITY_TOWN: Record<string, string> = {
  "121797867": "Варна", // ИА „Морска администрация“
  "130316140": "Варна", // ДП „Пристанищна инфраструктура“
};

interface Settlement {
  ekatte: string;
  name: string;
  t_v_m: string;
  loc?: string;
}
interface Seat {
  eik: string;
  ekatte: string | null;
  settlement: string | null;
  municipality: string | null;
  oblast: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  const settlements = JSON.parse(
    readFileSync(SETTLEMENTS, "utf8"),
  ) as Settlement[];
  const locByEkatte = new Map<string, [number, number]>();
  const cityByName = new Map<
    string,
    { loc: [number, number]; ekatte: string }
  >();
  for (const s of settlements) {
    if (!s.loc) continue;
    const [lng, lat] = s.loc.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    locByEkatte.set(s.ekatte, [lng, lat]);
    // Towns only; first writer wins so a village sharing a city's name can't
    // clobber it.
    if (s.t_v_m === "гр." && !cityByName.has(norm(s.name)))
      cityByName.set(norm(s.name), { loc: [lng, lat], ekatte: s.ekatte });
  }
  locByEkatte.set(SOFIA_EKATTE, SOFIA_LOC);
  cityByName.set(norm(SOFIA), { loc: SOFIA_LOC, ekatte: SOFIA_EKATTE });

  const seats = await allRows<Seat>(
    `SELECT eik, ekatte, settlement, municipality, oblast
       FROM awarder_seats WHERE eik = ANY($1)`,
    [TRANSPORT_SECTOR_EIKS],
  );
  const seatByEik = new Map(seats.map((s) => [s.eik, s]));

  let viaOverride = 0;
  let viaSeat = 0;
  let viaPin = 0;
  const rows = TRANSPORT_ENTITIES.map((ent) => {
    const seat = seatByEik.get(ent.eik);
    const override = FACILITY_TOWN[ent.eik];
    if (override) {
      // The override wins over the (Sofia) registered seat — the point is the
      // physical operation, and oblast/municipality follow the town.
      const city = cityByName.get(norm(override)) ?? null;
      if (city) viaOverride++;
      return {
        eik: ent.eik,
        name: ent.name,
        universe: ent.universe,
        oblast: override,
        ekatte: city?.ekatte ?? null,
        settlement: override,
        municipality: override,
        lng: city?.loc[0] ?? null,
        lat: city?.loc[1] ?? null,
      };
    }
    const isSofiaSeat =
      !!seat?.oblast && seat.oblast.includes("София (столица)");
    let loc: [number, number] | null = null;
    let ekatte: string | null = null;
    let city: string | null = null;
    if (isSofiaSeat || !seat?.ekatte || !locByEkatte.has(seat.ekatte)) {
      // Every non-override entity is central (Sofia-registered); a seat that
      // resolved to a suburb — or did not resolve at all — still joins the
      // София cluster. Counted separately from real seat resolutions so a
      // future non-Sofia entity that fails to geo-resolve is visible in the
      // log instead of silently pinning to the capital.
      loc = SOFIA_LOC;
      ekatte = SOFIA_EKATTE;
      city = SOFIA;
      if (isSofiaSeat) viaSeat++;
      else viaPin++;
    } else {
      loc = locByEkatte.get(seat.ekatte) ?? null;
      ekatte = seat.ekatte;
      city = seat.settlement ?? null;
      if (loc) viaSeat++;
    }
    return {
      eik: ent.eik,
      name: ent.name,
      universe: ent.universe,
      // Sofia-pinned rows use the same seat spelling every awarder_seats-shaped
      // consumer expects — not a third "София" variant.
      oblast: seat?.oblast ?? "София (столица)",
      ekatte,
      settlement: city,
      municipality: seat?.municipality ?? (city === SOFIA ? "Столична" : null),
      lng: loc ? loc[0] : null,
      lat: loc ? loc[1] : null,
    };
  });

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE transport_facility_geo");
    for (const r of rows) {
      await client.query(
        `INSERT INTO transport_facility_geo
           (eik, name, universe, oblast, ekatte, settlement, municipality, lng, lat)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          r.eik,
          r.name,
          r.universe,
          r.oblast,
          r.ekatte,
          r.settlement,
          r.municipality,
          r.lng,
          r.lat,
        ],
      );
    }
    await client.query("COMMIT");
  });

  const geocoded = rows.filter((r) => r.lng != null).length;
  console.log(
    `transport_facility_geo: loaded ${rows.length} entities ` +
      `(${geocoded} geolocated — ${viaSeat} via seat, ${viaPin} pinned to София on a seat miss, ` +
      `${viaOverride} via the Варна override)`,
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
