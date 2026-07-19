// Re-key the candidate electoral shards by person_id (person-candidate-merge-v1).
//
// The shards under data/{election}/candidates/{NAME}/ are keyed by the candidate's display
// NAME; save_preferences.ts writes one folder per name, so N same-name candidates in one
// election share one folder. regions.json inside it keeps EVERY party's rows, so a candidacy
// is recovered by filtering to its own partyNum — that fixes the namesake collision the
// name-folder key can't. This loader:
//   1. reads the person_id ← candidacy mapping from person_role (source='candidate'),
//   2. walks the by-slug shards (party-separated) for every election,
//   3. filters each name folder's regions.json to the candidacy's party,
//   4. COPY-loads candidate_person (lookup) + person_election_stats (the dashboard data).
//
// Runs AFTER db:resolve:persons (it needs the person_id assignments). Schema:
// 085_person_elections.sql. SERVING loader — never writes JSON back.
//
// Run: `npm run db:load:person-elections:pg` (local) / `:cloud` (Cloud SQL proxy).

import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import { recordIngestBatch } from "./lib/ingest_changelog";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SCHEMA = path.join(ROOT, "scripts/db/schema/pg/085_person_elections.sql");
const INGEST_TRACKING = path.join(
  ROOT,
  "scripts/db/schema/pg/005_ingest_tracking.sql",
);

interface BySlug {
  slug: string;
  name: string;
  partyNum: number | null;
}
interface RegionRow {
  partyNum?: number;
  totalVotes?: number;
}
interface PrefStats {
  stats?: unknown[];
  top_settlements?: unknown[];
  top_sections?: unknown[];
}

const readJson = <T>(file: string): T | null =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;

const run = async (): Promise<void> => {
  await exec(fs.readFileSync(SCHEMA, "utf8"));
  await exec(fs.readFileSync(INGEST_TRACKING, "utf8"));

  // ref ('{election}:{slug}') → { personId, personSlug }. person_role holds one candidate
  // role per candidacy shard, already resolved to a person by resolve_persons.ts.
  const roleMap = new Map<string, { personId: number; personSlug: string }>();
  for (const r of await allRows<{
    ref: string;
    person_id: string;
    slug: string;
  }>(
    `SELECT r.ref, r.person_id, p.slug
       FROM person_role r JOIN person p USING (person_id)
      WHERE r.source = 'candidate'`,
  ))
    roleMap.set(r.ref, {
      personId: Number(r.person_id),
      personSlug: r.slug,
    });

  const candidatePersonRows: Array<
    [string, string, string, number | null, number, string]
  > = [];
  type StatsRow = [
    number,
    string,
    number,
    number,
    RegionRow[],
    unknown[],
    unknown[],
    unknown[],
  ];
  // ONE row per (person, election). A seated MP resolves from BOTH its mp-{id} shard (party
  // inferred from the name folder) AND its c-{party} list shard (party from the slug) in the
  // same cycle — the same candidacy, not two. Keep the slug-party row (authoritative); a
  // person only ever runs on one party per election, so (person, election) is unique.
  const statsByPersonElection = new Map<
    string,
    { row: StatsRow; fromSlug: boolean }
  >();

  let shards = 0;
  let unresolved = 0;
  let collisions = 0;
  let mpCollision = 0;

  for (const dir of globSync(path.join(ROOT, "data/2*/candidates/by-slug"))) {
    const election = path.basename(path.dirname(path.dirname(dir)));
    const candidatesRoot = path.dirname(dir);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      shards++;
      const c = readJson<BySlug>(path.join(dir, file));
      if (!c) continue;
      const pr = roleMap.get(`${election}:${c.slug}`);
      if (!pr) {
        unresolved++;
        continue; // candidacy didn't resolve to a person → /candidate/{slug} falls through
      }

      const regionsAll =
        readJson<RegionRow[]>(
          path.join(candidatesRoot, c.name, "regions.json"),
        ) ?? [];
      const distinctParties = new Set(
        regionsAll.map((r) => r.partyNum).filter((p) => p != null),
      );
      const isCollision = distinctParties.size > 1;

      // The candidacy's party: from the c-{party}-… slug (authoritative), else the folder's
      // sole party for an mp-{id} candidacy in a clean folder. An mp candidacy landing in a
      // collision folder can't be party-disambiguated from the slug — rare; count it.
      const effectiveParty =
        c.partyNum ??
        (distinctParties.size === 1 ? [...distinctParties][0]! : null);
      if (effectiveParty == null && isCollision) mpCollision++;
      if (isCollision) collisions++;

      // Party-filter to keep namesakes split. When the party is known → filter to it. When it
      // ISN'T (an mp candidacy in a multi-party collision folder) → empty, an honest absence,
      // NEVER the mixed-party rows (which would re-conflate the namesakes we just separated).
      const regions =
        effectiveParty != null
          ? regionsAll.filter((r) => r.partyNum === effectiveParty)
          : isCollision
            ? []
            : regionsAll;
      const totalVotes = regions.reduce((s, r) => s + (r.totalVotes ?? 0), 0);

      // preferences_stats (history + geography tiles) is name-folder-keyed and thus
      // conflated for collisions — keep it only for a clean single-party folder, otherwise
      // an honest empty (the headline numbers still come from the party-filtered regions).
      const ps = isCollision
        ? null
        : readJson<PrefStats>(
            path.join(candidatesRoot, c.name, "preferences_stats.json"),
          );

      candidatePersonRows.push([
        election,
        c.slug,
        c.name, // raw display name; folded to candidate_name_fold in SQL below
        effectiveParty,
        pr.personId,
        pr.personSlug,
      ]);

      const fromSlug = c.partyNum != null;
      const key = `${pr.personId}\t${election}`;
      const existing = statsByPersonElection.get(key);
      // Set on first sight; on a dual-shard clash, replace only to upgrade an inferred-party
      // row to the slug-party one — never the reverse.
      if (existing && !(fromSlug && !existing.fromSlug)) continue;
      statsByPersonElection.set(key, {
        row: [
          pr.personId,
          election,
          effectiveParty ?? 0,
          totalVotes,
          regions,
          ps?.stats ?? [],
          ps?.top_settlements ?? [],
          ps?.top_sections ?? [],
        ],
        fromSlug,
      });
    }
  }

  const statsRows = [...statsByPersonElection.values()].map((v) => v.row);

  await withClient(async (client) => {
    await client.query("BEGIN");
    await client.query("TRUNCATE candidate_person, person_election_stats");
    await copyRows(
      client,
      "candidate_person",
      [
        "election_date",
        "candidate_slug",
        "candidate_name_fold",
        "party_num",
        "person_id",
        "person_slug",
      ],
      candidatePersonRows,
    );
    // Fold the raw display name in-place with the ONE normalizer, so the name-path lookup
    // (candidate_person_by_name → translit_bg_latin(query)) matches. Idempotent: translit of
    // an already-latin string is a no-op.
    await client.query(
      `UPDATE candidate_person SET candidate_name_fold = translit_bg_latin(candidate_name_fold)`,
    );
    await copyRows(
      client,
      "person_election_stats",
      [
        "person_id",
        "election_date",
        "party_num",
        "total_votes",
        "regions",
        "stats",
        "top_settlements",
        "top_sections",
      ],
      statsRows,
    );
    await recordIngestBatch(client, {
      source: "person_elections",
      table: "person_election_stats",
      keyExpr: "t.person_id || ':' || t.election_date || ':' || t.party_num",
      nameExpr: "NULL::text",
      detailExpr: "t.election_date",
      amountExpr: "NULL::double precision",
      rowsTotal: statsRows.length,
    });
    await client.query("COMMIT");
  });

  console.log(
    `person_elections: ${candidatePersonRows.length} candidate_person rows, ` +
      `${statsRows.length} person_election_stats rows over ${shards} shard(s); ` +
      `${unresolved} unresolved, ${collisions} collision folder(s)` +
      (mpCollision ? `, ${mpCollision} mp-in-collision (empty regions)` : ""),
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
