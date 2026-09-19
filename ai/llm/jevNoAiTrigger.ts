// Option B for the no-AI mode: the rules answer first, and Jev (stage 3,
// `completeJevPick` "extract") is called ONLY when a trigger says the rules are
// likely wrong. Before building it: does any cheap, offline trigger actually
// find the questions the rules get wrong?
//
//   npx tsx ai/llm/jevNoAiTrigger.ts
//
// No API calls. Reads the robustness questions (data/ai/evals/jev_robustness.json)
// and the stage-3 outcome already recorded for each one
// (ai/evals-internal/jev_noai_stages.json), recomputes the rules' route, and
// writes ai/evals-internal/jev_noai_trigger.json.
//
// Candidate triggers:
//   T1  the rules found no tool
//   T2  T1, or ANY content word the rules' vocabulary does not know
//   T3  T1, or TWO or more such words
// "Known" = the tokens the rules and the typo matcher are built from (every
// tool example + starter question, romanized), matched by stem so an
// inflection is known; plus place names, party tokens and numbers, which a
// question legitimately contains and no example need.
//
// ⚠️ THE VOCABULARY IS THE TEST LEAKAGE FROM THE OTHER SIDE. It is built from
// the examples most of these questions are variants of, so on the as-written
// rows T2 fires almost never by construction. Read the typo / reworded / Latin
// rows and the hand-written slice — those are the questions a reader types.

import { readFileSync, writeFileSync } from "node:fs";
import { route } from "../orchestrator/router";
import { typoTokens } from "../orchestrator/typoMatch";
import { normalizeRouteForScoring } from "../tests/nonAiEval";
import { TOOLS } from "../tools/registry";
import { STARTERS } from "../app/starters";
import { OBLASTS } from "../tools/place";
import { stemPrefix } from "../tools/translit";
import type { RobustRow } from "./jevRobustness";
import type { StageRow } from "./jevNoAiStages";
import type { Lang } from "../tools/types";

const ROWS = "data/ai/evals/jev_robustness.json";
const STAGES = "ai/evals-internal/jev_noai_stages.json";
const OUT = "ai/evals-internal/jev_noai_trigger.json";

type Outcome = "right" | "wrong" | "asked" | "none";

const vocabulary = (): string[] => {
  const known = new Set<string>();
  const add = (text: string) =>
    typoTokens(text.replace(/\{[a-zA-Z]+\}/g, " ")).forEach((t) =>
      known.add(t),
    );
  for (const t of TOOLS)
    for (const ex of t.examples) {
      add(ex.bg);
      add(ex.en);
    }
  for (const s of STARTERS) {
    add(s.bg);
    add(s.en);
  }
  const munis = JSON.parse(
    readFileSync("data/municipalities.json", "utf8"),
  ) as {
    name: string;
    name_en: string;
  }[];
  for (const m of munis) {
    add(m.name);
    add(m.name_en);
  }
  for (const o of Object.values(OBLASTS)) {
    add(o.bg);
    add(o.en);
  }
  for (const p of [
    "герб",
    "сдс",
    "дпс",
    "бсп",
    "итн",
    "възраждане",
    "величие",
    "меч",
    "пп",
    "дб",
    "прогресивна",
    "синя",
    "демократична",
    "атака",
    "вмро",
  ])
    add(p);
  return [...known];
};

export const unknownWords = (question: string, known: string[]): string[] => {
  const exact = new Set(known);
  return typoTokens(question).filter(
    (t) =>
      !/^\d+$/.test(t) && !exact.has(t) && !known.some((k) => stemPrefix(k, t)),
  );
};

const rulesOutcome = (r: RobustRow): Outcome => {
  if (r.rulesOk) return "right";
  const got = normalizeRouteForScoring(
    route(r.question, { lang: r.lang as Lang, election: "2026_04_19" }),
    r.expectedTool,
  );
  return got ? "wrong" : "none";
};
const stageOutcome = (s: StageRow): Outcome => {
  const o = s.s3!.outcome;
  return o === "askedRight" || o === "askedWrong" ? "asked" : o;
};

const main = () => {
  const { rows } = JSON.parse(readFileSync(ROWS, "utf8")) as {
    rows: RobustRow[];
  };
  const { stages } = JSON.parse(readFileSync(STAGES, "utf8")) as {
    stages: StageRow[];
  };
  if (stages.some((s) => !s.s3))
    throw new Error(`${STAGES} predates stage 3 — re-run jevNoAiStages.ts`);
  const known = vocabulary();

  const per = rows.map((r, i) => {
    const rules = rulesOutcome(r);
    const unknown = unknownWords(r.question, known);
    const noTool = rules === "none";
    return {
      index: i,
      lang: r.lang,
      variant: r.variant,
      handwritten: r.group !== "registry",
      rules,
      jev: stageOutcome(stages[i]),
      unknown,
      T1: noTool,
      T2: noTool || unknown.length > 0,
      T3: noTool || unknown.length >= 2,
    };
  });

  type P = (typeof per)[number];
  const TRIGGERS = ["T1", "T2", "T3"] as const;
  const share = (xs: P[], f: (x: P) => boolean) =>
    xs.length ? xs.filter(f).length / xs.length : 0;
  const summarise = (xs: P[]) => {
    const rulesRight = xs.filter((x) => x.rules === "right");
    const rulesMiss = xs.filter((x) => x.rules !== "right");
    const out: Record<string, number> = {
      n: xs.length,
      rulesRight: share(xs, (x) => x.rules === "right"),
      alwaysJevRight: share(xs, (x) => x.jev === "right"),
      alwaysJevWrong: share(xs, (x) => x.jev === "wrong"),
    };
    for (const T of TRIGGERS) {
      const b = (x: P): Outcome => (x[T] ? x.jev : x.rules);
      out[`${T}_fires`] = share(xs, (x) => x[T]);
      out[`${T}_recall`] = share(rulesMiss, (x) => x[T]);
      out[`${T}_falseAlarm`] = share(rulesRight, (x) => x[T]);
      out[`${T}_right`] = share(xs, (x) => b(x) === "right");
      out[`${T}_wrong`] = share(xs, (x) => b(x) === "wrong");
      out[`${T}_asked`] = share(xs, (x) => b(x) === "asked");
    }
    return out;
  };

  const slices: Record<string, Record<string, number>> = {};
  for (const [slice, keep] of [
    ["all", () => true],
    ["handwritten", (x: P) => x.handwritten],
  ] as const)
    for (const lang of ["en", "bg"])
      for (const v of ["original", "typo", "paraphrase", "latin"]) {
        const xs = per.filter(
          (x) => keep(x) && x.lang === lang && x.variant === v,
        );
        if (xs.length) slices[`${slice}|${lang}:${v}`] = summarise(xs);
      }

  const pct = (x: number) => `${(100 * x).toFixed(1).padStart(5)}%`;
  for (const [k, s] of Object.entries(slices)) {
    console.log(
      `\n${k}  n=${s.n}  rules ${pct(s.rulesRight)}  always-Jev ${pct(s.alwaysJevRight)} (wrong ${pct(s.alwaysJevWrong)})`,
    );
    for (const T of TRIGGERS)
      console.log(
        `  ${T}: fires ${pct(s[`${T}_fires`])}  catches ${pct(s[`${T}_recall`])} of rules' misses  false alarm ${pct(s[`${T}_falseAlarm`])}  →  B right ${pct(s[`${T}_right`])} wrong ${pct(s[`${T}_wrong`])} asks ${pct(s[`${T}_asked`])}`,
      );
  }
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: [ROWS, STAGES],
        slices,
        rows: per,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nwrote ${OUT}`);
};

if (process.argv[1]?.endsWith("jevNoAiTrigger.ts")) main();
