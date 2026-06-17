// Derived-metrics runner. Reads data/parliament/votes/sessions/*.json and
// writes data/parliament/votes/derived/*.json.
//
// Each session file embeds its own per-MP party affiliation (from the CSV),
// so the derived metrics don't depend on data/parliament/index.json. Sub-
// second total runtime over a year of plenary days.
//
// CLI:
//   tsx scripts/parliament/derived/index.ts                # rebuild all
//   tsx scripts/parliament/derived/index.ts --upload       # rebuild + upload

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import { computeLoyalty } from "./loyalty";
import { computeAttendance } from "./attendance";
import { computeSimilarity } from "./similarity";
import { computeSimilarityHeadline } from "./similarity_headline";
import type { SimilarityHeadlineSlice } from "./similarity_headline";
import { computeCohesion } from "./cohesion";
import { computeEmbedding } from "./embedding";
import { computePartyCorrelation } from "./party_correlation";
import { computeTopicIndex } from "./topic_index";
import { computeSearchIndex } from "./search_index";
import { computeImportantVotes } from "./important_votes";
import { computeDissents } from "./dissents";
import { computePartyPairBreaks } from "./party_pair_breaks";
import { writeMpShards } from "./per_mp_shards";
import { dedupeRevotes } from "./dedupe";
import type { SessionFile } from "./types";
import { uploadText, uploadTextTree } from "../../lib/upload";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../../data/parliament/votes");
const SESSIONS_DIR = path.join(VOTES_DIR, "sessions");
const DERIVED_DIR = path.join(VOTES_DIR, "derived");

const readAllSessions = (): SessionFile[] => {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map(
    (f) =>
      JSON.parse(
        fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8"),
      ) as SessionFile,
  );
};

const writeJson = (file: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};

// Group sessions by their NS field so each derived metric can be computed
// independently per parliament. Mixing 51st and 52nd NS sessions into one
// aggregate (the old behaviour) produces misleading numbers when a party
// loses its seats between elections — the homepage was showing ИТН in the
// 52nd-NS heatmap even though they didn't make the threshold in April 2026.
const groupByNs = (sessions: SessionFile[]): Map<string, SessionFile[]> => {
  const m = new Map<string, SessionFile[]>();
  for (const s of sessions) {
    const ns = s.ns || "?";
    const arr = m.get(ns) ?? [];
    arr.push(s);
    m.set(ns, arr);
  }
  return m;
};

export const rebuildDerived = async (args: {
  upload: boolean;
}): Promise<void> => {
  const rawSessions = readAllSessions();
  if (rawSessions.length === 0) {
    console.log("✓ no sessions yet; nothing to derive");
    return;
  }

  // Collapse re-votes (an item and its "прегласуване", or a verbatim repeat)
  // so a decision voted N times in a day counts as one dimension, not N.
  const sessions = dedupeRevotes(rawSessions);
  const rawItems = rawSessions.reduce((n, f) => n + f.sessions.length, 0);
  const keptItems = sessions.reduce((n, f) => n + f.sessions.length, 0);
  console.log(
    `→ dedup re-votes: ${rawItems} → ${keptItems} item(s) (dropped ${rawItems - keptItems} superseded cast(s))`,
  );

  const byNs = groupByNs(sessions);
  const nsKeys = [...byNs.keys()].sort();
  const nowIso = new Date().toISOString();
  console.log(
    `→ slicing ${sessions.length} session(s) by NS: ${nsKeys.map((k) => `${k}(${byNs.get(k)!.length})`).join(", ")}`,
  );

  // Each derived file follows the same envelope:
  //   { computedAt, byNs: { "51": <metric>, "52": <metric> } }
  // Consumers pick the slice matching their current election context.

  console.log(`→ computing loyalty per NS`);
  const loyaltyByNs: Record<string, ReturnType<typeof computeLoyalty>> = {};
  for (const ns of nsKeys) loyaltyByNs[ns] = computeLoyalty(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "loyalty.json"), {
    computedAt: nowIso,
    byNs: loyaltyByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${loyaltyByNs[k].entries.length}`).join(", ")} MP entries`,
  );

  console.log(`→ computing attendance per NS`);
  const attendanceByNs: Record<
    string,
    ReturnType<typeof computeAttendance>
  > = {};
  for (const ns of nsKeys)
    attendanceByNs[ns] = computeAttendance(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "attendance.json"), {
    computedAt: nowIso,
    byNs: attendanceByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${attendanceByNs[k].entries.length}`).join(", ")} MP entries`,
  );

  console.log(`→ computing similarity per NS (cosine, top-K)`);
  const similarityByNs: Record<
    string,
    ReturnType<typeof computeSimilarity>
  > = {};
  for (const ns of nsKeys)
    similarityByNs[ns] = computeSimilarity(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "similarity.json"), {
    computedAt: nowIso,
    byNs: similarityByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${similarityByNs[k].entries.length}`).join(", ")} MP entries`,
  );

  // Pre-baked headline for the /parliament hub tile: the seed MP with the
  // most cross-party twins per NS. Replaces a 1.45 MB gzipped fetch of the
  // full similarity aggregate with a ~1 KB total file.
  console.log(`→ computing similarity headline per NS`);
  const similarityHeadlineByNs: Record<string, SimilarityHeadlineSlice> = {};
  for (const ns of nsKeys) {
    const sessions = byNs.get(ns)!;
    const latest = sessions.reduce((a, b) => (b.date > a.date ? b : a));
    const slice = computeSimilarityHeadline(similarityByNs[ns], latest);
    if (slice) similarityHeadlineByNs[ns] = slice;
  }
  writeJson(path.join(DERIVED_DIR, "similarity_headline.json"), {
    computedAt: nowIso,
    byNs: similarityHeadlineByNs,
  });
  console.log(
    `  ✓ ${Object.entries(similarityHeadlineByNs)
      .map(([ns, s]) => `${ns}:${s.crossPartyCount}-cross`)
      .join(", ")}`,
  );

  console.log(`→ computing party cohesion per NS`);
  const cohesionByNs: Record<string, ReturnType<typeof computeCohesion>> = {};
  for (const ns of nsKeys) cohesionByNs[ns] = computeCohesion(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "cohesion.json"), {
    computedAt: nowIso,
    byNs: cohesionByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${cohesionByNs[k].entries.length}`).join(", ")} party entries`,
  );

  console.log(`→ computing 2D UMAP embedding per NS`);
  const embeddingByNs: Record<string, ReturnType<typeof computeEmbedding>> = {};
  for (const ns of nsKeys) embeddingByNs[ns] = computeEmbedding(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "embedding.json"), {
    computedAt: nowIso,
    byNs: embeddingByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${embeddingByNs[k].points.length}`).join(", ")} MPs projected`,
  );

  console.log(`→ computing party-to-party correlation per NS`);
  const partyCorrelationByNs: Record<
    string,
    ReturnType<typeof computePartyCorrelation>
  > = {};
  for (const ns of nsKeys)
    partyCorrelationByNs[ns] = computePartyCorrelation(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "party_correlation.json"), {
    computedAt: nowIso,
    byNs: partyCorrelationByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${partyCorrelationByNs[k].parties.length}²`).join(", ")} party matrices`,
  );

  console.log(`→ computing cross-session topic index per NS`);
  const topicIndexByNs: Record<
    string,
    ReturnType<typeof computeTopicIndex>
  > = {};
  for (const ns of nsKeys)
    topicIndexByNs[ns] = computeTopicIndex(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "topic_index.json"), {
    computedAt: nowIso,
    byNs: topicIndexByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${topicIndexByNs[k].entries.length}`).join(", ")} topic entries`,
  );

  // Slim search projection — top-N-per-NS contested-titled subset that the
  // header search bar's Fuse index needs. Lets /my-area (and every other
  // page that mounts the header) avoid downloading the full topic_index
  // monolith on first interaction.
  console.log(`→ computing slim search index per NS`);
  const searchIndexByNs: Record<
    string,
    ReturnType<typeof computeSearchIndex>
  > = {};
  for (const ns of nsKeys)
    searchIndexByNs[ns] = computeSearchIndex(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "search_index.json"), {
    computedAt: nowIso,
    byNs: searchIndexByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${searchIndexByNs[k].entries.length}`).join(", ")} search entries`,
  );

  // Important-votes shards: the curated subset MyAreaImportantVotesTile
  // needs per-MP votes for. Sharded per NS — each slice is the only one
  // the tile ever consumes for a given election, so a per-NS file lets
  // the SPA fetch ~3-8 KB gzipped instead of the full byNs envelope.
  // Written compact (no indent) — mpVotes alone runs to ~3,600 chars per
  // NS slice, and pretty-printing inflates that ~10×.
  console.log(`→ computing important votes per NS (sharded)`);
  let importantTotal = 0;
  for (const ns of nsKeys) {
    const slice = computeImportantVotes(byNs.get(ns)!);
    fs.mkdirSync(path.join(DERIVED_DIR, "important_votes"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(DERIVED_DIR, "important_votes", `${ns}.json`),
      JSON.stringify({ computedAt: nowIso, ns, ...slice }),
    );
    importantTotal += slice.entries.length;
  }
  // Drop any legacy monolithic file from the prior layout so consumers
  // don't accidentally fall back to it.
  const legacyPath = path.join(DERIVED_DIR, "important_votes.json");
  if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  console.log(
    `  ✓ ${importantTotal} important items across ${nsKeys.length} per-NS shards`,
  );

  console.log(`→ computing per-MP dissents per NS`);
  const dissentsByNs: Record<string, ReturnType<typeof computeDissents>> = {};
  for (const ns of nsKeys) dissentsByNs[ns] = computeDissents(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "dissents.json"), {
    computedAt: nowIso,
    byNs: dissentsByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${dissentsByNs[k].entries.length}`).join(", ")} MP entries`,
  );

  console.log(`→ computing party-pair breaks per NS`);
  const partyPairBreaksByNs: Record<
    string,
    ReturnType<typeof computePartyPairBreaks>
  > = {};
  for (const ns of nsKeys)
    partyPairBreaksByNs[ns] = computePartyPairBreaks(byNs.get(ns)!);
  writeJson(path.join(DERIVED_DIR, "party_pair_breaks.json"), {
    computedAt: nowIso,
    byNs: partyPairBreaksByNs,
  });
  console.log(
    `  ✓ ${nsKeys.map((k) => `${k}:${Object.keys(partyPairBreaksByNs[k].pairs).length}`).join(", ")} party pairs`,
  );

  // Per-MP shards: candidate pages read one tiny JSON instead of the three
  // monolithic NS aggregates above. Aggregate files stay in place for the
  // browse-the-whole-chamber screens. Runs last so it can reuse the metrics
  // already computed above without re-walking the session data.
  console.log(`→ writing per-MP shards`);
  let shardWritten = 0;
  let shardUnchanged = 0;
  let shardPruned = 0;
  for (const ns of nsKeys) {
    const res = writeMpShards(DERIVED_DIR, {
      ns,
      loyalty: loyaltyByNs[ns],
      attendance: attendanceByNs[ns],
      similarity: similarityByNs[ns],
      dissents: dissentsByNs[ns],
    });
    shardWritten += res.written;
    shardUnchanged += res.unchanged;
    shardPruned += res.pruned;
  }
  console.log(
    `  ✓ ${shardWritten} written, ${shardUnchanged} unchanged, ${shardPruned} pruned`,
  );

  if (args.upload) {
    console.log(`→ uploading derived/ to bucket`);
    for (const f of [
      "loyalty.json",
      "attendance.json",
      "similarity.json",
      "similarity_headline.json",
      "cohesion.json",
      "embedding.json",
      "party_correlation.json",
      "topic_index.json",
      "search_index.json",
      "dissents.json",
      "party_pair_breaks.json",
    ]) {
      await uploadText(
        path.join(DERIVED_DIR, f),
        `parliament/votes/derived/${f}`,
      );
    }
    // Important-votes shards: one tiny file per NS under
    // derived/important_votes/<ns>.json. Same uploadTextTree flow as the
    // per-MP shards.
    await uploadTextTree(
      path.join(DERIVED_DIR, "important_votes"),
      "parliament/votes/derived/important_votes",
    );
    // Per-MP shards live in per-mp/<ns>/<mpId>.json. ~2,400 files total
    // across the 9 ingested NSes (one per MP that ever cast a vote). On the
    // very first deploy after this code lands, expect ~2,400 net-new objects
    // in the bucket — the data-changes diff-cap may flag it; subsequent runs
    // touch only changed shards thanks to the writeIfChanged guard upstream.
    // uploadTextTree streams them with the same defaults as everything else
    // under derived/.
    await uploadTextTree(
      path.join(DERIVED_DIR, "per-mp"),
      "parliament/votes/derived/per-mp",
    );
    console.log(`✓ uploaded`);
  }
};

const cli = command({
  name: "rebuild-derived",
  args: {
    upload: flag({
      type: optional(boolean),
      long: "upload",
      defaultValue: () => false,
    }),
  },
  handler: (args) => rebuildDerived({ upload: !!args.upload }),
});

// Only run the CLI when this module is the entry point. When the roll-call
// ingest imports rebuildDerived() to refresh metrics in-process, the CLI must
// stay dormant (otherwise cmd-ts would try to parse the ingest's argv).
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) run(cli, process.argv.slice(2));
