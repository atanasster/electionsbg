// Per-councillor attendance + party-dissent signals.
//
// Mirrors the parliament loyalty/attendance derivation but at the municipal
// council grain. For every councillor who appears in any per-município votes
// shard (data/council/votes/<obshtina>.json), compute:
//
//   - attendance — share of resolutions (in this município, in this mandate
//     window) where the councillor cast a vote (За / Против / Въздържал).
//     The full council size for the município comes from the per-obshtina
//     roster shard; total resolutions in the window comes from the votes
//     shard's votesById count. We don't have a separate "absent" record per
//     resolution — Bulgarian protokols list ONLY councillors who voted — so
//     attendance is calculated as (resolutions the councillor appears in) /
//     (total resolutions with перCouncillor data for the município).
//
//   - dissent — share of the councillor's votes that broke with their party
//     majority on the same resolution. Requires:
//       * the candidate-link decoration (party canonical id per councillor),
//       * computing the modal vote of each party on each resolution,
//       * counting per-councillor how often they voted differently from their
//         party's mode.
//     Independents + councillors on local coalitions without canonical id
//     are skipped for dissent (no party reference frame); attendance still
//     ships.
//
// Output: data/officials/derived/councillor_signals.json
//   {
//     generatedAt: ISO,
//     byObshtina: {
//       <obshtinaCode>: {
//         totalResolutions: N,
//         byCouncillor: {
//           <slug>: {
//             votesCast: M,
//             attendance: M/N,            // 0..1
//             forCount, againstCount, abstainCount,
//             dissent: D/M?,              // 0..1, null when no party ref
//             partyCanonicalId?: string,
//           }
//         }
//       }
//     }
//   }
//
// Keyed by obshtina code matching the by_obshtina/<code>.json shard layout
// (not the council pipeline's separate code space — translated via the same
// override table the decorator uses).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { command, run, flag, boolean } from "cmd-ts";
import type { MunicipalityRosterFile } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const VOTES_DIR = path.join(ROOT, "data", "council", "votes");
const SHARD_DIR = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "by_obshtina",
);
const OUT_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "derived",
  "councillor_signals.json",
);

// Bridge between the council pipeline's keys (SOF, VTR01, ...) and the
// officials by_obshtina codes (SFO_CITY, VTR04, ...). Same mapping as
// src/data/council/councilObshtinaMap.ts but evaluated in Node.
const COUNCIL_TO_OFFICIALS: Record<string, string> = {
  SOF: "SFO_CITY",
  VTR01: "VTR04",
  PDV01: "PDV22",
  VAR01: "VAR06",
  BGS01: "BGS04",
  SZR01: "SZR31",
  RSE01: "RSE27",
  PVN01: "PVN24",
  SLV01: "SLV20",
  BLG03: "BLG03",
  GAB05: "GAB05",
  SZR12: "SZR12",
  HKV34: "HKV34",
  DOB28: "DOB28",
};

// --- Types ---------------------------------------------------------------

type VoteValue = "for" | "against" | "abstain";

type VotesShard = {
  obshtinaCode: string;
  votesById: Record<
    string,
    Array<{ name: string; normKey: string; vote: VoteValue }>
  >;
};

type CouncillorSignal = {
  votesCast: number;
  attendance: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  dissent: number | null;
  partyCanonicalId?: string;
};

type SignalsFile = {
  generatedAt: string;
  byObshtina: Record<
    string,
    {
      totalResolutions: number;
      byCouncillor: Record<string, CouncillorSignal>;
    }
  >;
};

// --- Name normalisation (mirror of decorator + tally lib) ----------------

const normaliseName = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();

const firstLastKey = (full: string): string => {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return normaliseName(full);
  return normaliseName(`${parts[0]} ${parts[parts.length - 1]}`);
};

// --- Main ----------------------------------------------------------------

const computeForMuni = (
  votesShard: VotesShard,
  roster: MunicipalityRosterFile,
): SignalsFile["byObshtina"][string] => {
  // 1. Build a slug-by-key lookup from the roster so we can attach signals
  //    to the canonical official slug (not the raw protokol name).
  const rosterByKey = new Map<
    string,
    { slug: string; partyCanonicalId?: string }
  >();
  for (const e of roster.entries) {
    if (
      e.role !== "councillor" &&
      e.role !== "council_chair" &&
      e.role !== "deputy_mayor" &&
      e.role !== "mayor"
    )
      continue;
    const key = firstLastKey(e.name);
    if (!rosterByKey.has(key)) {
      rosterByKey.set(key, {
        slug: e.slug,
        partyCanonicalId: e.candidateLink?.partyCanonicalId ?? undefined,
      });
    }
  }

  // 2. For each resolution: party-mode by canonical id (most-frequent vote
  //    among councillors of that party on that resolution).
  const partyModeByResolution: Map<string, Map<string, VoteValue>> = new Map();

  const resolutionIds = Object.keys(votesShard.votesById);
  for (const rid of resolutionIds) {
    const partyCounts = new Map<
      string,
      { for: number; against: number; abstain: number }
    >();
    for (const row of votesShard.votesById[rid]) {
      const key = firstLastKey(row.name);
      const ros = rosterByKey.get(key);
      const partyId = ros?.partyCanonicalId;
      if (!partyId) continue;
      const c = partyCounts.get(partyId) ?? {
        for: 0,
        against: 0,
        abstain: 0,
      };
      c[row.vote]++;
      partyCounts.set(partyId, c);
    }
    const modes = new Map<string, VoteValue>();
    for (const [partyId, counts] of partyCounts) {
      // Majority vote per party on this resolution. Ties resolved by the
      // priority for > abstain > against (most common pass-through outcome
      // in Bulgarian council mode — За dominates ties).
      const ranked: VoteValue[] = ["for", "abstain", "against"];
      let bestVal: VoteValue = "for";
      let bestCount = -1;
      for (const v of ranked) {
        if (counts[v] > bestCount) {
          bestCount = counts[v];
          bestVal = v;
        }
      }
      modes.set(partyId, bestVal);
    }
    partyModeByResolution.set(rid, modes);
  }

  // 3. Per-councillor signal aggregation.
  const totalResolutions = resolutionIds.length;
  const byCouncillor: Record<string, CouncillorSignal> = {};
  // Track party-aligned/dissenting vote counts per slug for the dissent
  // numerator/denominator.
  const dissentCounts = new Map<
    string,
    { aligned: number; dissented: number }
  >();
  for (const rid of resolutionIds) {
    const modes = partyModeByResolution.get(rid);
    for (const row of votesShard.votesById[rid]) {
      const key = firstLastKey(row.name);
      const ros = rosterByKey.get(key);
      if (!ros) continue;
      const slug = ros.slug;
      const sig = (byCouncillor[slug] ??= {
        votesCast: 0,
        attendance: 0,
        forCount: 0,
        againstCount: 0,
        abstainCount: 0,
        dissent: null,
        partyCanonicalId: ros.partyCanonicalId,
      });
      sig.votesCast++;
      if (row.vote === "for") sig.forCount++;
      else if (row.vote === "against") sig.againstCount++;
      else sig.abstainCount++;

      // Dissent: did this councillor vote differently from their party's
      // mode on THIS resolution?
      const partyId = ros.partyCanonicalId;
      if (partyId && modes) {
        const mode = modes.get(partyId);
        if (mode) {
          const dc = dissentCounts.get(slug) ?? { aligned: 0, dissented: 0 };
          if (row.vote === mode) dc.aligned++;
          else dc.dissented++;
          dissentCounts.set(slug, dc);
        }
      }
    }
  }

  for (const slug of Object.keys(byCouncillor)) {
    const sig = byCouncillor[slug];
    sig.attendance =
      totalResolutions > 0 ? sig.votesCast / totalResolutions : 0;
    const dc = dissentCounts.get(slug);
    if (dc && dc.aligned + dc.dissented > 0) {
      sig.dissent = dc.dissented / (dc.aligned + dc.dissented);
    }
  }

  return { totalResolutions, byCouncillor };
};

const main = (dryRun: boolean) => {
  const out: SignalsFile = {
    generatedAt: new Date().toISOString(),
    byObshtina: {},
  };
  const voteFiles = fs.existsSync(VOTES_DIR)
    ? fs.readdirSync(VOTES_DIR).filter((f) => f.endsWith(".json"))
    : [];
  console.log(`[signals] processing ${voteFiles.length} votes shard(s)…`);

  for (const f of voteFiles) {
    const councilCode = f.replace(/\.json$/, "");
    const officialsCode = COUNCIL_TO_OFFICIALS[councilCode] ?? councilCode;
    const shardPath = path.join(SHARD_DIR, `${officialsCode}.json`);
    if (!fs.existsSync(shardPath)) {
      console.warn(
        `[signals] no officials shard for ${councilCode} (looking for ${officialsCode})`,
      );
      continue;
    }
    const votes = JSON.parse(
      fs.readFileSync(path.join(VOTES_DIR, f), "utf8"),
    ) as VotesShard;
    const roster = JSON.parse(
      fs.readFileSync(shardPath, "utf8"),
    ) as MunicipalityRosterFile;
    const muniSignals = computeForMuni(votes, roster);
    // The signals file is keyed by the OFFICIALS code so the frontend hook
    // resolves directly from the user's area.obshtina.
    out.byObshtina[officialsCode] = muniSignals;
    const slugs = Object.keys(muniSignals.byCouncillor).length;
    const withDissent = Object.values(muniSignals.byCouncillor).filter(
      (s) => s.dissent != null,
    ).length;
    console.log(
      `  ${officialsCode}: ${slugs} councillor(s) over ${muniSignals.totalResolutions} resolution(s); dissent for ${withDissent}`,
    );
  }

  if (dryRun) {
    console.log("[signals] dry-run: no output written");
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const bytes = fs.statSync(OUT_PATH).size;
  console.log(`[signals] wrote ${OUT_PATH} (${(bytes / 1024).toFixed(1)} KB)`);
};

const cli = command({
  name: "build-councillor-signals",
  description:
    "Derive per-councillor attendance + party-dissent signals from data/council/votes/ shards and write data/officials/derived/councillor_signals.json. Run after each council ingest.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Report per-município stats without writing the file.",
    }),
  },
  handler: ({ dryRun }) => main(dryRun),
});

run(cli, process.argv.slice(2));
