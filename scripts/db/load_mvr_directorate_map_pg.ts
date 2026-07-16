// Build the static МВР-structure geo crosswalk (mvr_directorate_geo, schema
// 074_mvr_directorate_map.sql) that the /sector/security (Полиция / МВР) marker map
// is drawn from. A SERVING loader — never writes JSON back. It resolves one HQ point
// per budget-unit EIK via the same bridge the by-settlement rollup + water-operator
// map use:
//
//   EIK  ->  awarder_seats (buyer seat: ekatte · settlement · município · oblast)
//        ->  data/settlements.json centroid  ->  [lng, lat]
//
// FALLBACK: awarder_seats resolves only ~53 of the 74 units — most of the 28 ОДМВР
// and 28 РДПБЗН regional directorates never geo-resolved. Rather than drop them, the
// entity NAME gives the town unambiguously ("ОДМВР — Пловдив" / "РДПБЗН — Пловдив" ->
// Пловдив; everything central -> София), so we geocode the fallback by the oblast
// capital's name against settlements.json. This mirrors how __write_court_load.ts
// geocodes courts by their town name. София (столица) seats are pinned to the София
// centre so a suburb-resolved central body (e.g. a seat that resolved to Герман)
// still joins the София cluster.
//
// The unit universe is the hand-curated MVR_ENTITIES constant. A unit that resolves
// to neither a seat centroid nor a capital is stored with NULL lng/lat and omitted
// from the map by mvr_directorate_map().
//
// Run: `npm run db:load:mvr-directorate-map:pg` (local) / `:cloud` (Cloud SQL proxy).
// Must run AFTER db:load:awarder-seats:pg (it reads awarder_seats).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, end } from "./lib/pg";
import {
  MVR_ENTITIES,
  securityEntityByEik,
  SECURITY_SECTOR_EIKS,
} from "../../src/lib/securityReferenceData";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/074_mvr_directorate_map.sql",
);
const SETTLEMENTS = path.join(ROOT, "data/settlements.json");

// Sofia (the capital) is not a settlement row in settlements.json; pin its centre —
// same coordinate the court-load writer / water-operator loader use.
const SOFIA = "София";
const SOFIA_EKATTE = "68134";
const SOFIA_LOC: [number, number] = [23.3219, 42.6977];

// The 28 oblast capitals (Sofia handled via the pin above) — a regional directorate
// (ОДМВР / РДПБЗН) sits in one of these, named right in its entity label.
const OBLAST_CAPITALS = [
  "Благоевград", "Бургас", "Варна", "Велико Търново", "Видин", "Враца",
  "Габрово", "Добрич", "Кърджали", "Кюстендил", "Ловеч", "Монтана",
  "Пазарджик", "Перник", "Плевен", "Пловдив", "Разград", "Русе", "Силистра",
  "Сливен", "Смолян", "Стара Загора", "Търговище", "Хасково", "Шумен", "Ямбол",
]; // prettier-ignore

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

/** Fallback town for a unit whose awarder_seats seat did not geo-resolve: a regional
 *  directorate names its oblast capital ("ОДМВР — Пловдив"); anything else is central
 *  МВР (HQ, main directorates, Академия, Мед. институт, Миграция, СКС) → София. */
const capitalOfName = (name: string): string => {
  const m = name.match(/(?:ОДМВР|РДПБЗН)\s*[—–-]\s*(.+?)\s*$/);
  if (m) {
    const town = m[1].replace(/\s+/g, " ").trim();
    return OBLAST_CAPITALS.includes(town) ? town : SOFIA;
  }
  return SOFIA;
};

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  // ekatte -> [lng, lat] and (town) name -> [lng, lat] from settlements.json, plus
  // the Sofia pin on both keys.
  const settlements = JSON.parse(
    readFileSync(SETTLEMENTS, "utf8"),
  ) as Settlement[];
  const locByEkatte = new Map<string, [number, number]>();
  const locByCity = new Map<string, [number, number]>();
  for (const s of settlements) {
    if (!s.loc) continue;
    const [lng, lat] = s.loc.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    locByEkatte.set(s.ekatte, [lng, lat]);
    // Towns only (courts/directorates sit in towns); first writer wins so a village
    // sharing a capital's name can't clobber it.
    if (s.t_v_m === "гр." && !locByCity.has(norm(s.name)))
      locByCity.set(norm(s.name), [lng, lat]);
  }
  locByEkatte.set(SOFIA_EKATTE, SOFIA_LOC);
  locByCity.set(norm(SOFIA), SOFIA_LOC);

  // Resolved buyer seats for exactly the МВР universe.
  const seats = await allRows<Seat>(
    `SELECT eik, ekatte, settlement, municipality, oblast
       FROM awarder_seats WHERE eik = ANY($1)`,
    [SECURITY_SECTOR_EIKS],
  );
  const seatByEik = new Map(seats.map((s) => [s.eik, s]));

  let viaSeat = 0;
  let viaName = 0;
  const rows = MVR_ENTITIES.map((ent) => {
    const seat = seatByEik.get(ent.eik);
    const isSofiaSeat =
      !!seat?.oblast && seat.oblast.includes("София (столица)");
    // Primary: awarder_seats ekatte → centroid; a София-столица seat is pinned to the
    // София centre so it joins the София cluster instead of a stray suburb marker.
    let city: string | null = null;
    let ekatte: string | null = null;
    const oblast: string | null = seat?.oblast ?? null;
    const municipality: string | null = seat?.municipality ?? null;
    let loc: [number, number] | null = null;
    if (isSofiaSeat) {
      city = SOFIA;
      ekatte = SOFIA_EKATTE;
      loc = SOFIA_LOC;
      viaSeat++;
    } else if (seat?.ekatte && locByEkatte.has(seat.ekatte)) {
      city = seat.settlement ?? null;
      ekatte = seat.ekatte;
      loc = locByEkatte.get(seat.ekatte) ?? null;
      viaSeat++;
    } else {
      // Fallback: entity name → oblast capital → centroid by town name.
      const cap = capitalOfName(ent.name);
      loc = locByCity.get(norm(cap)) ?? null;
      city = cap;
      ekatte = cap === SOFIA ? SOFIA_EKATTE : null;
      if (loc) viaName++;
    }
    return {
      eik: ent.eik,
      name: ent.name,
      universe: ent.universe,
      oblast: oblast ?? (city && city !== SOFIA ? city : null),
      ekatte,
      settlement: city,
      municipality,
      lng: loc ? loc[0] : null,
      lat: loc ? loc[1] : null,
    };
  });

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE mvr_directorate_geo");
    for (const r of rows) {
      await client.query(
        `INSERT INTO mvr_directorate_geo
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
  const missing = rows.filter((r) => r.lng == null);
  console.log(
    `mvr_directorate_geo: loaded ${rows.length} structures ` +
      `(${geocoded} geolocated — ${viaSeat} via seat, ${viaName} via name; ` +
      `${missing.length} without a point)`,
  );
  if (missing.length)
    console.warn(
      `  un-geocoded: ${missing
        .map((r) => `${r.eik} ${securityEntityByEik(r.eik)?.name ?? ""}`)
        .join(", ")}`,
    );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
