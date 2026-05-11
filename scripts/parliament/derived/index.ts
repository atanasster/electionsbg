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

const main = async (args: { upload: boolean }): Promise<void> => {
  const sessions = readAllSessions();
  if (sessions.length === 0) {
    console.log("✓ no sessions yet; nothing to derive");
    return;
  }

  console.log(`→ computing loyalty over ${sessions.length} session(s)`);
  const loyalty = computeLoyalty(sessions);
  writeJson(path.join(DERIVED_DIR, "loyalty.json"), loyalty);
  console.log(`  ✓ ${loyalty.entries.length} MP entries`);

  console.log(`→ computing similarity (cosine, top-K)`);
  const similarity = computeSimilarity(sessions);
  writeJson(path.join(DERIVED_DIR, "similarity.json"), similarity);
  console.log(
    `  ✓ ${similarity.entries.length} MP entries, top-K=${similarity.topK}`,
  );

  console.log(`→ computing party cohesion`);
  const cohesion = computeCohesion(sessions);
  writeJson(path.join(DERIVED_DIR, "cohesion.json"), cohesion);
  console.log(`  ✓ ${cohesion.entries.length} party entries`);

  if (args.upload) {
    console.log(`→ uploading derived/ to bucket`);
    for (const f of ["loyalty.json", "similarity.json", "cohesion.json"]) {
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
