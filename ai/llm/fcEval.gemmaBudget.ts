// One-off: measure Gemma-4-31B on the Gemini API at a given output-token budget,
// over the FULL registry (same prompt path as fcEval.artifact.ts's gemma row),
// with PER-CASE CHECKPOINTING so a killed/throttled run resumes where it left
// off (background Bash here gets reclaimed on long runs). Writes the FcReport the
// artifact builder ingests as the cache for the matching spec id.
//
//   npx tsx ai/llm/fcEval.gemmaBudget.ts 1536
//
// Progress is visible via the .partial file (grows per case) even though stderr
// buffers when redirected to a log. Re-run the same command to resume.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  scoreCase,
  type CaseScore,
  type FcCase,
  type FcReport,
  type LangReport,
} from "./fcEval";
import { makeGeminiComplete } from "./fcEval.cloud";
import { registrySuite } from "./fcEval.registry";

const ROOT = process.cwd();
const budget = Number(process.argv[2]) || 1536;
const CACHE = join(
  ROOT,
  `ai/llm/_fc_cache/google_gemma_4_31b_it_${budget}.json`,
);
const PARTIAL = CACHE + ".partial";

// Load GEMINI_API_KEY from .env.local (overrides any stale shell value).
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(
  /\r?\n/,
)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY missing");

const { tools, cases } = registrySuite();
const complete = makeGeminiComplete("gemma-4-31b-it", key, {
  delayMs: 1500,
  maxOutputTokens: budget,
});

const tasks: { c: FcCase; lang: "en" | "bg" }[] = [];
for (const c of cases)
  for (const lang of ["en", "bg"] as const) tasks.push({ c, lang });

const langReport = (scores: CaseScore[], lang: "en" | "bg"): LangReport => {
  const s = scores.filter((x) => x.lang === lang);
  const relevant = s.filter((x) => x.expectedTool !== null);
  const irr = s.filter((x) => x.expectedTool === null);
  return {
    lang,
    n: s.length,
    toolAcc: s.length ? s.filter((x) => x.toolOk).length / s.length : 0,
    argAcc: null,
    jsonValidRate: relevant.length
      ? relevant.filter((x) => x.jsonValid).length / relevant.length
      : 0,
    irrelevanceAcc: irr.length
      ? irr.filter((x) => x.toolOk).length / irr.length
      : null,
  };
};

const main = async () => {
  const done: CaseScore[] = existsSync(PARTIAL)
    ? (JSON.parse(readFileSync(PARTIAL, "utf8")) as CaseScore[])
    : [];
  const seen = new Set(done.map((s) => `${s.id}|${s.lang}`));
  mkdirSync(dirname(CACHE), { recursive: true });

  for (const { c, lang } of tasks) {
    if (seen.has(`${c.id}|${lang}`)) continue;
    const raw = await complete(c[lang], tools);
    done.push(scoreCase(c, lang, raw));
    writeFileSync(PARTIAL, JSON.stringify(done));
    console.error(`${done.length}/${tasks.length} ${c.id}/${lang}`);
  }

  const en = langReport(done, "en");
  const bg = langReport(done, "bg");
  const report: FcReport = {
    perLang: { en, bg },
    degradation: { toolAcc: en.toolAcc - bg.toolAcc, argAcc: null },
    scores: done,
  };
  writeFileSync(CACHE, JSON.stringify(report));
  console.error(
    `\nwrote ${CACHE}\n  EN toolAcc ${en.toolAcc} · BG ${bg.toolAcc}`,
  );
};

main();
