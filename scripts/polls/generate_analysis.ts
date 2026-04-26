/**
 * Turns public/polls/accuracy.json into a runtime-loaded narrative
 * (public/polls/analysis.json) via Gemini calls. The narrative has two parts:
 *
 *   1. agencyTakes — cross-election profile for each polling agency (one Gemini call)
 *   2. byElection[date] — per-election headlines + story (N Gemini calls, run with
 *      concurrency 3). This way each election shows headlines that actually describe
 *      that election rather than always describing the 2026 cycle.
 *
 * Frontend fetches this static JSON on /polls — no per-visit API cost.
 *
 * Usage:
 *   tsx scripts/polls/generate_analysis.ts
 *   tsx scripts/polls/generate_analysis.ts --only 2026-04-19   # regenerate one election
 *
 * Requires GEMINI_API_KEY in .env.local.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, string, optional } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLLS_DIR = path.resolve(__dirname, "../../public/polls");
const ENV_FILE = path.resolve(__dirname, "../../.env.local");
// gemini-2.5-pro is the higher-quality default for new generations. The hand-crafted
// analysis.json shipped with this repo was written by Claude Opus 4.7; future
// regenerations via this script will overwrite it with Gemini output.
const MODEL = "gemini-2.5-pro";
const ELECTION_CONCURRENCY = 3;

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

type Accuracy = {
  generatedAt: string;
  elections: {
    electionDate: string;
    actualResults: { key: string; pct: number; passedThreshold: boolean }[];
    agencies: {
      agencyId: string;
      pollId: string;
      fieldworkEnd: string;
      daysBefore: number;
      respondents: number | null;
      errors: { key: string; polled: number; actual: number; error: number }[];
      mae: number;
      rmse: number;
      biggestMiss: { key: string; error: number };
    }[];
  }[];
  agencyProfiles: {
    agencyId: string;
    name_bg: string;
    name_en: string;
    totalPolls: number;
    preElectionPolls: number;
    electionsCovered: string[];
    overallMAE: number;
    overallRMSE: number;
    partyBias: { key: string; meanError: number; samples: number }[];
    blocLean: Record<string, { meanError: number; samples: number }>;
    houseEffect: { key: string; meanDiff: number; samples: number }[];
  }[];
};

type AgencyTake = {
  agencyId: string;
  summary: { en: string; bg: string };
  lean: { en: string; bg: string };
  warning: { en: string; bg: string };
};

type ElectionNarrative = {
  headlines: { en: string[]; bg: string[] };
  story: { en: string; bg: string };
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

const callGemini = async (apiKey: string, prompt: string): Promise<string> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gemini ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text)
    throw new Error(
      `gemini returned no text: ${JSON.stringify(json).slice(0, 300)}`,
    );
  return text;
};

// ──────────── prompt builders ────────────

const buildAgencyTakesPrompt = (acc: Accuracy): string => {
  const agencyLines = acc.agencyProfiles
    .map((p) => {
      const blocLines = Object.entries(p.blocLean)
        .filter(([, v]) => v.samples > 0)
        .map(
          ([k, v]) =>
            `${k}=${v.meanError > 0 ? "+" : ""}${v.meanError} (n=${v.samples})`,
        )
        .join(", ");
      const partyLines = p.partyBias
        .slice(0, 5)
        .map(
          (b) =>
            `${b.key}=${b.meanError > 0 ? "+" : ""}${b.meanError} (n=${b.samples})`,
        )
        .join(", ");
      const houseLines = p.houseEffect
        .slice(0, 4)
        .map(
          (h) =>
            `${h.key}=${h.meanDiff > 0 ? "+" : ""}${h.meanDiff} (n=${h.samples})`,
        )
        .join(", ");
      return `- ${p.agencyId} (${p.name_en} / ${p.name_bg}): MAE=${p.overallMAE}, elections=${p.electionsCovered.length} (${p.electionsCovered.join(", ")})
    party bias (signed mean error, + = overpolls): ${partyLines || "(insufficient data)"}
    bloc lean: ${blocLines}
    house effect vs cross-agency consensus: ${houseLines || "(insufficient data)"}`;
    })
    .join("\n");

  return `You are an electoral-statistics analyst writing for a Bulgarian-elections site. Below are deterministic accuracy numbers for each polling agency, computed from their final pre-election polls vs the actual Central Election Commission results across multiple elections. Produce per-agency profiles in JSON.

INTERPRETATION GUIDE
- "MAE" = mean absolute error in percentage points across parties in an agency's last pre-election poll (averaged across all the elections they polled).
- party bias / bloc lean: signed mean error. Positive = the agency *overestimated* that party/bloc relative to the actual result. Negative = underestimated.
- Bloc names: right_govt = GERB(-SDS) and traditional centre-right. reformist = PP-DB, DB, ПрБ. nationalist = Възраждане, Сияние, Атака, МЕЧ, Величие, ОП. left = BSP. minority = DPS / ДПС-НН / АПС. populist = ИТН, Воля, Български възход.
- "house effect" = how an agency differs from the cross-agency consensus *in the same polling period* — useful for inter-election polls where there's no ground truth.
- Sample sizes are small (most agencies have polled 3–7 elections in our dataset). Hedge: use "tends to", "in the limited sample", "appears to". MAE 1.5-2 is accurate; >3 is noisy; n<3 elections is provisional.
- Quote numbers exactly as given.

AGENCY HISTORICAL PROFILES:
${agencyLines}

OUTPUT JSON (no prose outside JSON):
{
  "agencyTakes": [
    {
      "agencyId": "AR",
      "summary": { "en": "2-3 sentence cross-election profile", "bg": "Same in BG" },
      "lean": { "en": "1 sentence on this agency's lean (which parties/blocs they over/under-poll)", "bg": "Same" },
      "warning": { "en": "1 sentence caveat (sample size, methodology drift) — empty string if none", "bg": "Same" }
    }
  ]
}

Include every agency listed above in agencyTakes, in the same order.`;
};

const buildElectionPrompt = (acc: Accuracy, electionDate: string): string => {
  const e = acc.elections.find((x) => x.electionDate === electionDate)!;
  const actualLines = e.actualResults
    .filter((r) => r.passedThreshold || r.pct >= 2)
    .map((r) => `${r.key}=${r.pct}%`)
    .join(", ");
  const errorLines = [...e.agencies]
    .sort((a, b) => a.mae - b.mae)
    .map(
      (a) =>
        `  - ${a.agencyId}: MAE=${a.mae}, ${a.daysBefore}d before election, n=${a.respondents}, biggest miss=${a.biggestMiss.key} ${a.biggestMiss.error > 0 ? "+" : ""}${a.biggestMiss.error}pp, full errors: ${a.errors.map((er) => `${er.key} ${er.error > 0 ? "+" : ""}${er.error}`).join(" ")}`,
    )
    .join("\n");

  return `You are an electoral-statistics analyst writing for a Bulgarian-elections site. Produce a JSON narrative SPECIFIC TO THE ${electionDate} parliamentary election. Quote numbers exactly as given. Do NOT add facts I have not provided. The narrative must describe THIS election — not other elections.

ELECTION: ${electionDate}

ACTUAL RESULT (parties ≥2%): ${actualLines}

LAST PRE-ELECTION POLL ERRORS (each agency's last poll before the vote):
${errorLines}

INTERPRETATION GUIDE
- MAE = mean absolute error in percentage points across parties.
- Signed error: + = pollster overestimated that party; − = underestimated.
- Hedge with "tends to", "in this poll", "the data suggests". Don't extrapolate beyond the numbers.
- A typical Bulgarian polling MAE is 1.5–3pp; 4+ is a meaningful miss.

OUTPUT JSON (no markdown, no prose outside JSON):
{
  "headlines": {
    "en": ["3-5 sentence-length bullet takeaways for an English reader, all about THIS ${electionDate} election"],
    "bg": ["Same number of bullets in Bulgarian"]
  },
  "story": {
    "en": "2-4 sentence narrative summarizing the polling-vs-actual story for this election",
    "bg": "Same in Bulgarian"
  }
}

Headlines should call out: who won and by how much, where the consensus poll was right or wrong, biggest miss, any standout agency performance — all SPECIFIC TO THIS election. The story should weave these into a paragraph.`;
};

// ──────────── runner ────────────

const parseJsonOrFail = (
  raw: string,
  contextFile: string,
): Record<string, unknown> => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (e) {
    fs.writeFileSync(contextFile, raw);
    throw new Error(
      `Gemini returned invalid JSON; raw saved to ${contextFile}: ${(e as Error).message}`,
    );
  }
};

const runWithConcurrency = async <T, R>(
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
};

const main = async (opts: { pollsDir: string; only?: string }) => {
  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set (check .env.local)");

  const accFile = path.join(opts.pollsDir, "accuracy.json");
  if (!fs.existsSync(accFile))
    throw new Error(`missing ${accFile} — run analyze_accuracy first`);
  const acc = JSON.parse(fs.readFileSync(accFile, "utf-8")) as Accuracy;

  // Existing analysis is reused as a partial cache when --only is given so we don't
  // re-spend tokens on every election just to fix one.
  const outFile = path.join(opts.pollsDir, "analysis.json");
  const prior = fs.existsSync(outFile)
    ? (JSON.parse(fs.readFileSync(outFile, "utf-8")) as {
        agencyTakes?: AgencyTake[];
        byElection?: Record<string, ElectionNarrative>;
      })
    : null;

  // ─── per-election narratives ───
  const targets = opts.only
    ? [opts.only]
    : acc.elections.map((e) => e.electionDate);
  const valid = targets.filter((d) =>
    acc.elections.some((e) => e.electionDate === d && e.agencies.length > 0),
  );
  const skipped = targets.filter((d) => !valid.includes(d));
  if (skipped.length)
    console.log(
      `  (skipping elections with no agency data: ${skipped.join(", ")})`,
    );

  const byElection: Record<string, ElectionNarrative> = {
    ...(prior?.byElection ?? {}),
  };
  console.log(
    `→ generating per-election narratives for ${valid.length} elections (concurrency ${ELECTION_CONCURRENCY})`,
  );

  await runWithConcurrency(
    valid,
    async (date) => {
      const prompt = buildElectionPrompt(acc, date);
      const raw = await callGemini(apiKey, prompt);
      const parsed = parseJsonOrFail(
        raw,
        path.join(opts.pollsDir, `analysis.${date}.raw.txt`),
      );
      byElection[date] = parsed as unknown as ElectionNarrative;
      console.log(`  ✓ ${date}`);
    },
    ELECTION_CONCURRENCY,
  );

  // ─── agency takes (only when doing a full run; preserve when --only is set) ───
  let agencyTakes: AgencyTake[];
  if (opts.only && prior?.agencyTakes) {
    console.log(
      `→ keeping existing agencyTakes (${prior.agencyTakes.length} entries) — use full run to refresh`,
    );
    agencyTakes = prior.agencyTakes;
  } else {
    console.log(`→ generating cross-election agencyTakes`);
    const raw = await callGemini(apiKey, buildAgencyTakesPrompt(acc));
    const parsed = parseJsonOrFail(
      raw,
      path.join(opts.pollsDir, "analysis.agencyTakes.raw.txt"),
    );
    agencyTakes = (parsed.agencyTakes as AgencyTake[]) ?? [];
    console.log(`  ✓ ${agencyTakes.length} agency takes`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    inputAccuracyGeneratedAt: acc.generatedAt,
    agencyTakes,
    byElection,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(
    `✓ wrote ${outFile}  (${Object.keys(byElection).length} elections, ${agencyTakes.length} agency takes)`,
  );
};

const cli = command({
  name: "generate_analysis",
  args: {
    pollsDir: option({
      type: string,
      long: "polls",
      defaultValue: () => POLLS_DIR,
    }),
    only: option({ type: optional(string), long: "only" }),
  },
  handler: async (args) => {
    await main({ pollsDir: args.pollsDir, only: args.only });
  },
});

run(cli, process.argv.slice(2));
