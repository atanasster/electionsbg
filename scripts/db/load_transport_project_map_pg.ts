// Build the transport-project geo crosswalk (transport_project_link, schema
// 076_transport_project_map.sql) that the /sector/transport map is drawn from.
// A SERVING loader — never writes JSON back. It links each of the transport group's
// contracts to AT MOST ONE piece of physical infrastructure its title names,
// geocoded against data/settlements.json (towns) and data/ekatte_index.json (every
// settlement, for section ends — a shared name is settled by distance to the other
// end, and refused when distance cannot settle it). The rules live in
// lib/transport_project_links.ts, with fixture tests:
//
//   • a rail awarder's title naming a SECTION -> a SEGMENT (line). An explicitly
//     named section („участък Медковец – Срацимир") beats the parent line.
//   • one town                                -> a POINT, typed by keyword, else by
//                                                the awarder's universe
//   • two towns with no section word, 3+ towns, nothing placeable -> no link
//
// A contract naming no town (train operations, rolling stock, fuel — network-
// wide) is simply absent from the map; 076 reports the placed share as coverage.
//
// The rebuild is a STAGE MERGE, never TRUNCATE-in-a-transaction: the old form held
// an AccessExclusiveLock on a served table for the whole load (210 s on Cloud SQL),
// blocking every map request. Readers keep the previous vintage until the merge
// COMMIT, then the table is vacuumed so its visibility map survives the rewrite.
//
// Run: `npm run db:load:transport-project-map:pg` (local) / `:cloud` (Cloud SQL proxy).
// Depends only on the loaded contracts table.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withTx, end, vacuumAfterReload } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import {
  TRANSPORT_SECTOR_EIKS,
  transportUniverseOf,
} from "../../src/lib/transportReferenceData";
import {
  linkForContract,
  placeCandidatesIndex,
  type LinkDecision,
  type Place,
  type SectionRefusal,
} from "./lib/transport_project_links";

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
const EKATTE_INDEX = path.join(ROOT, "data/ekatte_index.json");

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

interface Settlement {
  ekatte: string;
  name: string;
  t_v_m: string;
  loc?: string;
}

const COLS = [
  "key",
  "kind",
  "facility",
  "a_town",
  "a_lng",
  "a_lat",
  "b_town",
  "b_lng",
  "b_lat",
  "scope",
];
const SPEC: StageMergeSpec = {
  table: "transport_project_link",
  source: "transport_project_link_stage",
  keys: ["key", "a_town", "b_town"],
  cols: COLS,
};

const run = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  // Gazetteer: towns (гр.) with a centroid, name ≥4 chars (avoid ambiguous short names),
  // first writer wins. Sofia pinned. Sorted longest-first so multi-word towns win.
  const settlements = JSON.parse(
    readFileSync(SETTLEMENTS, "utf8"),
  ) as Settlement[];
  const town = new Map<string, { ekatte: string; loc: [number, number] }>();
  const ambiguousTown = new Set<string>();
  for (const s of settlements) {
    if (s.t_v_m !== "гр." || !s.loc) continue;
    const nm = s.name.trim();
    if (nm.length < 4 || DENY.has(nm)) continue;
    if (town.has(nm) || ambiguousTown.has(nm)) {
      // Two towns share the name (Бяла — обл. Русе and обл. Варна): refuse it, the
      // same rule as the village pass. First-writer-wins drew a 180 km line.
      town.delete(nm);
      ambiguousTown.add(nm);
      continue;
    }
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

  // Section ends: EVERY settlement of that name — towns and villages alike —
  // settled by distance to the other end in pickSectionEnds (audit 2026-10-17, T4).
  // A name the register does not hold falls back to the town gazetteer (Sofia's
  // pinned centroid).
  const places = placeCandidatesIndex(
    JSON.parse(readFileSync(EKATTE_INDEX, "utf8")) as {
      name: string;
      loc: string | null;
      is_village?: boolean;
    }[],
  );
  const lookupTown = (n: string): Place | null => {
    const t = town.get(n);
    return t ? { name: n, loc: t.loc, village: false } : null;
  };
  const sectionEndCandidates = (n: string): Place[] => {
    const c = places.get(n);
    if (c?.length) return c;
    const t = lookupTown(n);
    return t ? [t] : [];
  };
  const refused = new Map<SectionRefusal, number>();

  const contracts = await allRows<{
    key: string;
    title: string;
    awarder_eik: string;
  }>(
    `SELECT key, title, awarder_eik FROM contracts
       WHERE awarder_eik = ANY($1) AND tag = 'contract' AND title IS NOT NULL`,
    [TRANSPORT_SECTOR_EIKS],
  );

  const rows: unknown[][] = [];
  const skipped = new Map<NonNullable<LinkDecision["skipped"]>, number>();
  let segN = 0;
  let lineOnlyN = 0;
  let ptN = 0;
  let villageEnds = 0;
  const segTowns = new Set<string>();
  const ptTowns = new Set<string>();
  for (const c of contracts) {
    const found = new Set<string>();
    RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(c.title)) !== null) found.add(m[2]);
    const d = linkForContract(
      c.title,
      [...found],
      transportUniverseOf(c.awarder_eik),
      lookupTown,
      sectionEndCandidates,
      MAX_TOWNS_PER_CONTRACT,
    );
    if (d.sectionRefused)
      refused.set(d.sectionRefused, (refused.get(d.sectionRefused) ?? 0) + 1);
    const l = d.link;
    if (!l) {
      if (d.skipped) skipped.set(d.skipped, (skipped.get(d.skipped) ?? 0) + 1);
      continue;
    }
    if (l.kind === "segment") {
      rows.push([c.key, "segment", null, l.a.name, l.a.loc[0], l.a.loc[1], l.b.name, l.b.loc[0], l.b.loc[1], l.scope]); // prettier-ignore
      segN++;
      if (l.scope === "line") lineOnlyN++;
      villageEnds += Number(l.a.village) + Number(l.b.village);
      segTowns.add(l.a.name).add(l.b.name);
    } else {
      rows.push([c.key, "point", l.facility, l.a.name, l.a.loc[0], l.a.loc[1], "", null, null, null]); // prettier-ignore
      ptN++;
      ptTowns.add(l.a.name);
    }
  }

  await withTx(async (client) => {
    await createStageTable(client, SPEC);
    await copyRows(client, SPEC.source, COLS, rows);
    await addStagePrimaryKey(client, SPEC);
    await mergeFromStage(client, SPEC);
    await client.query(`DROP TABLE ${SPEC.source}`);
  });
  await vacuumAfterReload(SPEC.table);

  console.log(
    `transport_project_link: ${segN} segments (${lineOnlyN} parent-line only, ` +
      `${villageEnds} village ends) + ${ptN} points (from ${contracts.length} contracts) → ` +
      `${segTowns.size} places on lines, ${ptTowns.size} towns as points; ` +
      `${ambiguousTown.size} shared town names refused as points; named sections refused ` +
      ([...refused].map(([k, v]) => `${k}=${v}`).join(" ") || "none") +
      "; skipped " +
      [...skipped].map(([k, v]) => `${k}=${v}`).join(" "),
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
