// Synthetic interpretation smoke test; never transmits captured corpus facts.
// node --env-file=.env.local --import tsx ai/toolgrad/narration.run.ts <new-directory>
import { mkdirSync, writeFileSync } from "node:fs";
import { buildNarrationPrompt } from "../orchestrator/prompts";
import { numbersGrounded } from "../llm/grounding";
import { matchesLang } from "../llm/lang";
import { PilotClient, PILOT_MODEL } from "./client";
import { hash } from "./corpus";
import type { Envelope } from "../tools/types";
const dir = process.argv[2];
if (!dir) throw new Error("Provide new output directory");
const fixtures: { id: string; rubric: string; facts: Envelope["facts"] }[] = [
  {
    id: "direction",
    rubric:
      "Describe turnout falling from40% in2024 to30% in2025; never reverse the years/values or compute a difference.",
    facts: { turnout_2024: "40%", turnout_2025: "30%" },
  },
  {
    id: "contract-value",
    rubric:
      "200000 EUR is awarded contract value; paid money is unknown. Do not describe it as an actual payment or spending already incurred.",
    facts: {
      awarded_contract_value_eur: "200000",
      paid_amount: "unknown",
      note: "Awarded contract value is not proof of payment.",
    },
  },
  {
    id: "risk",
    rubric:
      "Two screening signals are leads for review; never establish corruption or guilt.",
    facts: {
      screening_signals: 2,
      note: "Risk indicators only; no finding of wrongdoing or proven corruption.",
    },
  },
  {
    id: "declarations",
    rubric:
      "600000 EUR assets and100000 EUR debts are declared, not independently audited; do not infer salary or compute net wealth.",
    facts: {
      declared_assets_eur: "600000",
      declared_debts_eur: "100000",
      note: "Self-declared, not independently audited. Income and salary not supplied.",
    },
  },
];
const client = new PilotClient(process.env.GEMINI_API_KEY ?? "", 8);
mkdirSync(dir);
const rows: unknown[] = [];
for (const fixture of fixtures)
  for (const lang of ["bg", "en"] as const) {
    const env: Envelope = {
      tool: "syntheticFixture",
      domain: "fiscal",
      kind: "scalar",
      viz: "none",
      title:
        lang === "bg"
          ? "Измислен пример за проверка"
          : "Fictional verification example",
      facts: fixture.facts,
      provenance: ["synthetic pilot fixture; not real civic data"],
    };
    const prompt = buildNarrationPrompt(env, lang);
    let raw = "",
      error: string | undefined,
      completion;
    try {
      completion = await client.complete([
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ]);
      raw = completion.text;
    } catch (e) {
      error = String(e);
    }
    rows.push({
      id: `${fixture.id}:${lang}`,
      lang,
      rubric: fixture.rubric,
      env,
      prompt,
      raw,
      error,
      ...completion,
      numberGate: !error && numbersGrounded(raw, env.facts, env.title),
      languageGate: !error && matchesLang(raw, lang),
    });
    writeFileSync(
      `${dir}/report.json`,
      JSON.stringify(
        {
          version: 1,
          model: PILOT_MODEL,
          synthetic: true,
          fixtureHash: hash(fixtures),
          finishedAt: new Date().toISOString(),
          calls: client.calls,
          reservationCeilingUSD: client.reservedCeilingUSD,
          rows,
        },
        null,
        2,
      ) + "\n",
    );
  }
console.log(
  "Eight synthetic narration cases recorded for local semantic review.",
);
