// Load the parliament.bg MP roster (data/parliament/index.json, written by the
// parliament-scrape skill), the declared-vehicle rows (data/parliament/mp-cars.json,
// written by scripts/declarations/build_car_makes.ts) and the per-MP bio profile shards
// (data/parliament/profiles/{id}.json) into Postgres — schemas 104_mp_roster.sql +
// 110_mp_profile_detail.sql, serving surfaces 105_mp_serving.sql.
//
// SERVING loader — never writes JSON back. Once Tier 2 moves the hooks, the MP roster,
// leaderboard, cars and per-MP shards are all served from here instead of ~3,700
// bucket files (persons-pg-retirement-v1.md Tier 0.3).
//
// ORDER. 105's mp_assets_rankings_table reads person_wealth_year, so it is rebuilt both
// here and in load_declarations_pg.ts --resolve (which DROPs it via 090's CASCADE).
//
// The real precondition is that person_wealth_year EXISTS — 090 must have been applied
// at least once — and the run below asserts it rather than failing mid-way through a
// SQL file. Given that, running this loader before a resolve is fine: the matview simply
// carries no wealth figures until person_role is filled, and the resolve rebuilds it on
// the way out. Running it after is the normal db:refresh order.
//
// Run: `npm run db:load:mp-roster:pg` (local) / `:cloud` (Cloud SQL proxy).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, exec, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const ROSTER_SCHEMA = path.join(ROOT, "scripts/db/schema/pg/104_mp_roster.sql");
const SERVING_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/105_mp_serving.sql",
);
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);
const PROFILE_DETAIL_SCHEMA = path.join(
  ROOT,
  "scripts/db/schema/pg/110_mp_profile_detail.sql",
);
const ROSTER_SRC = path.join(ROOT, "data/parliament/index.json");
const CARS_SRC = path.join(ROOT, "data/parliament/mp-cars.json");
const PROFILES_DIR = path.join(ROOT, "data/parliament/profiles");

/** parliament.bg publishes an unknown date of birth as the zero date "0000-00-00"
 *  (one MP today, id 766). It is a MySQL-ism the scraper passes through verbatim;
 *  Postgres rejects it outright (22008), and it is not a date anyone could mean. Map
 *  anything that is not a real YYYY-MM-DD to NULL — "we do not know" — rather than
 *  inventing a year. Anything else malformed would be a scraper regression, so this
 *  returns NULL for it too and the loader reports the count. */
const birthDate = (raw: string | null): string | null => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (raw.startsWith("0000")) return null;
  return raw;
};

interface RosterEntry {
  id: number;
  name: string;
  name_en: string | null;
  normalizedName: string | null;
  normalizedName_en: string | null;
  photoUrl: string | null;
  currentRegion: { code: string; name: string } | null;
  currentPartyGroup: string | null;
  currentPartyGroupShort: string | null;
  position: string | null;
  birthDate: string | null;
  nsFolders: string[];
  isCurrent: boolean;
  scrapedAt: string | null;
}

interface CarRow {
  mpId: number;
  make: string | null;
  detail: string | null;
  description: string | null;
  acquiredYear: number | null;
  valueEur: number | null;
  amount: number | null;
  currency: string | null;
  isSpouse: boolean;
  share: string | null;
  mergedFromCount: number | null;
  declarationYear: number | null;
  sourceUrl: string | null;
}

const run = async (): Promise<void> => {
  // 105 selects from person_wealth_year (090). On a database that has never loaded
  // declarations that relation does not exist, and applying 105 below would abort with
  // 42P01 AFTER the roster COPY has committed — leaving the operator a stack trace
  // pointing at a SQL file rather than at the missing prerequisite. db:refresh orders
  // this correctly; only a standalone first run reaches here.
  const [wealth] = await allRows<{ ok: boolean }>(
    "SELECT to_regclass('public.person_wealth_year') IS NOT NULL AS ok",
  );
  if (!wealth?.ok) {
    throw new Error(
      "mp_roster: 105_mp_serving.sql needs person_wealth_year (090). " +
        "Run `npm run db:load:declarations:pg -- --resolve` first.",
    );
  }

  await exec(readFileSync(ROSTER_SCHEMA, "utf8"));
  await exec(readFileSync(INGEST_TRACKING, "utf8"));
  await exec(readFileSync(PROFILE_DETAIL_SCHEMA, "utf8"));

  const roster = (
    JSON.parse(readFileSync(ROSTER_SRC, "utf8")) as { mps: RosterEntry[] }
  ).mps;
  const cars = (
    JSON.parse(readFileSync(CARS_SRC, "utf8")) as { cars: CarRow[] }
  ).cars;
  // Named-file shape checks, in the same spirit as the guards below: without them a
  // scraper refactor that drops the `mps` key fails as `roster.map is not a function`,
  // with nothing to say which file was wrong.
  if (!Array.isArray(roster))
    throw new Error(`${ROSTER_SRC}: expected { mps: [...] }`);
  if (!Array.isArray(cars))
    throw new Error(`${CARS_SRC}: expected { cars: [...] }`);

  // The per-MP profile shards (persons-pg-retirement-v1 T2.3b) — one blob per file,
  // keyed by the payload's own A_ns_MP_id (== the filename). Covers every MP ever
  // scraped (~4.3k), a superset of the roster: ~2.2k are historical MPs the current
  // index.json omits, which is why mp_profile_detail carries no FK to mp_profile.
  if (!existsSync(PROFILES_DIR))
    throw new Error(
      `${PROFILES_DIR} not found — run /update-mps first (parliament-scrape skill)`,
    );
  const profiles: { mpId: number; raw: unknown }[] = [];
  for (const f of readdirSync(PROFILES_DIR)) {
    if (!f.endsWith(".json")) continue;
    const raw = JSON.parse(
      readFileSync(path.join(PROFILES_DIR, f), "utf8"),
    ) as {
      A_ns_MP_id?: number;
    };
    const mpId = raw?.A_ns_MP_id;
    if (typeof mpId !== "number") {
      console.warn(
        `mp_profile_detail: ${f} has no numeric A_ns_MP_id — skipped`,
      );
      continue;
    }
    profiles.push({ mpId, raw });
  }
  if (profiles.length === 0)
    throw new Error(`${PROFILES_DIR} is empty — run /update-mps first`);

  // A car row whose mpId is not in the roster would violate nothing (mp_car has no FK,
  // deliberately — see 104) but would vanish from mp_cars_table's inner join to
  // mp_profile, silently. Count them here instead: a non-zero number means the two
  // artifacts were built from different scrapes and one of them needs regenerating.
  const rosterIds = new Set(roster.map((m) => m.id));
  const orphanCars = cars.filter((c) => !rosterIds.has(c.mpId));
  // Informational only (no FK): profiles for MPs the current roster omits are historical
  // and expected — served fine by id, they just never surface a roster-driven page.
  const profileOrphans = profiles.filter((p) => !rosterIds.has(p.mpId)).length;
  const droppedBirthDates = roster.filter(
    (m) => m.birthDate && birthDate(m.birthDate) === null,
  );

  // ns_folders feeds `CROSS JOIN LATERAL unnest(...)` under a UNIQUE (ns, mp_id) /
  // (ns, car_id) index in 105. A repeated folder — or the literal 'all', which would
  // collide with the national bucket — makes CREATE UNIQUE INDEX fail, and since 105
  // DROPs each matview before recreating it, the file aborts leaving the resource
  // DROPPED and the routes degrading to empty. Zero occurrences today across folders
  // 39–52; fail here, loudly and before the COPY, rather than there.
  const badFolders = roster.filter((m) => {
    const f = m.nsFolders ?? [];
    return new Set(f).size !== f.length || f.includes("all");
  });
  if (badFolders.length) {
    throw new Error(
      `mp_roster: ${badFolders.length} MP(s) have duplicate or reserved nsFolders ` +
        `(${badFolders
          .slice(0, 5)
          .map((m) => `${m.id}=[${(m.nsFolders ?? []).join(",")}]`)
          .join(
            ", ",
          )}) — 105's UNIQUE (ns, mp_id) index cannot be built from them`,
    );
  }

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE mp_profile");
    await copyRows(
      client,
      "mp_profile",
      [
        "mp_id",
        "name",
        "name_en",
        "normalized_name",
        "normalized_name_en",
        "photo_url",
        "current_region_code",
        "current_region_name",
        "current_party_group",
        "current_party_group_short",
        "position_title",
        "birth_date",
        "ns_folders",
        "is_current",
        "scraped_at",
      ],
      (function* () {
        for (const m of roster)
          yield [
            m.id,
            m.name,
            m.name_en,
            m.normalizedName,
            m.normalizedName_en,
            m.photoUrl,
            m.currentRegion?.code ?? null,
            m.currentRegion?.name ?? null,
            m.currentPartyGroup,
            m.currentPartyGroupShort,
            m.position,
            birthDate(m.birthDate),
            // text[] literal — the folders are digit strings ("39".."52"), so no
            // quoting or escaping is needed and `{}` is the empty case.
            `{${(m.nsFolders ?? []).join(",")}}`,
            m.isCurrent,
            m.scrapedAt,
          ];
      })(),
    );

    // RESTART IDENTITY: car_id is a surrogate assigned by load order, so leaving the
    // sequence running would push ids up on every reload for no gain. Nothing outside
    // this table references a car_id — mp_cars_table uses it only as the paging
    // tiebreak — so restarting is safe and keeps reloads reproducible.
    await client.query("TRUNCATE mp_car RESTART IDENTITY");
    await copyRows(
      client,
      "mp_car",
      [
        "mp_id",
        "make",
        "detail",
        "description",
        "acquired_year",
        "value_eur",
        "amount",
        "currency",
        "is_spouse",
        "share",
        "merged_from_count",
        "declaration_year",
        "source_url",
      ],
      (function* () {
        for (const c of cars)
          yield [
            c.mpId,
            c.make,
            c.detail,
            c.description,
            c.acquiredYear,
            c.valueEur,
            c.amount,
            c.currency,
            c.isSpouse ?? false,
            c.share,
            c.mergedFromCount ?? 1,
            c.declarationYear,
            c.sourceUrl,
          ];
      })(),
    );

    // Per-MP full bio blobs (T2.3b). copyRows renders a JS object into a jsonb column
    // (escaped JSON.stringify), so the payload lands verbatim. No RESTART IDENTITY —
    // mp_id is the natural key, not a surrogate.
    await client.query("TRUNCATE mp_profile_detail");
    await copyRows(
      client,
      "mp_profile_detail",
      ["mp_id", "payload"],
      (function* () {
        for (const p of profiles) yield [p.mpId, p.raw];
      })(),
    );

    // feedback_pg_changelog_required — every PG-migrated dataset wires into
    // recent_updates. Keyed on the MP id: the roster is the dataset, a car is a detail
    // of one.
    await recordIngestBatch(client, {
      source: "mp_roster",
      table: "mp_profile",
      keyExpr: "t.mp_id::text",
      nameExpr: "t.name",
      detailExpr:
        "COALESCE(t.current_party_group_short, 'бивш народен представител')",
      amountExpr: "NULL::double precision",
      rowsTotal: roster.length,
    });
    await client.query("COMMIT");
  });

  // Applied after the COPY so the matviews are built over the rows just loaded. Not
  // inside the transaction above: 105 DROPs and recreates matviews, and holding those
  // locks across a bulk load is the contracts-reload mistake
  // (reference_contracts_reload_lock).
  await exec(readFileSync(SERVING_SCHEMA, "utf8"));

  // A freshly created matview has no planner stats until autoanalyze eventually runs, so
  // its first serves are planned on a guess. Same reason (and same list shape) as the
  // ANALYZE loop at the end of load_declarations_pg.ts.
  for (const t of [
    "mp_profile",
    "mp_profile_detail",
    "mp_car",
    "mp_assets_rankings_table",
    "mp_cars_table",
  ]) {
    await exec(`ANALYZE ${t}`);
  }

  const current = roster.filter((m) => m.isCurrent).length;
  console.log(
    `mp_roster: loaded ${roster.length} MPs (${current} sitting), ${cars.length} declared vehicles, ` +
      `${profiles.length} profile blobs (${profileOrphans} for MPs outside the current roster)`,
  );
  if (droppedBirthDates.length) {
    console.warn(
      `mp_roster: ${droppedBirthDates.length} unparsable birth date(s) stored as NULL ` +
        `(mp ${droppedBirthDates
          .slice(0, 10)
          .map((m) => `${m.id}="${m.birthDate}"`)
          .join(", ")})`,
    );
  }
  if (orphanCars.length) {
    console.warn(
      `mp_roster: ${orphanCars.length} car rows reference an mp_id absent from the roster ` +
        `(${[...new Set(orphanCars.map((c) => c.mpId))].slice(0, 10).join(", ")}…) — ` +
        `they will not appear in mp_cars_table. Rebuild mp-cars.json against the current index.json.`,
    );
  }
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
