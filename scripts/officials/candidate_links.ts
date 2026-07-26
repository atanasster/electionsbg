// Decorate every per-município roster shard at
// data/officials/municipal/by_obshtina/<obshtina>.json with a
// `candidateLink` field on each entry — joining the cacbg roster row to:
//
//   1. The most recent local-election slate row for that município. Gives us
//      party affiliation (canonicalPartyId → colour + label), ballot position,
//      preference votes, and whether the slate row was elected. Coverage is
//      ~95% — most council members ran on a slate.
//
//   2. The parliament.bg MP index by normalised name. Gives us a photo URL
//      for the small subset of councillors who also served / serve in NS.
//      Coverage is ~5%, but the upside is real: turns the "wall of green
//      initials" in MyAreaCouncilVotesTile into a real face for those rows.
//
// The join itself lives in ./candidate_link_join.ts, shared verbatim with the
// Postgres loader (scripts/db/load_official_candidate_links_pg.ts) so the JSON
// shards and the official_candidate_link table can never disagree
// (persons-pg-retirement-v1 T1.5).
//
// The decoration is written BACK into the per-obshtina shards (in place) so
// frontend consumers that already fetch the shard get the enrichment for
// free — no second hook, no second fetch. The 2.2 MB global municipal/
// index.json is NOT touched; that file is reserved for cross-município
// search and the additional fields would inflate it for no win.
//
// Re-runnable: idempotent — re-running just refreshes the candidate-link
// payload (e.g. after a new local-election cycle gets ingested or after
// parliament.bg adds photos for a fresh cohort).
//
// Sofia note: officials' SFO_CITY tier carries the Stolichen Council city-
// wide. mi2023's `SOF` parent bundle carries the same city-wide slate (the
// район shards S2*** replicate it). So SFO_CITY looks up against
// mi2023/SOF.json. Same pattern for Plovdiv/Varna, which DON'T have a
// city-wide officials tier — those use the obshtina code directly.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import type {
  MunicipalIndexEntry,
  MunicipalityRosterFile,
} from "../../src/data/dataTypes";
import {
  DECORATED_ROLES,
  buildSlateIndex,
  loadMiBundle,
  loadParliamentByName,
  officialsToMi,
  resolveCandidateLink,
  type MpRow,
  type SlateIndex,
} from "./candidate_link_join";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const SHARD_DIR = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "by_obshtina",
);

// --- Main pass ------------------------------------------------------------

type ShardStats = {
  obshtina: string;
  total: number;
  partyHits: number;
  photoHits: number;
};

const decorateShard = (
  shardPath: string,
  slateIdx: SlateIndex | null,
  parliamentByName: Map<string, MpRow>,
): ShardStats => {
  const shard = JSON.parse(
    fs.readFileSync(shardPath, "utf8"),
  ) as MunicipalityRosterFile;
  let partyHits = 0;
  let photoHits = 0;
  let total = 0;
  for (const entry of shard.entries) {
    // Only decorate the roles that vote / govern. "other" entries (rare,
    // edge-case institutional staff) get skipped.
    if (!DECORATED_ROLES.has(entry.role)) {
      delete (entry as Partial<MunicipalIndexEntry>).candidateLink;
      continue;
    }
    total++;
    const link = resolveCandidateLink(entry.name, slateIdx, parliamentByName);
    if (!link) {
      delete (entry as Partial<MunicipalIndexEntry>).candidateLink;
      continue;
    }
    // A real party id means the slate join fired; a photo means the MP join did.
    if (link.partyCanonicalId !== null || link.partyName !== "") partyHits++;
    if (link.photoUrl) photoHits++;
    entry.candidateLink = link;
  }
  fs.writeFileSync(shardPath, JSON.stringify(shard, null, 2) + "\n", "utf8");
  return { obshtina: shard.obshtina, total, partyHits, photoHits };
};

const main = (dryRun: boolean) => {
  const parliamentByName = loadParliamentByName();
  console.log(
    `[decorate] loaded parliament index: ${parliamentByName.size} MPs by name`,
  );

  const shardFiles = fs
    .readdirSync(SHARD_DIR)
    .filter((f) => f.endsWith(".json"));
  console.log(`[decorate] processing ${shardFiles.length} shards…`);

  const totals = { entries: 0, party: 0, photo: 0 };
  const noSlate: string[] = [];
  for (const f of shardFiles) {
    const obshtina = f.replace(/\.json$/, "");
    const miCode = officialsToMi(obshtina);
    const bundle = loadMiBundle(miCode);
    const slateIdx = bundle ? buildSlateIndex(bundle) : null;
    if (!slateIdx) noSlate.push(obshtina);
    const shardPath = path.join(SHARD_DIR, f);
    if (dryRun) {
      // Skip write; just print would-decorate stats.
      const shard = JSON.parse(
        fs.readFileSync(shardPath, "utf8"),
      ) as MunicipalityRosterFile;
      const considered = shard.entries.filter((e) =>
        DECORATED_ROLES.has(e.role),
      ).length;
      totals.entries += considered;
      continue;
    }
    const stats = decorateShard(shardPath, slateIdx, parliamentByName);
    totals.entries += stats.total;
    totals.party += stats.partyHits;
    totals.photo += stats.photoHits;
  }

  const pct = (n: number) =>
    totals.entries === 0 ? "0%" : `${((n / totals.entries) * 100).toFixed(1)}%`;
  console.log(
    `[decorate] ${dryRun ? "dry-run " : ""}done — ${totals.entries} eligible entries, ` +
      `party ${totals.party} (${pct(totals.party)}), photo ${totals.photo} (${pct(totals.photo)})`,
  );
  if (noSlate.length > 0) {
    console.log(
      `[decorate] no local-election bundle for ${noSlate.length} obshtina(s): ` +
        noSlate.slice(0, 8).join(", ") +
        (noSlate.length > 8 ? "…" : ""),
    );
  }
};

// Exported so the municipal ingest can chain it. Re-running municipal.ts
// rewrites the by_obshtina shards wholesale, and this enrichment is written
// back INTO those shards — so an ingest that does not re-decorate silently
// deletes it. That happened once: 5317 candidateLink records (5290 party
// links, 190 photos) vanished from 276 of 288 shards, and the only visible
// symptom was the council tiles falling back to grey initials.
//
// Kept out of the CLI module for the reason ./merge.ts and ./categorise.ts
// are: that module calls run() at import time, so importing it would execute
// the CLI against the caller's argv.
export const decorateCandidateLinks = (dryRun = false): void => main(dryRun);
