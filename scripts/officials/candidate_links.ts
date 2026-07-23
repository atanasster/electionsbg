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
  OfficialCandidateLink,
} from "../../src/data/dataTypes";

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
const MI_CYCLE = "2023_10_29_mi";
const MI_DIR = path.join(ROOT, "data", MI_CYCLE, "municipalities");
const PARLIAMENT_INDEX = path.join(ROOT, "data", "parliament", "index.json");

// Obshtina-code mapping when the officials tier and the local-election tier
// use different keys. Only Sofia city-wide ("SFO_CITY" in officials ↔
// "SOF" in mi2023) needs translation today.
const OBSHTINA_OVERRIDES: Record<string, string> = {
  SFO_CITY: "SOF",
};

const officialsToMi = (obshtina: string): string =>
  OBSHTINA_OVERRIDES[obshtina] ?? obshtina;

// --- Name normalisation ---------------------------------------------------
//
// Roster `normalizedName` is UPPERCASE 3-part ("АБЕДИН РАКИПОВ КАМБУРОВ").
// Local-election candidate names are mixed-case full names ("Абедин Ракипов
// Камбуров") — normalise on the fly. We join on the full 3-part name when
// available, falling back to first+last if the slate row dropped the middle
// name (rare but happens for hyphenated families).

const normalise = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[-\s]+/g, " ")
    .trim();

const firstLastKey = (s: string): string => {
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return normalise(s);
  return normalise(`${parts[0]} ${parts[parts.length - 1]}`);
};

// --- Loaders --------------------------------------------------------------

type SlateRow = {
  name: string;
  partyName: string;
  partyCanonicalId: string | null;
  listPos: number;
  prefVotes: number;
  isElected: boolean;
};

type MiMuni = {
  council?: Record<
    string,
    {
      localPartyName: string;
      primaryCanonicalId: string | null;
      candidates: Array<{
        listPos: number;
        name: string;
        prefVotes: number;
        isElected: boolean;
      }>;
    }
  >;
};

/** Build a name→slate-row index for one local-election município bundle.
 *  Maps both the full normalised name AND the first+last fallback. The
 *  full-name match wins when both fire (e.g. two councillors with the same
 *  first+last in different slates). */
const buildSlateIndex = (
  bundle: MiMuni,
): { byFull: Map<string, SlateRow>; byFirstLast: Map<string, SlateRow> } => {
  const byFull = new Map<string, SlateRow>();
  const byFirstLast = new Map<string, SlateRow>();
  if (!bundle.council) return { byFull, byFirstLast };
  for (const slate of Object.values(bundle.council)) {
    for (const c of slate.candidates) {
      const row: SlateRow = {
        name: c.name,
        partyName: slate.localPartyName,
        partyCanonicalId: slate.primaryCanonicalId,
        listPos: c.listPos,
        prefVotes: c.prefVotes,
        isElected: c.isElected,
      };
      const full = normalise(c.name);
      const fl = firstLastKey(c.name);
      // First-wins on full so we don't clobber a more-specific match.
      // Last-wins on first+last is fine — collisions are rare and we'd
      // rather get one party right than show nothing.
      if (!byFull.has(full)) byFull.set(full, row);
      byFirstLast.set(fl, row);
    }
  }
  return { byFull, byFirstLast };
};

const loadMiBundle = (obshtina: string): MiMuni | null => {
  const file = path.join(MI_DIR, `${obshtina}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as MiMuni;
};

type MpRow = { id: number; normalizedName: string; photoUrl?: string };

const loadParliamentByName = (): Map<string, MpRow> => {
  const idx = JSON.parse(fs.readFileSync(PARLIAMENT_INDEX, "utf8")) as {
    mps: Array<{ id: number; normalizedName?: string; photoUrl?: string }>;
  };
  const map = new Map<string, MpRow>();
  for (const m of idx.mps) {
    if (!m.normalizedName) continue;
    const key = normalise(m.normalizedName);
    // Keep the entry that has a photo — when a name maps to multiple MPs
    // (sons-of, namesakes), a photo-bearing one is the better display
    // candidate. Otherwise first-wins.
    const existing = map.get(key);
    if (!existing || (m.photoUrl && !existing.photoUrl)) {
      map.set(key, {
        id: m.id,
        normalizedName: m.normalizedName,
        photoUrl: m.photoUrl,
      });
    }
  }
  return map;
};

// --- Main pass ------------------------------------------------------------

type ShardStats = {
  obshtina: string;
  total: number;
  partyHits: number;
  photoHits: number;
};

const decorateShard = (
  shardPath: string,
  slateIdx: ReturnType<typeof buildSlateIndex> | null,
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
    if (
      entry.role !== "councillor" &&
      entry.role !== "council_chair" &&
      entry.role !== "deputy_mayor" &&
      entry.role !== "mayor"
    ) {
      delete (entry as Partial<MunicipalIndexEntry>).candidateLink;
      continue;
    }
    total++;
    const fullKey = normalise(entry.name);
    const flKey = firstLastKey(entry.name);

    // 1. Slate join
    let slateRow: SlateRow | undefined;
    if (slateIdx) {
      slateRow =
        slateIdx.byFull.get(fullKey) ?? slateIdx.byFirstLast.get(flKey);
    }

    // 2. Parliament photo join
    const mp = parliamentByName.get(fullKey) ?? parliamentByName.get(flKey);

    if (!slateRow && !mp) {
      delete (entry as Partial<MunicipalIndexEntry>).candidateLink;
      continue;
    }
    if (slateRow) partyHits++;
    if (mp?.photoUrl) photoHits++;

    const link: OfficialCandidateLink = slateRow
      ? {
          cycle: MI_CYCLE,
          partyName: slateRow.partyName,
          partyCanonicalId: slateRow.partyCanonicalId,
          listPos: slateRow.listPos,
          prefVotes: slateRow.prefVotes,
          isElected: slateRow.isElected,
        }
      : {
          // MP-only fallback: no slate row, but the MP join still gives us
          // photo + id. Use synthetic listPos=0 so consumers can detect "no
          // slate data" via the absence of a real party id.
          cycle: MI_CYCLE,
          partyName: "",
          partyCanonicalId: null,
          listPos: 0,
          prefVotes: 0,
          isElected: false,
        };
    if (mp) {
      link.mpId = mp.id;
      if (mp.photoUrl) link.photoUrl = mp.photoUrl;
    }
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
      const considered = shard.entries.filter(
        (e) =>
          e.role === "councillor" ||
          e.role === "council_chair" ||
          e.role === "deputy_mayor" ||
          e.role === "mayor",
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
