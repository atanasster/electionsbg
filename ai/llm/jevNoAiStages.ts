// Measure the no-AI Jev lane's stages 1 and 2 on the robustness questions.
//
//   node --env-file=.env.local --import tsx ai/llm/jevNoAiStages.ts
//   npx tsx ai/llm/jevNoAiStages.ts --rescore      # no API calls
//
// Writes ai/evals-internal/jev_noai_stages.json.
//
// The three stages differ ONLY in what happens when Jev confidently picks a
// tool that takes parameters and the rules chose something else:
//   stage 0  today before this change: the old fillers, else the RULES' tool
//   stage 1  the old fillers, else ASK the user (`completeJevPick` "narrow")
//   stage 2  carried + extracted values and Jev for any fixed-list or name
//            value, else ASK (`completeJevPick` "full" — what ships)
//
// All three are computed from ONE pass, with Jev's routing pick taken from the
// robustness run and its argument / name answers cached per question — so the
// stages see the same Jev answers and differ only in the rule being measured.
//
// Outcomes per question: RIGHT (ran the expected tool), WRONG (ran another),
// ASKED-RIGHT (asked about the expected tool), ASKED-WRONG, NONE (no tool).
// A question asked about is not answered — but it is not a wrong answer
// either, and turning wrong answers into questions is stage 1's whole point.
// Parameter correctness is scored on the as-written questions whose expected
// values are annotated.

import { readFileSync, writeFileSync } from "node:fs";
import { route, pinElectionContext } from "../orchestrator/router";
import { validateToolArgs } from "../orchestrator/toolSchema";
import { NON_AI_CASES, normalizeRouteForScoring } from "../tests/nonAiEval";
import { expectedArgs } from "./currentEval";
import {
  acceptJevPick,
  completeJevPick,
  JEV_CONFIDENCE_GATE,
  type JevCompletion,
} from "./jev";
import { dbEntitySearch, type EntitySearch } from "./jevEntity";
import { directAsk } from "./jevDirectAsk";
import { setDbOrigin } from "../tools/dataClient";
import type { askJev } from "./jevClient";
import type { RobustRow } from "./jevRobustness";
import type { Lang, ToolArgs, ToolContext } from "../tools/types";

const IN = "data/ai/evals/jev_robustness.json";
const OUT = "ai/evals-internal/jev_noai_stages.json";

type Outcome = "right" | "wrong" | "askedRight" | "askedWrong" | "none";
type StageResult = {
  outcome: Outcome;
  tool: string | null;
  args?: ToolArgs;
};
export type StageRow = {
  index: number;
  s0: StageResult;
  s1: StageResult;
  s2: StageResult;
  argsScored: boolean;
  argsOk0: boolean | null;
  argsOk2: boolean | null;
};

const norm = (v: unknown) => String(v).normalize("NFC").trim().toLowerCase();
const sameValue = (actual: unknown, expected: unknown): boolean =>
  Array.isArray(expected)
    ? Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => norm(actual[i]) === norm(v))
    : norm(actual) === norm(expected);

const ran = (r: ReturnType<typeof route>, expected: string): StageResult => {
  const s = normalizeRouteForScoring(r, expected);
  if (!s) return { outcome: "none", tool: null };
  return {
    outcome: s.tool === expected ? "right" : "wrong",
    tool: s.tool,
    args: s.args,
  };
};
const asked = (c: JevCompletion, expected: string): StageResult => ({
  outcome:
    c.kind === "clarify" && c.tool === expected ? "askedRight" : "askedWrong",
  tool: c.kind === "clarify" ? c.tool : null,
});

const memo = <A extends unknown[], R>(
  f: (...a: A) => Promise<R>,
): ((...a: A) => Promise<R>) => {
  const cache = new Map<string, Promise<R>>();
  return (...a: A) => {
    const k = JSON.stringify(a);
    if (!cache.has(k)) cache.set(k, f(...a));
    return cache.get(k)!;
  };
};

const scoreRow = async (
  r: RobustRow,
  index: number,
  ask: typeof askJev,
  search: EntitySearch,
): Promise<StageRow> => {
  const lang = r.lang as Lang;
  const ctx: ToolContext = { lang, election: "2026_04_19" };
  const expected = r.expectedTool;
  const deterministic = route(r.question, ctx);
  const pick =
    r.jevPick && (r.jevConfidence ?? 0) >= JEV_CONFIDENCE_GATE
      ? { tool: r.jevPick, args: {} }
      : null;
  const confidentDecline =
    !r.jevPick && (r.jevConfidence ?? 0) >= JEV_CONFIDENCE_GATE;

  let s0: StageResult, s1: StageResult, s2: StageResult;
  if (confidentDecline) {
    s0 = s1 = s2 = { outcome: "none", tool: null };
  } else {
    const accepted = acceptJevPick(pick, deterministic);
    if (pick && !accepted.usedJev) {
      const deps = { ask, credentials: undefined, search };
      const narrow = await completeJevPick(
        r.question,
        pick.tool,
        deterministic,
        deps,
        "narrow",
      );
      const full = await completeJevPick(
        r.question,
        pick.tool,
        deterministic,
        deps,
        "full",
      );
      s0 =
        narrow.kind === "run"
          ? ran(pinElectionContext(narrow.route, ctx), expected)
          : ran(pinElectionContext(deterministic, ctx), expected);
      s1 =
        narrow.kind === "run"
          ? ran(pinElectionContext(narrow.route, ctx), expected)
          : asked(narrow, expected);
      s2 =
        full.kind === "run"
          ? ran(pinElectionContext(full.route, ctx), expected)
          : asked(full, expected);
    } else {
      s0 = s1 = s2 = ran(pinElectionContext(accepted.route, ctx), expected);
    }
  }

  // Parameters: only on the as-written questions with annotated values.
  const c = NON_AI_CASES.find((x) => x.id === r.id);
  const exp = r.variant === "original" && c ? expectedArgs(c, lang) : undefined;
  const argsOk = (s: StageResult): boolean | null => {
    if (!exp) return null;
    if (s.outcome !== "right" || !s.args) return false;
    const a = validateToolArgs(s.tool!, s.args);
    return (
      !!a &&
      Object.entries(exp).every(([k, values]) =>
        values.some((v) => sameValue(a[k], v)),
      )
    );
  };
  return {
    index,
    s0,
    s1,
    s2,
    argsScored: !!exp,
    argsOk0: argsOk(s0),
    argsOk2: argsOk(s2),
  };
};

const OUTCOMES: Outcome[] = [
  "right",
  "wrong",
  "askedRight",
  "askedWrong",
  "none",
];
const VARIANTS = ["original", "typo", "paraphrase", "latin"] as const;

export const summarise = (rows: RobustRow[], stages: StageRow[]) => {
  const out: Record<string, Record<string, Record<Outcome, number>>> = {};
  for (const v of VARIANTS)
    for (const lang of ["en", "bg"] as const) {
      const xs = stages.filter(
        (s) => rows[s.index].variant === v && rows[s.index].lang === lang,
      );
      if (!xs.length) continue;
      const key = `${lang}:${v}`;
      out[key] = {};
      for (const st of ["s0", "s1", "s2"] as const) {
        const counts = Object.fromEntries(
          OUTCOMES.map((o) => [
            o,
            xs.filter((x) => x[st].outcome === o).length,
          ]),
        ) as Record<Outcome, number>;
        out[key][st] = counts;
      }
    }
  const scored = stages.filter((s) => s.argsScored);
  return {
    byVariant: out,
    params: {
      annotated: scored.length,
      rightStage0: scored.filter((s) => s.argsOk0).length,
      rightStage2: scored.filter((s) => s.argsOk2).length,
    },
  };
};

const pct = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(1).padStart(5)}%` : "  n/a";

const print = (s: ReturnType<typeof summarise>) => {
  console.log(
    "\n  lang:variant      stage   right   wrong  asked✓  asked✗    none",
  );
  for (const [k, byStage] of Object.entries(s.byVariant)) {
    for (const [st, c] of Object.entries(byStage)) {
      const n = OUTCOMES.reduce((t, o) => t + c[o], 0);
      console.log(
        `  ${(st === "s0" ? k : "").padEnd(16)}  ${st.replace("s", "stage ")} ${pct(c.right, n)} ${pct(c.wrong, n)} ${pct(c.askedRight, n)} ${pct(c.askedWrong, n)} ${pct(c.none, n)}`,
      );
    }
  }
  const p = s.params;
  console.log(
    `\nparameters right (as written, annotated, n=${p.annotated}): stage 0 ${pct(p.rightStage0, p.annotated)} · stage 2 ${pct(p.rightStage2, p.annotated)}`,
  );
};

const main = async () => {
  const { rows } = JSON.parse(readFileSync(IN, "utf8")) as {
    rows: RobustRow[];
  };
  if (process.argv.includes("--rescore")) {
    const { stages } = JSON.parse(readFileSync(OUT, "utf8")) as {
      stages: StageRow[];
    };
    print(summarise(rows, stages));
    return;
  }
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is required");
  // The name search reads the live person/company indexes.
  setDbOrigin("https://electionsbg.com");
  const ask = memo(directAsk(key)) as typeof askJev;
  const search = memo(dbEntitySearch) as EntitySearch;
  const stages: StageRow[] = new Array(rows.length);
  let next = 0,
    done = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      stages[i] = await scoreRow(rows[i], i, ask, search);
      if (++done % 200 === 0) console.error(`  ${done}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const summary = summarise(rows, stages);
  writeFileSync(
    OUT,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), source: IN, summary, stages },
      null,
      2,
    ) + "\n",
  );
  print(summary);
  console.log(`wrote ${OUT}`);
};

if (process.argv[1]?.endsWith("jevNoAiStages.ts")) main();
