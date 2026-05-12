/**
 * Generate AI summaries for OSCE/ODIHR election observation reports using
 * Claude Opus 4.7 and write them back into data/election-observations.json
 * (and public/election-observations.json for the dev server).
 *
 * Usage:
 *   tsx scripts/observations/generate-summaries.ts
 *   tsx scripts/observations/generate-summaries.ts --election 2024-10-27
 *
 * Requires ANTHROPIC_API_KEY in .env.local or environment.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const DATA_FILE = path.join(ROOT, "data/election-observations.json");
const PUBLIC_FILE = path.join(ROOT, "public/election-observations.json");
const ENV_FILE = path.join(ROOT, ".env.local");
const MODEL = "claude-opus-4-7";

const loadEnv = () => {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
};

type ObservationEntry = {
  electionDate: string;
  missionType: string;
  reportUrl: string;
  summaryEn: string;
  summaryBg: string;
  longSummaryEn?: string;
  longSummaryBg?: string;
};

type Payload = {
  source: string;
  sourceUrl: string;
  observations: ObservationEntry[];
};

type SummaryResult = { longSummaryEn: string; longSummaryBg: string };

const buildPrompt = (o: ObservationEntry): string =>
  `
You are writing concise summaries of OSCE/ODIHR election observation mission reports for Bulgaria.

Election date: ${o.electionDate}
Mission type: ${o.missionType} (EAM = Election Assessment Mission, LEOM = Limited Election Observation Mission, EOM = Election Observation Mission)
Report URL: ${o.reportUrl}
Existing short summary (EN): ${o.summaryEn}
Existing short summary (BG): ${o.summaryBg}

Write a richer 3–4 sentence summary in BOTH English and Bulgarian. Each summary should cover:
1. The electoral context (snap election, COVID, protests, etc. if applicable)
2. The main ODIHR finding (free/competitive, well-administered, concerns flagged)
3. The key recommendation(s) (vote buying, campaign finance, legal framework, etc.)

Return ONLY valid JSON with exactly two keys: "longSummaryEn" and "longSummaryBg".
Do not include any markdown fences or extra text outside the JSON object.
`.trim();

const generateSummary = async (
  client: Anthropic,
  o: ObservationEntry,
): Promise<SummaryResult> => {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: buildPrompt(o) }],
  });

  const raw =
    message.content[0].type === "text" ? message.content[0].text.trim() : "";
  return JSON.parse(raw) as SummaryResult;
};

const run = async () => {
  loadEnv();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local or the environment.",
    );
    process.exit(1);
  }

  const filterDate = process.argv
    .find((a) => a.startsWith("--election=") || a === "--election")
    ?.replace("--election=", "");
  const filterIndex = process.argv.indexOf("--election");
  const electionFilter =
    filterDate ?? (filterIndex !== -1 ? process.argv[filterIndex + 1] : null);

  const payload: Payload = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  const client = new Anthropic({ apiKey });

  let updated = 0;
  for (const o of payload.observations) {
    if (electionFilter && o.electionDate !== electionFilter) continue;
    console.log(`Generating summary for ${o.electionDate}…`);
    try {
      const result = await generateSummary(client, o);
      o.longSummaryEn = result.longSummaryEn;
      o.longSummaryBg = result.longSummaryBg;
      updated++;
    } catch (err) {
      console.error(`  Failed for ${o.electionDate}:`, err);
    }
  }

  const out = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(DATA_FILE, out, "utf-8");
  fs.writeFileSync(PUBLIC_FILE, out, "utf-8");
  console.log(`Done. Updated ${updated} observation(s).`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
