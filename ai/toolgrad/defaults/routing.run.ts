// node --env-file=.env.local --import tsx ai/toolgrad/defaults/routing.run.ts baseline|candidate <new-directory>
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PilotClient, PILOT_MODEL } from "../client";
import { hash } from "../corpus";
import { FRESH_CASES } from "./routingCases";
import { rawRoute, matchesExpected, explicitAbstention } from "./routingEval";
import { buildToolSystemPrompt } from "../../orchestrator/prompts";
import { parseModelRoute } from "../../orchestrator/routeScope";
import { resolveFollowOn, route } from "../../orchestrator/router";
import {
  buildContext,
  renderRoutingContext,
  CLOUD_BUDGET,
} from "../../orchestrator/memory";
const [variant, dir] = process.argv.slice(2);
if (!["baseline", "candidate"].includes(variant) || !dir)
  throw new Error("Expected variant and new directory");
const prompts =
  variant === "baseline"
    ? JSON.parse(
        readFileSync(
          "data/ai/toolgrad/development-baseline/report.json",
          "utf8",
        ),
      ).prompts
    : { bg: buildToolSystemPrompt("bg"), en: buildToolSystemPrompt("en") };
const tasks = FRESH_CASES.flatMap((c) =>
  (["bg", "en"] as const).map((lang) => ({ c, lang })),
);
const client = new PilotClient(process.env.GEMINI_API_KEY ?? "", tasks.length);
mkdirSync(dir);
const meta = {
  version: 1,
  variant,
  model: PILOT_MODEL,
  startedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  suiteHash: hash(FRESH_CASES),
  promptHash: hash(prompts),
  prompts,
  cases: FRESH_CASES,
  scoringHash: hash(
    readFileSync("ai/toolgrad/defaults/routingEval.ts", "utf8"),
  ),
  scope:
    "Fresh hand-written suite, frozen before model calls. Raw model selection compared separately from current parser/follow-on policy. Baseline uses the retained pre-default prompt; both policy columns use current code, not an old runtime. Rule-only results are diagnostic, not full provider behavior. No captured facts or private identities sent.",
  settings: { tokens: 120, temperature: 0, concurrency: 4 },
};
// Manifest is persisted before the first request.
writeFileSync(`${dir}/manifest.json`, JSON.stringify(meta, null, 2) + "\n");
const rows: Record<string, unknown>[] = [];
let next = 0;
const save = () =>
  writeFileSync(
    `${dir}/report.json`,
    JSON.stringify(
      {
        ...meta,
        finishedAt: new Date().toISOString(),
        complete: rows.length === tasks.length,
        calls: client.calls,
        reservationCeilingUSD: client.reservedCeilingUSD,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
async function worker() {
  for (;;) {
    const task = tasks[next++];
    if (!task) return;
    const { c, lang } = task;
    const context = c.prev
      ? renderRoutingContext(
          buildContext(
            [{ question: "Previous requested view", ...c.prev }],
            CLOUD_BUDGET,
          ),
          lang,
        )
      : "";
    const user = context ? `${context}\nCurrent question: ${c[lang]}` : c[lang];
    let raw = "",
      error: string | undefined,
      completion;
    try {
      completion = await client.complete(
        [
          { role: "system", content: prompts[lang] },
          { role: "user", content: user },
        ],
        { json: true, tokens: 120 },
      );
      raw = completion.text;
    } catch (e) {
      error = String(e);
    }
    const rawParsed = rawRoute(raw);
    const follow = resolveFollowOn(c[lang], c.prev);
    const policy = follow ?? parseModelRoute(raw, user);
    const rules = follow ?? route(c[lang], { lang, election: "2024_10_27" });
    const abstained = explicitAbstention(raw);
    rows.push({
      id: `${c.id}:${lang}`,
      group: c.group,
      lang,
      user,
      raw,
      error,
      ...completion,
      rawParsed,
      policy,
      rules,
      rawOk:
        !error && (c.tool === null ? abstained : matchesExpected(c, rawParsed)),
      policyOk:
        !error && (c.tool === null ? abstained : matchesExpected(c, policy)),
      rulesOk: matchesExpected(c, rules),
    });
    save();
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
save();
console.log(
  JSON.stringify({
    variant,
    n: rows.length,
    rawOk: rows.filter((r) => r.rawOk).length,
    policyOk: rows.filter((r) => r.policyOk).length,
    ruleOk: rows.filter((r) => r.rulesOk).length,
    errors: rows.filter((r) => r.error).length,
  }),
);
if (rows.some((r) => r.error)) process.exitCode = 1;
