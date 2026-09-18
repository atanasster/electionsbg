// How do the rules, Jev's raw pick and the Jev LANE hold up on questions the
// rules were never built from?
//
//   TYPESAFE_API_KEY=… GEMINI_API_KEY=… npx tsx ai/llm/jevRobustness.ts
//   npx tsx ai/llm/jevRobustness.ts --rescore      # no API calls
//
// Writes data/ai/evals/jev_robustness.json — NOT a `current_*.json`: the
// manifest publishes every one of those as a run of the shipped router.
//
// ⚠️ WHY THIS EXISTS. The main bank is 91% sentences the rules were BUILT
// FROM: `typoMatch.ts` and `domainScope.ts` index every tool's `examples` and
// every starter, and those are the bank's `registry` and `starter` groups. So
// the rules are graded largely on their own vocabulary, and the Jev lane — which
// falls back to the rules and borrows their arguments — inherits that
// advantage. This measures all three on variants the rules cannot have seen:
//
//   original    the question as written (the baseline for the rest)
//   typo        two content words with a transposed / dropped / doubled letter
//   latin       Bulgarian typed in Latin letters, as many users actually do
//   paraphrase  reworded by a model into everyday language, same meaning
//
// and it records Jev's RAW pick, so "Jev classifies well" and "the Jev lane
// scores well" can be told apart — the lane only uses Jev's pick when the rules
// agree or the tool takes no parameters (`acceptJevPick`).
//
// Only the TOOL choice is scored: the variants change wording, not meaning, so
// the expected tool is unchanged, while expected argument values would not
// survive a paraphrase.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { NON_AI_CASES, normalizeRouteForScoring } from "../tests/nonAiEval";
import type { EvalCase } from "./currentEval";
import { selectHeuristicRoute } from "./heuristicRoute";
import { jevLaneRoute } from "./jevLane";
import { directAsk } from "./jevDirectAsk";
import { JEV_CONFIDENCE_GATE } from "./jev";
import { NO_TOOL } from "./jevPrompt";
import { translitKey } from "../tools/translit";
import type { askJev, JevResult } from "./jevClient";
import type { Lang, ToolContext } from "../tools/types";

const OUT = "data/ai/evals/jev_robustness.json";
const PARAPHRASES = "data/ai/evals/jev_robustness.paraphrases.json";
const VARIANTS = ["original", "typo", "latin", "paraphrase"] as const;
type Variant = (typeof VARIANTS)[number];

/** One example per tool (its first — the bank has several per tool and they
 *  are near-duplicates) plus every hand-written group with a single expected
 *  tool and no conversation history. */
const pickCases = (): EvalCase[] => {
  const seenTool = new Set<string>();
  return NON_AI_CASES.filter((c) => {
    if (!c.tool || c.history) return false;
    if (c.group === "registry") {
      if (seenTool.has(c.tool)) return false;
      seenTool.add(c.tool);
      return true;
    }
    return ["realistic", "challenge", "holdout"].includes(c.group);
  });
};

// ---- deterministic perturbations --------------------------------------

/** A small seeded PRNG, so a re-run perturbs identically. */
const rng = (seed: string) => {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
};

/** Two of the longest words each get one realistic slip: two neighbouring
 *  letters swapped, one dropped, or one doubled. The first letter is kept —
 *  people rarely mistype it. */
export const typo = (q: string, seed: string): string => {
  const r = rng(seed);
  const words = q.split(/(\s+)/);
  const candidates = words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => /^[\p{L}]{5,}$/u.test(w))
    .sort((a, b) => b.w.length - a.w.length)
    .slice(0, 2);
  for (const { w, i } of candidates) {
    const chars = [...w];
    const at = 1 + Math.floor(r() * (chars.length - 2));
    const op = Math.floor(r() * 3);
    if (op === 0 && at + 1 < chars.length)
      [chars[at], chars[at + 1]] = [chars[at + 1], chars[at]];
    else if (op === 1) chars.splice(at, 1);
    else chars.splice(at, 0, chars[at]);
    // Keep the original capitalisation of the first letter.
    words[i] = chars.join("");
  }
  return words.join("");
};

/** Bulgarian typed in Latin letters, lower-case, punctuation kept. */
export const latin = (q: string): string =>
  q
    .split(/(\s+|[?.,!:;„“"()])/)
    .map((tok) => (/\p{Script=Cyrillic}/u.test(tok) ? translitKey(tok) : tok))
    .join("");

// ---- paraphrases (generated once, cached, reviewable) -------------------

const PARAPHRASE_INSTRUCTIONS: Record<Lang, string> = {
  bg: "Преформулирай всеки въпрос така, както би го написал обикновен човек в чат: с други думи и разговорно, но със същия смисъл. Запази имената, годините, местата и числата. Където има синоним, не използвай думите от оригинала. Върни САМО JSON масив от низове, в същия ред и със същия брой елементи.",
  en: "Rewrite each question the way an ordinary person would type it into a chat: different words, casual, same meaning. Keep names, years, places and numbers. Where a synonym exists, do not reuse the original's words. Return ONLY a JSON array of strings, in the same order and with the same number of items.",
};

const paraphraseBatch = async (
  apiKey: string,
  lang: Lang,
  questions: string[],
): Promise<string[]> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${PARAPHRASE_INSTRUCTIONS[lang]}\n\n${JSON.stringify(questions)}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
        },
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    // Any other failure is permanent (a retired model, a bad key): retrying
    // it only hides the cause behind "failed after retries".
    if (!res.ok)
      throw new Error(
        `paraphrase (${lang}): HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    try {
      const out = JSON.parse(text) as unknown;
      if (
        Array.isArray(out) &&
        out.length === questions.length &&
        out.every((x) => typeof x === "string" && x.trim())
      )
        return out as string[];
    } catch {
      /* retried below */
    }
  }
  throw new Error(`paraphrase batch (${lang}) failed after retries`);
};

const paraphrases = async (
  cases: EvalCase[],
): Promise<Record<string, string>> => {
  const cache: Record<string, string> = existsSync(PARAPHRASES)
    ? JSON.parse(readFileSync(PARAPHRASES, "utf8"))
    : {};
  const apiKey = process.env.GEMINI_API_KEY;
  for (const lang of ["en", "bg"] as const) {
    const todo = cases.filter((c) => !cache[`${c.id}|${lang}`]);
    if (!todo.length) continue;
    if (!apiKey) throw new Error("GEMINI_API_KEY is required to paraphrase");
    for (let i = 0; i < todo.length; i += 20) {
      const batch = todo.slice(i, i + 20);
      const out = await paraphraseBatch(
        apiKey,
        lang,
        batch.map((c) => c[lang]),
      );
      batch.forEach((c, k) => (cache[`${c.id}|${lang}`] = out[k]));
      writeFileSync(PARAPHRASES, JSON.stringify(cache, null, 2) + "\n");
      console.error(`  paraphrased ${lang} ${i + batch.length}/${todo.length}`);
    }
  }
  return cache;
};

// ---- scoring ----------------------------------------------------------

export type RobustRow = {
  id: string;
  group: string;
  lang: Lang;
  variant: Variant;
  question: string;
  expectedTool: string;
  rulesTool: string | null;
  rulesOk: boolean;
  /** Jev's own answer, before the confidence gate and before the lane decides
   *  whether to use it — the classifier on its own. */
  jevPick: string | null;
  jevConfidence: number | null;
  jevRawOk: boolean;
  laneTool: string | null;
  laneOk: boolean;
  laneUsedJev: boolean;
  degraded: boolean;
};

const ctxFor = (lang: Lang): ToolContext => ({ lang, election: "2026_04_19" });

const scoreOne = async (
  c: EvalCase,
  lang: Lang,
  variant: Variant,
  question: string,
  apiKey: string,
): Promise<RobustRow> => {
  const expected = c.tool!;
  const rules = normalizeRouteForScoring(
    selectHeuristicRoute(question, ctxFor(lang), {}).route,
    expected,
  );
  // Capture Jev's FIRST answer — the routing call — so its raw pick is kept
  // even when the gate or `acceptJevPick` throws it away.
  let first: JevResult | null | undefined;
  const base = directAsk(apiKey);
  const capture: typeof askJev = async (...args) => {
    const r = await base(...args);
    if (first === undefined) first = r;
    return r;
  };
  const lane = await jevLaneRoute(
    question,
    ctxFor(lang),
    {},
    undefined,
    capture,
  );
  const answer = first?.answers?.tool as
    | { choice?: string; confidence?: number }
    | undefined;
  const pick = answer?.choice ?? null;
  const laneSel = normalizeRouteForScoring(lane.selected, expected);
  return {
    id: c.id,
    group: c.group,
    lang,
    variant,
    question,
    expectedTool: expected,
    rulesTool: rules?.tool ?? null,
    rulesOk: rules?.tool === expected,
    jevPick: pick === NO_TOOL ? null : pick,
    jevConfidence:
      typeof answer?.confidence === "number" ? answer.confidence : null,
    jevRawOk: pick === expected,
    laneTool: laneSel?.tool ?? null,
    laneOk: laneSel?.tool === expected,
    laneUsedJev: lane.routedByJev,
    degraded: lane.degraded,
  };
};

// ---- summary ----------------------------------------------------------

const share = (xs: boolean[]) =>
  xs.length ? xs.filter(Boolean).length / xs.length : null;

export const summarise = (rows: RobustRow[]) => {
  const out: Record<string, Record<string, Record<string, number | null>>> = {};
  const slices: [string, (r: RobustRow) => boolean][] = [
    ["all", () => true],
    ["examples", (r) => r.group === "registry"],
    ["handwritten", (r) => r.group !== "registry"],
  ];
  for (const [slice, keep] of slices) {
    out[slice] = {};
    for (const lang of ["en", "bg"] as const)
      for (const v of VARIANTS) {
        const rs = rows.filter(
          (r) => keep(r) && r.lang === lang && r.variant === v && !r.degraded,
        );
        if (!rs.length) continue;
        out[slice][`${lang}:${v}`] = {
          n: rs.length,
          rules: share(rs.map((r) => r.rulesOk)),
          jevRaw: share(rs.map((r) => r.jevRawOk)),
          jevRawConfident: share(
            rs.map(
              (r) =>
                r.jevRawOk && (r.jevConfidence ?? 0) >= JEV_CONFIDENCE_GATE,
            ),
          ),
          lane: share(rs.map((r) => r.laneOk)),
          // Rows where Jev was RIGHT and the rules WRONG, and how many of those
          // the lane actually delivered.
          jevRightRulesWrong: rs.filter((r) => r.jevRawOk && !r.rulesOk).length,
          laneDelivered: rs.filter((r) => r.jevRawOk && !r.rulesOk && r.laneOk)
            .length,
        };
      }
  }
  return out;
};

const pct = (x: number | null | undefined) =>
  x == null ? "  n/a" : `${(100 * x).toFixed(1).padStart(5)}%`;

const print = (s: ReturnType<typeof summarise>) => {
  for (const [slice, byKey] of Object.entries(s)) {
    console.log(
      `\n${slice.toUpperCase()}\n  lang:variant        n   rules  Jev raw  Jev≥gate   lane | Jev✓rules✗  lane kept`,
    );
    for (const [k, m] of Object.entries(byKey))
      console.log(
        `  ${k.padEnd(16)} ${String(m.n).padStart(4)} ${pct(m.rules)} ${pct(m.jevRaw)} ${pct(m.jevRawConfident)} ${pct(m.lane)} | ${String(m.jevRightRulesWrong).padStart(9)} ${String(m.laneDelivered).padStart(10)}`,
      );
  }
};

const main = async () => {
  if (process.argv.includes("--rescore")) {
    const { rows } = JSON.parse(readFileSync(OUT, "utf8")) as {
      rows: RobustRow[];
    };
    print(summarise(rows));
    return;
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");
  const cases = pickCases();
  console.error(`${cases.length} cases`);
  const para = await paraphrases(cases);

  type Job = { c: EvalCase; lang: Lang; variant: Variant; q: string };
  const jobs: Job[] = [];
  for (const c of cases)
    for (const lang of ["en", "bg"] as const) {
      const q = c[lang];
      jobs.push({ c, lang, variant: "original", q });
      jobs.push({ c, lang, variant: "typo", q: typo(q, `${c.id}|${lang}`) });
      if (lang === "bg") jobs.push({ c, lang, variant: "latin", q: latin(q) });
      jobs.push({
        c,
        lang,
        variant: "paraphrase",
        q: para[`${c.id}|${lang}`],
      });
    }
  console.error(`${jobs.length} scored questions…`);

  const rows: RobustRow[] = new Array(jobs.length);
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      const j = jobs[i];
      rows[i] = await scoreOne(j.c, j.lang, j.variant, j.q, apiKey);
      if (++done % 200 === 0) console.error(`  ${done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const summary = summarise(rows);
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        confidenceGate: JEV_CONFIDENCE_GATE,
        cases: cases.length,
        degraded: rows.filter((r) => r.degraded).length,
        summary,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  print(summary);
  console.log(
    `\ndegraded (excluded from the figures): ${rows.filter((r) => r.degraded).length}`,
  );
  console.log(`wrote ${OUT}`);
};

// Only runs as a script, so the perturbation helpers can be unit-tested.
if (process.argv[1]?.endsWith("jevRobustness.ts")) main();
