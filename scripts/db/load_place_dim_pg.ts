// Build the canonical place dimension (schema: 117_place_dim.sql).
//
// INPUTS — repo JSON only, nothing is fetched:
//   data/settlements.json     the EKATTE settlements (name, name_en, oblast, obshtina, loc, t_v_m)
//   data/municipalities.json  the obshtini, read for the CONTAINMENT columns + loc centroid
//   scripts/person/places.ts  obshtinaLabels() / mirLabels() — the obshtina/mir LABELS
//   src/lib/regionalOblast    OBLAST_NAME — the kind='oblast' labels (place-header hero/seat)
//
// THE LABELS ARE NOT RE-DERIVED HERE, and that is the point. The obshtina and mir rows are
// built from the very same obshtinaLabels()/mirLabels() producers that person_role's
// materialised place_label/place_label_en were written from, so the join that replaces
// those columns returns byte-identical strings. Reading data/municipalities.json directly
// for a label instead would be how "Пловдив-град" silently becomes "Пловдив" — the МИР
// labels are deliberately NOT their oblast's name (see MIR_ONLY_LABELS).
//
// TWO SYNTHETIC SETTLEMENTS. data/settlements.json omits ekatte 68134 (София) and 63183
// (Рудник, общ. Бургас). Both seat real procurement buyers — 68134 is the CAPITAL and the
// single largest row on /procurement/by-settlement — so a dimension built purely from that
// file drops them silently. They are seeded explicitly, the same way the synthetic SFO_CITY
// obshtina is, and pinned by scripts/db/tests/place_dim.data.test.ts.
//
// OUT-OF-COUNTRY PSEUDO-PLACES. Both source files also carry the out-of-country voting
// geography — 88 countries keyed by ISO code as "settlements" (AU, AT, DZ…) and 6
// continents as "obshtini" (EU, AS, AF, NA, SA, OC). They are LOADED rather than filtered:
// obshtinaLabels() is the producer person_role's labels were written from, so excluding a
// code here that the map contains would re-open the byte-identity gap this design closes.
// They carry a NULL oblast_code and mir_code (canonOblast/MIR_SET reject the "32"
// pseudo-oblast), and their count is pinned by the test.
//
// ORDER. Must run BEFORE db:resolve:persons: 082_person_api.sql JOINs this table for the
// 'mir'/'obshtina' label on every /person role, so the table has to be FILLED, not merely
// created. resolve_persons applies 117 as CREATE TABLE IF NOT EXISTS, which means a
// database that never ran this loader resolves and serves cleanly with an EMPTY dimension —
// ~76.5k roles publish a null placeLabel, green locally and blank on prod. db:refresh
// sequences it; the cloud side needs `npm run db:load:place-dim:pg:cloud` run by hand.
//
// Run: `npm run db:load:place-dim:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exec, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { obshtinaLabels, mirLabels } from "../person/places";
import { OBLAST_NAME, oblastToCanon } from "../../src/lib/regionalOblast";
import { MIR_CODES } from "../../src/data/parliament/nsFolders";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/117_place_dim.sql");
const SETTLEMENTS = path.join(ROOT, "data/settlements.json");
const MUNICIPALITIES = path.join(ROOT, "data/municipalities.json");

const MIR_SET = new Set<string>(MIR_CODES);

/** Canonical statistical oblast, or NULL when the source field does not name one.
 *  oblastToCanon() passes unknown codes THROUGH, and the source `oblast` field carries the
 *  out-of-country pseudo-code "32" (see the namespace note in the header) — writing that
 *  verbatim would give consumers an oblast bucket that no map can label, the exact
 *  silent-blank class this dimension exists to end. mir_code is already guarded this way
 *  by MIR_SET; this keeps the two columns symmetric. */
const canonOblast = (raw: string | null): string | null => {
  if (!raw) return null;
  const canon = oblastToCanon(raw);
  return canon in OBLAST_NAME ? canon : null;
};

type SettlementRow = {
  ekatte: string;
  name: string;
  name_en?: string | null;
  oblast?: string | null;
  obshtina?: string | null;
  // "lon,lat" centroid + the т.в.м. marker (с./гр./…) — for the place hero.
  loc?: string | null;
  t_v_m?: string | null;
};
type MunicipalityRow = {
  obshtina: string;
  oblast?: string | null;
  loc?: string | null;
};

/** The city-wide Sofia obshtina — synthetic, so it carries the alias crosswalk. */
const SFO_CITY = "SFO_CITY";

/** Settlements the EKATTE master omits. Seeded rather than tolerated: both are buyer
 *  seats in the procurement corpus, and the join that localises a settlement name would
 *  render the capital blank without the first one. */
const SEEDED_SETTLEMENTS: Array<{
  ekatte: string;
  name: string;
  nameEn: string;
  oblast: string | null;
  obshtina: string | null;
  mir: string | null;
  // The EKATTE master carries neither, so seed the т.в.м. marker; the centroid is
  // left NULL (the hero simply drops the thumbnail rather than inventing coords).
  settlementType: string | null;
  loc: string | null;
}> = [
  // Sofia the city spans three constituencies (S23/S24/S25), so it has no single МИР.
  //
  // NOTE the containment asymmetry this creates: Sofia's other 58 settlements carry their
  // район code (S2521, S2524, …) — deliberately, they are separate offices, see
  // src/lib/obshtinaPlace.ts — so `obshtina_code = 'SFO_CITY'` selects the CAPITAL ALONE,
  // not the city's settlements. A per-obshtina roll-up over the S2*** codes must add this
  // row explicitly. Pinned by the test so re-parenting the районы stays a conscious choice.
  {
    ekatte: "68134",
    name: "София",
    nameEn: "Sofia",
    oblast: "SOFIA_CITY",
    obshtina: SFO_CITY,
    mir: null,
    settlementType: "гр.",
    loc: null,
  },
  {
    ekatte: "63183",
    name: "Рудник",
    nameEn: "Rudnik",
    oblast: "BGS",
    obshtina: "BGS04",
    mir: "BGS",
    settlementType: "с.",
    loc: null,
  },
];

const readJson = <T>(file: string, what: string): T => {
  // Throwing beats degrading: both files are tracked in git, so an absent one is a broken
  // checkout rather than a fresh clone — and a silently EMPTY dimension would surface only
  // as blank place badges on /person and Cyrillic-only names on the procurement table.
  if (!existsSync(file))
    throw new Error(
      `place_dim: ${what} missing at ${file} — cannot build the dimension`,
    );
  // Checked rather than cast: a file that parses to an object (or null) would otherwise
  // slip past the guard above and fail a frame away as "settlements is not iterable",
  // which is the opposite of what the loud-failure guard was written to achieve.
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed))
    throw new Error(`place_dim: ${what} at ${file} is not a JSON array`);
  return parsed as T;
};

type Row = [
  string, // kind
  string, // code
  string, // name_bg
  string | null, // name_en
  string | null, // oblast_code
  string | null, // obshtina_code
  string | null, // mir_code
  string | null, // shard_code
  string | null, // governance_code
  string | null, // price_code
  string | null, // loc  ("lon,lat")
  string | null, // settlement_type (т.в.м.)
];

export const buildPlaceDimRows = (
  settlements: SettlementRow[],
  municipalities: MunicipalityRow[],
): Row[] => {
  const rows: Row[] = [];

  // ── settlements ────────────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  for (const r of settlements) {
    if (!r.ekatte || !r.name) continue;
    seen.add(r.ekatte);
    const raw = r.oblast ?? null;
    rows.push([
      "settlement",
      r.ekatte,
      r.name,
      r.name_en || null,
      canonOblast(raw),
      r.obshtina || null,
      raw && MIR_SET.has(raw) ? raw : null,
      null,
      null,
      null,
      // NULL the centroid for the out-of-country ISO "settlements" (2-char codes: AU, AT…):
      // their source `loc` is the FOREIGN capital, which a Bulgarian place thumbnail must not
      // render. Mirrors the canonOblast/MIR_SET guards — no consumer inherits a value it
      // cannot honestly use. Real 5-digit and composite (Sofia-район) codes keep their loc.
      r.ekatte.length === 2 ? null : r.loc || null,
      r.t_v_m || null,
    ]);
  }
  for (const s of SEEDED_SETTLEMENTS) {
    // Defensive: if the master ever gains these, the seed must not double-insert (the
    // primary key would reject it) nor silently shadow the real row.
    if (seen.has(s.ekatte)) continue;
    rows.push([
      "settlement",
      s.ekatte,
      s.name,
      s.nameEn,
      s.oblast,
      s.obshtina,
      s.mir,
      null,
      null,
      null,
      s.loc,
      s.settlementType,
    ]);
  }

  // ── obshtini ───────────────────────────────────────────────────────────────────────
  const muniOblast = new Map<string, string | null>(
    municipalities.map((r) => [r.obshtina, r.oblast ?? null]),
  );
  const muniLoc = new Map<string, string | null>(
    municipalities.map((r) => [r.obshtina, r.loc ?? null]),
  );
  for (const [code, label] of obshtinaLabels()) {
    const raw = muniOblast.get(code) ?? null;
    const isSofiaCity = code === SFO_CITY;
    rows.push([
      "obshtina",
      code,
      label.bg,
      label.en,
      isSofiaCity ? "SOFIA_CITY" : canonOblast(raw),
      null,
      isSofiaCity ? null : raw && MIR_SET.has(raw) ? raw : null,
      isSofiaCity ? "SOF" : null,
      isSofiaCity ? "SOF00" : null,
      isSofiaCity ? "SOF46" : null,
      // No centroid for the synthetic city-wide obshtina (it spans three МИР).
      muniLoc.get(code) ?? null,
      null,
    ]);
  }

  // ── МИР ────────────────────────────────────────────────────────────────────────────
  for (const [code, label] of mirLabels()) {
    rows.push([
      "mir",
      code,
      label.bg,
      label.en,
      oblastToCanon(code),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  }

  // ── oblast ───────────────────────────────────────────────────────────────────────────
  // The 28 statistical oblast names (27 областа + SOFIA_CITY), from the SAME OBLAST_NAME
  // map every oblast_code above points into — so the label a self-join returns for an
  // oblast_code is byte-identical to what the client folds today. An oblast is the top of
  // this dimension's hierarchy, so it carries no containment codes and no centroid/type.
  for (const [code, label] of Object.entries(OBLAST_NAME)) {
    rows.push([
      "oblast",
      code,
      label.bg,
      label.en,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  }

  return rows;
};

const main = async (): Promise<void> => {
  await exec(readFileSync(SCHEMA, "utf8"));

  const settlements = readJson<SettlementRow[]>(
    SETTLEMENTS,
    "data/settlements.json",
  );
  const municipalities = readJson<MunicipalityRow[]>(
    MUNICIPALITIES,
    "data/municipalities.json",
  );
  const rows = buildPlaceDimRows(settlements, municipalities);

  await withTx(async (c) => {
    // TRUNCATE holds an AccessExclusiveLock for the whole COPY, and this table now sits on
    // the /person serving path — so the lock blocks readers, not just writers. It stays
    // acceptable ONLY because the table is tiny (~5.7k rows, well under a second) and the
    // loader is operator-run, not part of a request. If it grows, gains a bigger namespace,
    // or starts running on a schedule, switch to the staging-swap the contracts reload uses
    // (COPY into place_dim_new, then DROP + RENAME in one transaction).
    await c.query("TRUNCATE place_dim");
    await copyRows(
      c,
      "place_dim",
      [
        "kind",
        "code",
        "name_bg",
        "name_en",
        "oblast_code",
        "obshtina_code",
        "mir_code",
        "shard_code",
        "governance_code",
        "price_code",
        "loc",
        "settlement_type",
      ],
      rows,
    );
  });

  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r[0], (byKind.get(r[0]) ?? 0) + 1);
  console.log(
    `place_dim: ${rows.length} rows (` +
      [...byKind].map(([k, n]) => `${k} ${n}`).join(", ") +
      ")",
  );
};

// Guarded so a test can import buildPlaceDimRows() without firing the loader: main()
// applies DDL and TRUNCATEs place_dim against whatever DATABASE_URL is set — including a
// Cloud SQL proxy target left in the shell, which is the recurring hazard pinLocalDatabase()
// exists for (lib/pg.ts). Same convention as load_pg.ts / load_funds_pg.ts / dump.ts.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(end);
}
