/**
 * Build-time generator for the per-party campaign retrospect markdown.
 *
 * Reads the data bundle from bundle_party_data.ts and writes the cached output
 * to public/{election}/parties/assessment/{partyNum}.json. The frontend tile
 * fetches that file directly — no per-visit LLM call.
 *
 * Two modes:
 *   1. (PREFERRED) Hand-written by Claude — see .claude/skills/party-retrospect.
 *      The skill bundles data, Claude reads it, and writes the JSON file.
 *   2. (FALLBACK) Gemini generation — this script. Only used when explicitly
 *      asked for unattended generation across many parties.
 *
 * Usage:
 *   tsx scripts/parties/generate_retrospect.ts --election 2024_10_27 --party 18
 *   tsx scripts/parties/generate_retrospect.ts --election 2024_10_27 --all-passed
 *
 * Requires GEMINI_API_KEY in .env.local.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { command, run, option, string, optional, flag, boolean } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const ENV_FILE = path.resolve(__dirname, "../../.env.local");
const MODEL = "gemini-2.5-pro";

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

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

const callGemini = async (apiKey: string, prompt: string): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gemini ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`gemini returned no text`);
  return text;
};

const buildPrompt = (
  bundle: { election: string; priorElection?: string } & Record<
    string,
    unknown
  >,
): string => {
  return `You are an electoral-strategy analyst writing a campaign retrospect for a Bulgarian political party. The site is electionsbg.com (English + Bulgarian audience). Output a JSON object with two markdown bodies, one per language.

CRITICAL TEMPORAL CONSTRAINT
This retrospect is written from the perspective of someone analyzing the **${bundle.election}** election immediately after it concluded. You must NOT reference any event, party, election, or political development that occurred AFTER ${bundle.election}. The only past data available to you is what is in the INPUT DATA below — use it. If you mention historical patterns, only reference Bulgarian electoral history that PREDATES the selected election. When in doubt, omit the historical reference rather than risk a future-leak. The reader at the time of this election does not know what comes next.

INPUT DATA (deterministic, computed from official Central Election Commission results, scoped to the selected election and prior cycles only):

${JSON.stringify(bundle, null, 2)}

OUTPUT JSON SHAPE — no prose outside JSON, no code fences:
{
  "bg": "<markdown body in Bulgarian>",
  "en": "<markdown body in English>"
}

WRITING RULES

1. Each markdown body is ~350–500 words. Use these exact section headings (translated to BG for the bg body):
   ## Headline result
   ## What worked
   ## What didn't work
   ## Geographic strategy
   ## Polling intelligence
   ## Recommendations for next campaign

2. Headline result — 2-3 sentences. Lead with the result (votes, %, position). Include the change vs the prior election (${bundle.priorElection ?? "no prior — first appearance in our data"}).

3. What worked / What didn't work — 3-5 bullet points each. Every bullet must be grounded in a SPECIFIC NUMBER from the input data. Quote percentages exactly (don't round 26.39 to 26). If priorElection is undefined (party debut OR no prior data in our dataset), frame this as a baseline rather than a swing.

4. Geographic strategy — Identify 2-4 named regions or municipalities from topGainerRegions / topLoserRegions / regions. Recommend defend / attack / abandon stance. Use the Bulgarian name in the BG body, English name in the EN body.

5. Polling intelligence — If polling data exists, name 1-2 agencies (by agencyId — well-known abbreviations) that were closest or biggest miss for THIS party. If no polling data is in the bundle, omit this section entirely.

6. Recommendations — 3-5 prioritized action items the party could plan for whatever comes next. Frame them as "for the next cycle" without naming a date or pre-empting events you cannot know. Make them specific to this party's data, not generic advice.

7. Hedge appropriately. Use "the data suggests", "тенденцията показва". Avoid certainty about causation — these are deterministic vote counts, not causal explanations.

8. Bulgarian must read like native journalism. Don't translate idioms literally.

9. NEVER make up data not in the input. NEVER reference candidates by name unless they appear in the data. NEVER speculate about why voters changed unless the data shows the shift (e.g. "lost 11pp in Razgrad" is fine; "voters were disappointed by leadership" is not).

10. Do not include a top-level # title — the tile already has its own header.

11. NEVER mention parties, leaders, scandals, government formations, or events from any election after ${bundle.election}. NEVER name a party that doesn't appear in the bundle.`;
};

const generate = async (election: string, partyNum: number) => {
  const bundlePath = path.resolve(
    __dirname,
    "../../node_modules/.cache/party-retrospect-bundle.json",
  );
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  execSync(
    `tsx ${path.join(__dirname, "bundle_party_data.ts")} --election ${election} --party ${partyNum} --out ${bundlePath}`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf-8"));

  const prompt = buildPrompt(bundle);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set (check .env.local)");

  const raw = await callGemini(apiKey, prompt);
  let parsed: { bg: string; en: string };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Gemini returned invalid JSON: ${(e as Error).message}\nFirst 500 chars: ${raw.slice(0, 500)}`,
    );
  }

  const outDir = path.join(PUBLIC_DIR, election, "parties", "assessment");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${partyNum}.json`);
  const out = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    partyNum,
    nickName: bundle.party.nickName,
    bg: parsed.bg,
    en: parsed.en,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`✓ wrote ${outFile}`);
};

const generateAllPassed = async (election: string) => {
  // Iterate through cik_parties.json and only generate for parties at >=2% nationally
  const cikPartiesPath = path.join(PUBLIC_DIR, election, "cik_parties.json");
  const electionsIndex = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../../src/data/json/elections.json"),
      "utf-8",
    ),
  ) as {
    name: string;
    results?: { votes: { number: number; totalVotes: number }[] };
  }[];
  const electionInfo = electionsIndex.find((e) => e.name === election);
  if (!electionInfo?.results) {
    throw new Error(`election ${election} has no results in elections.json`);
  }
  const total = electionInfo.results.votes.reduce(
    (s, v) => s + v.totalVotes,
    0,
  );
  const cik = JSON.parse(fs.readFileSync(cikPartiesPath, "utf-8")) as {
    number: number;
  }[];
  const targets = cik.filter((p) => {
    const v = electionInfo.results!.votes.find((vv) => vv.number === p.number);
    return v && (100 * v.totalVotes) / total >= 2;
  });
  console.log(
    `→ generating retrospects for ${targets.length} parties at ≥2%: ${targets
      .map((t) => t.number)
      .join(", ")}`,
  );
  for (const t of targets) {
    try {
      await generate(election, t.number);
    } catch (e) {
      console.error(`✗ party ${t.number}: ${(e as Error).message}`);
    }
  }
};

const app = command({
  name: "generate_retrospect",
  args: {
    election: option({
      type: string,
      long: "election",
      short: "e",
    }),
    party: option({
      type: optional(string),
      long: "party",
      short: "p",
    }),
    allPassed: flag({
      type: optional(boolean),
      long: "all-passed",
      defaultValue: () => false,
      description: "Generate for every party at ≥2% nationally",
    }),
  },
  handler: async ({ election, party, allPassed }) => {
    loadEnv();
    if (allPassed) {
      await generateAllPassed(election);
    } else if (party) {
      await generate(election, parseInt(party, 10));
    } else {
      throw new Error("specify --party N or --all-passed");
    }
  },
});

run(app, process.argv.slice(2));
