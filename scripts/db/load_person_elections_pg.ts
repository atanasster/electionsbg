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
//   4. folds that party's ЕРИК filing into the candidacy's campaign self-funding,
//   5. COPY-loads candidate_person (lookup) + person_election_stats (the dashboard data).
//
// Runs AFTER db:resolve:persons (it needs the person_id assignments). Schema:
// 085_person_elections.sql. SERVING loader — never writes JSON back.
//
// Run: `npm run db:load:person-elections:pg` (local) / `:cloud` (Cloud SQL proxy).

import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, allRows, withClient, withTx, end } from "./lib/pg";
import { copyRows } from "./lib/copy";
import {
  createStageTable,
  addStagePrimaryKey,
  mergeFromStage,
  type StageMergeSpec,
} from "./lib/stage_merge";
import { candidacyRegions, type RegionRow } from "../person/candidateRegions";
import { recordIngestBatch } from "./lib/ingest_changelog";

// Non-blocking reload (scripts/db/lib/stage_merge.ts). BOTH of these tables sit on
// the serving path — person_election_stats is read by person_by_slug (082) AND by
// person_connections (084), so a TRUNCATE here blocked /api/db/person-profile,
// person-elections, person-connections and candidate-person all at once. Measured
// on prod 2026-07-31 (19:08 and 20:58-21:01 UTC): 66 x 500 at ~2.0 s across those
// four routes, each slug retried twice. Natural composite PKs both, so the merge
// keys are the table's own identity — no surrogate to reconcile.
const CANDIDATE_PERSON_MERGE: StageMergeSpec = {
  table: "candidate_person",
  source: "candidate_person_stage",
  keys: ["election_date", "candidate_slug"],
  cols: [
    "election_date",
    "candidate_slug",
    "candidate_name_fold",
    "party_num",
    "person_id",
    "person_slug",
  ],
};

const ELECTION_STATS_MERGE: StageMergeSpec = {
  table: "person_election_stats",
  source: "person_election_stats_stage",
  keys: ["person_id", "election_date"],
  cols: [
    "person_id",
    "election_date",
    "party_num",
    "party_nick",
    "party_color",
    "total_votes",
    "regions",
    "stats",
    "top_settlements",
    "top_sections",
    "donated_monetary_eur",
    "donated_nonmonetary_eur",
    "donation_count",
    "donations",
  ],
};

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
interface CikParty {
  number: number;
  nickName?: string;
  name?: string;
  color?: string;
}
interface PrefStats {
  stats?: unknown[];
  top_settlements?: unknown[];
  top_sections?: unknown[];
}

const readJson = <T>(file: string): T | null =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;

// Per-election party DISPLAY (number → {nick, color}) from data/{election}/cik_parties.json.
// Cached per election since the loop below touches an election's shards together. The colour
// and nickName only exist in these per-election files, so this is the ONE place they enter the
// person layer (baked into person_election_stats for the search badge).
const partyDisplayCache = new Map<
  string,
  Map<number, { nick: string | null; color: string | null }>
>();
const partyDisplayFor = (
  election: string,
): Map<number, { nick: string | null; color: string | null }> => {
  const hit = partyDisplayCache.get(election);
  if (hit) return hit;
  const rows =
    readJson<CikParty[]>(
      path.join(ROOT, "data", election, "cik_parties.json"),
    ) ?? [];
  const map = new Map<number, { nick: string | null; color: string | null }>();
  for (const p of rows) {
    if (p.number == null) continue;
    map.set(p.number, { nick: p.nickName ?? null, color: p.color ?? null });
  }
  partyDisplayCache.set(election, map);
  return map;
};

/** One ЕРИК self-funding row as the party filing publishes it. */
interface FilingDonation {
  name?: string;
  date?: string;
  goal?: string;
  monetary?: number;
  nonMonetary?: number;
}

/** Campaign self-funding for one election, keyed `{partyNum}\t{donor name}`.
 *
 *  ⚠️ The PARTY is part of the key and must stay there. ЕРИК's table is „дарения от кандидати
 *  и членове", so a donor need not be a candidate at all, and a name-only key would attribute
 *  one party's donation to a same-named candidate on another ballot — the exact namesake
 *  misattribution the person layer exists to refuse.
 *
 *  ⚠️ 131 of 886 rows do not join, in THREE groups (measured 2026-09-04): 65 names on a
 *  DIFFERENT party's list (correctly refused), 56 absent from the ballot entirely (party
 *  members, correctly unattributed) and 10 rows / €7,284.85 across 7 candidates that ARE on
 *  their own party's list under a SHORTENED spelling — a missing patronymic or hyphen spacing
 *  („Мая Манолова - Найденова" vs „Мая Божидарова Манолова-Найденова", €5,155). Those are
 *  LOST, not refused; case/whitespace folding recovers 0 of them, so closing the gap needs a
 *  token rule with its own ambiguity refusal and is its own tier. Do NOT loosen this key.
 *
 *  A donor may file several times, so rows FOLD rather than replace.
 *
 *  ⚠️ MIRRORED, deliberately, by `filingDonations()` in person_elections.data.test.ts. That
 *  gate re-reads these same files with the same fold so its comparison is independent of this
 *  loader's bookkeeping rather than a restatement of it — extracting a shared helper would
 *  make it a tautology. The three rules that must stay in step: the party comes from
 *  `filing.party` (never the directory name), a nameless row is skipped, and rows accumulate.
 */
const donationCache = new Map<string, Map<string, FilingDonation[]>>();
/** Total filing rows read across every election touched — the DENOMINATOR the coverage log
 *  needs. Without it an operator watching for the collapse the header warns about would have
 *  to query the corpus by hand. */
let filingRowsRead = 0;
const donationsFor = (election: string): Map<string, FilingDonation[]> => {
  const hit = donationCache.get(election);
  if (hit) return hit;
  const map = new Map<string, FilingDonation[]>();
  const finDir = path.join(ROOT, "data", election, "parties", "financing");
  if (fs.existsSync(finDir)) {
    for (const partyDir of fs.readdirSync(finDir)) {
      const filing = readJson<{
        party?: number;
        data?: { fromCandidates?: FilingDonation[] };
      }>(path.join(finDir, partyDir, "filing.json"));
      // The party comes from the FILING, not the directory name, so a renamed folder cannot
      // silently re-attribute a party's donations.
      const partyNum = filing?.party;
      if (partyNum == null) continue;
      for (const row of filing?.data?.fromCandidates ?? []) {
        if (!row?.name) continue;
        filingRowsRead++;
        const key = `${partyNum}\t${row.name}`;
        const list = map.get(key);
        if (list) list.push(row);
        else map.set(key, [row]);
      }
    }
  }
  donationCache.set(election, map);
  return map;
};

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
    number, // person_id
    string, // election_date
    number, // party_num
    string | null, // party_nick
    string | null, // party_color
    number, // total_votes
    RegionRow[], // regions
    unknown[], // stats
    unknown[], // top_settlements
    unknown[], // top_sections
    number, // donated_monetary_eur
    number, // donated_nonmonetary_eur
    number, // donation_count
    unknown[], // donations
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
  let donationRowsMatched = 0;

  for (const dir of globSync(path.join(ROOT, "data/2*/candidates/by-slug"))) {
    const election = path.basename(path.dirname(path.dirname(dir)));
    const candidatesRoot = path.dirname(dir);
    // SORTED. The dedupe below breaks a two-`mp-{id}` tie on first-seen, and since the
    // self-funding columns landed that choice decides which shard's NAME the filing lookup
    // uses — i.e. whether a real euro figure is published (50 (person, cycle) pairs hold two
    // mp-{id} shards, several with different inferred parties). `readdirSync` returns OS
    // order — sorted on APFS, hash order on ext4 with dir_index — so without this the
    // stability measured on this machine (0 order-sensitive figures of 66,977, forwards vs
    // reversed) is incidental to the filesystem.
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      shards++;
      const c = readJson<BySlug>(path.join(dir, file));
      if (!c) continue;
      const pr = roleMap.get(`${election}:${c.slug}`);
      if (!pr) {
        unresolved++;
        continue; // candidacy didn't resolve to a person → /candidate/{slug} falls through
      }

      // Shared with db:resolve:persons, which needs the same party-disambiguated answer
      // two steps EARLIER in db:refresh than this table exists — see candidateRegions.ts.
      const { regions, effectiveParty, isCollision } = candidacyRegions(
        candidatesRoot,
        c.name,
        c.partyNum,
      );
      if (effectiveParty == null && isCollision) mpCollision++;
      if (isCollision) collisions++;
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
      const disp =
        effectiveParty != null
          ? partyDisplayFor(election).get(effectiveParty)
          : undefined;
      // Self-funding for THIS candidacy. Keyed on the candidacy's own party — an inferred
      // party (an mp-{id} shard in a clean folder) counts, a collision's NULL party does not,
      // because attributing a donation then would be a guess between two same-named people.
      const donations =
        effectiveParty != null
          ? (donationsFor(election).get(`${effectiveParty}\t${c.name}`) ?? [])
          : [];
      donationRowsMatched += donations.length;
      // Drop the donor NAME from the stored rows. It is this person by construction, so it
      // adds nothing — and a name inside a per-person payload reads as evidence of identity
      // on exactly the shared-name pages where it is not. `CandidateDonationsTile` already
      // types its rows as Omit<FinancingFromCandidates, "name">.
      const donationRows = donations.map((d) => ({
        date: d.date,
        goal: d.goal,
        monetary: d.monetary,
        nonMonetary: d.nonMonetary,
      }));
      const donatedMonetary = donations.reduce(
        (t, d) => t + (d.monetary ?? 0),
        0,
      );
      const donatedNonMonetary = donations.reduce(
        (t, d) => t + (d.nonMonetary ?? 0),
        0,
      );
      statsByPersonElection.set(key, {
        row: [
          pr.personId,
          election,
          effectiveParty ?? 0,
          disp?.nick ?? null,
          disp?.color ?? null,
          totalVotes,
          regions,
          ps?.stats ?? [],
          ps?.top_settlements ?? [],
          ps?.top_sections ?? [],
          donatedMonetary,
          donatedNonMonetary,
          donationRows.length,
          donationRows,
        ],
        fromSlug,
      });
    }
  }

  const statsRows = [...statsByPersonElection.values()].map((v) => v.row);

  // Build into UNLOGGED stage twins. Nothing reads them, so this phase — the COPY
  // of every candidacy plus the translit pass, i.e. all of the wall clock — locks
  // nothing on the serving path and the live tables keep answering the previous
  // vintage throughout.
  await withClient(async (client) => {
    await createStageTable(client, CANDIDATE_PERSON_MERGE);
    await createStageTable(client, ELECTION_STATS_MERGE);
    await copyRows(
      client,
      CANDIDATE_PERSON_MERGE.source,
      CANDIDATE_PERSON_MERGE.cols,
      candidatePersonRows,
    );
    // Fold the raw display name in-place with the ONE normalizer, so the name-path lookup
    // (candidate_person_by_name → translit_bg_latin(query)) matches. Idempotent: translit of
    // an already-latin string is a no-op. On the stage, so the live table never sees the
    // pre-fold state even transiently.
    await client.query(
      `UPDATE ${CANDIDATE_PERSON_MERGE.source} SET candidate_name_fold = translit_bg_latin(candidate_name_fold)`,
    );
    await copyRows(
      client,
      ELECTION_STATS_MERGE.source,
      ELECTION_STATS_MERGE.cols,
      statsRows,
    );
    // Fails loudly on a duplicate candidacy/person-election key before anything
    // touches the live tables — TRUNCATE+COPY used to get this from the live PK.
    await addStagePrimaryKey(client, CANDIDATE_PERSON_MERGE);
    await addStagePrimaryKey(client, ELECTION_STATS_MERGE);
  });

  // Flip. Upsert-changed + delete-absent take RowExclusiveLock, which does not
  // conflict with the AccessShare a SELECT needs, so readers never block — and one
  // transaction over both tables means candidate_person can never disagree with
  // person_election_stats about which candidacies exist.
  await withTx(async (client) => {
    await mergeFromStage(client, CANDIDATE_PERSON_MERGE);
    await mergeFromStage(client, ELECTION_STATS_MERGE);
    await recordIngestBatch(client, {
      source: "person_elections",
      table: "person_election_stats",
      keyExpr: "t.person_id || ':' || t.election_date || ':' || t.party_num",
      nameExpr: "NULL::text",
      detailExpr: "t.election_date",
      amountExpr: "NULL::double precision",
      rowsTotal: statsRows.length,
    });
  });
  await exec(`DROP TABLE IF EXISTS ${CANDIDATE_PERSON_MERGE.source}`);
  await exec(`DROP TABLE IF EXISTS ${ELECTION_STATS_MERGE.source}`);

  // The donation counts are REPORTED rather than gated: the unmatched remainder is mostly
  // party members who are not candidates at all, so a coverage floor here would fail on a
  // perfectly good corpus. The number is worth printing because a COLLAPSE in it means the
  // filings moved or the name key broke.
  // The index is DERIVED from the merge spec rather than written out: StatsRow is positional
  // (copyRows follows `cols` order), so a hand-typed 12 silently becomes the wrong column the
  // next time a field is inserted — it already read the euro total instead of the count once.
  const DONATION_COUNT_COL =
    ELECTION_STATS_MERGE.cols.indexOf("donation_count");
  const donationRowsPublished = statsRows.reduce(
    (t, r) => t + (r[DONATION_COUNT_COL] as number),
    0,
  );
  console.log(
    `person_elections: ${candidatePersonRows.length} candidate_person rows, ` +
      `${statsRows.length} person_election_stats rows over ${shards} shard(s); ` +
      `${unresolved} unresolved, ${collisions} collision folder(s)` +
      (mpCollision ? `, ${mpCollision} mp-in-collision (empty regions)` : "") +
      `; ${donationRowsPublished}/${filingRowsRead} self-funding row(s) attributed` +
      (filingRowsRead
        ? ` (${((100 * donationRowsPublished) / filingRowsRead).toFixed(1)}%)`
        : "") +
      // Only when it differs: the two are equal today (756/756), so printing both plus an
      // explanation of why they diverge is noise. A divergence means a shard that LOST the
      // dual-shard dedupe had also matched a filing row.
      (donationRowsMatched !== donationRowsPublished
        ? `; ${donationRowsMatched} matched before the dual-shard dedupe`
        : ""),
  );
  await end();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
