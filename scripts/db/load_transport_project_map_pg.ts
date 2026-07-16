// Build the transport-project geo crosswalk (transport_project_link, schema
// 076_transport_project_map.sql) that the /sector/transport map is drawn from.
// A SERVING loader — never writes JSON back. It links each of the transport group's
// contracts to the physical INFRASTRUCTURE its title names, geocoded against
// data/settlements.json:
//
//   • title names TWO towns  -> a rail SEGMENT (line) between the two centroids
//                               "Костенец–Септември", "Пловдив–Бургас", "Горна Оряховица–Шумен"
//   • title names ONE town   -> a POINT, typed by keyword (port / station / junction / rail)
//                               "Пристанище Бургас", "гара Каспичан", "Видин"
//
// The state-transport entities are all Sofia-registered, so a seat map is degenerate; the
// meaningful geography is what the money builds — rail sections, ports, junctions — which the
// titles name. A contract naming no town (train operations, rolling stock, fuel — network-
// wide, ~70% of value) is simply absent from the map.
//
// Run: `npm run db:load:transport-project-map:pg` (local) / `:cloud` (Cloud SQL proxy).
// Depends only on the loaded contracts table.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, end } from "./lib/pg";
import { TRANSPORT_SECTOR_EIKS } from "../../src/lib/transportReferenceData";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/076_transport_project_map.sql",
);
const SETTLEMENTS = path.join(ROOT, "data/settlements.json");

const SOFIA = "София";
const SOFIA_EKATTE = "68134";
const SOFIA_LOC: [number, number] = [23.3219, 42.6977];

// Town names that are also common Bulgarian words / too generic to trust as a work site.
const DENY = new Set([
  "Обзор", "Средец", "Победа", "Здравец", "Върба", "Черква", "Мадан", "Загоре",
  "Съединение", "Първомай", "Долни чифлик", "Искър", "Черноморец",
]); // prettier-ignore

// A contract naming this many towns or more is a regional / framework catch-all, not a sited
// project — skip it (it would smear one lump across the whole country). 3–5 towns is usually a
// multi-station framework, not a single section, so we only draw a line for an exact pair.
const MAX_TOWNS_PER_CONTRACT = 6;

type Facility = "rail" | "port" | "station" | "junction";

// Classify a single-town point from title keywords. Order matters (port before station).
const facilityOf = (title: string): Facility => {
  const t = title.toLowerCase();
  if (/пристанищ|\bпорт\b|терминал|\bкей\b/.test(t)) return "port";
  if (/летищ|аерогар/.test(t)) return "junction"; // aviation grouped with junctions (rare)
  if (/жп възел|разпределит/.test(t)) return "junction";
  if (/жп гар|железопътна гар|\bгара\b|\bгарата\b/.test(t)) return "station";
  return "rail";
};

interface Settlement {
  ekatte: string;
  name: string;
  t_v_m: string;
  loc?: string;
}

interface LinkRow {
  key: string;
  kind: "segment" | "point";
  facility: Facility | null;
  a_town: string;
  a_lng: number;
  a_lat: number;
  b_town: string;
  b_lng: number | null;
  b_lat: number | null;
}

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  // Gazetteer: towns (гр.) with a centroid, name ≥4 chars (avoid ambiguous short names),
  // first writer wins. Sofia pinned. Sorted longest-first so multi-word towns win.
  const settlements = JSON.parse(
    readFileSync(SETTLEMENTS, "utf8"),
  ) as Settlement[];
  const town = new Map<string, { ekatte: string; loc: [number, number] }>();
  for (const s of settlements) {
    if (s.t_v_m !== "гр." || !s.loc) continue;
    const nm = s.name.trim();
    if (nm.length < 4 || DENY.has(nm) || town.has(nm)) continue;
    const [lng, lat] = s.loc.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    town.set(nm, { ekatte: s.ekatte, loc: [lng, lat] });
  }
  town.set(SOFIA, { ekatte: SOFIA_EKATTE, loc: SOFIA_LOC });

  const names = [...town.keys()].sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // One alternation, word-boundaried on Cyrillic/Latin letters so „Варна" doesn't match
  // „Варненски" and a town isn't caught mid-word.
  const RE = new RegExp(
    `(^|[^А-Яа-яA-Za-z])(${names.map(esc).join("|")})(?=[^А-Яа-яa-zA-Z]|$)`,
    "g",
  );

  const contracts = await allRows<{ key: string; title: string }>(
    `SELECT key, title FROM contracts
       WHERE awarder_eik = ANY($1) AND tag = 'contract' AND title IS NOT NULL`,
    [TRANSPORT_SECTOR_EIKS],
  );

  const rows: LinkRow[] = [];
  let segN = 0;
  let ptN = 0;
  for (const c of contracts) {
    const found = new Set<string>();
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(c.title)) !== null) found.add(m[2]);
    if (found.size === 0 || found.size > MAX_TOWNS_PER_CONTRACT) continue;

    if (found.size === 2) {
      // A rail section between the two named towns → a line.
      const [na, nb] = [...found];
      const a = town.get(na)!;
      const b = town.get(nb)!;
      rows.push({
        key: c.key,
        kind: "segment",
        facility: null,
        a_town: na,
        a_lng: a.loc[0],
        a_lat: a.loc[1],
        b_town: nb,
        b_lng: b.loc[0],
        b_lat: b.loc[1],
      });
      segN++;
    } else if (found.size === 1) {
      // A single-site facility → a typed point.
      const nm = [...found][0];
      const g = town.get(nm)!;
      rows.push({
        key: c.key,
        kind: "point",
        facility: facilityOf(c.title),
        a_town: nm,
        a_lng: g.loc[0],
        a_lat: g.loc[1],
        b_town: "",
        b_lng: null,
        b_lat: null,
      });
      ptN++;
    }
    // 3..MAX towns: a multi-site framework — counted in neither shape (would mislead).
  }

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE transport_project_link");
    for (const r of rows) {
      await client.query(
        `INSERT INTO transport_project_link
           (key, kind, facility, a_town, a_lng, a_lat, b_town, b_lng, b_lat)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (key, a_town, b_town) DO NOTHING`,
        [
          r.key,
          r.kind,
          r.facility,
          r.a_town,
          r.a_lng,
          r.a_lat,
          r.b_town,
          r.b_lng,
          r.b_lat,
        ],
      );
    }
    await client.query("COMMIT");
  });

  const segTowns = new Set(
    rows
      .filter((r) => r.kind === "segment")
      .flatMap((r) => [r.a_town, r.b_town]),
  ).size;
  const ptTowns = new Set(
    rows.filter((r) => r.kind === "point").map((r) => r.a_town),
  ).size;
  console.log(
    `transport_project_link: ${segN} segments + ${ptN} points ` +
      `(from ${contracts.length} contracts) → ` +
      `${segTowns} towns on lines, ${ptTowns} towns as points`,
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
