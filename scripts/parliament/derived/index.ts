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
import { computeSimilarity } from "./similarity";
import { computeCohesion } from "./cohesion";
import { computeEmbedding } from "./embedding";
import { computePartyCorrelation } from "./party_correlation";
import { dedupeRevotes } from "./dedupe";
import type { SessionFile } from "./types";
import { uploadText } from "../../lib/upload";

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

const main = async (args: { upload: boolean }): Promise<void> => {
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

  if (args.upload) {
    console.log(`→ uploading derived/ to bucket`);
    for (const f of [
      "loyalty.json",
      "similarity.json",
      "cohesion.json",
      "embedding.json",
      "party_correlation.json",
    ]) {
      await uploadText(
        path.join(DERIVED_DIR, f),
        `parliament/votes/derived/${f}`,
      );
    }
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
  handler: (args) => main({ upload: !!args.upload }),
});

run(cli, process.argv.slice(2));
