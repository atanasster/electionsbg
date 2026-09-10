/** Read-only integration gate for the click → provider → follow-up graph. */
import fs from "node:fs";
import { discoveryStatus } from "./discovery_status";
import { HeuristicProvider } from "../../ai/llm/provider";
import { setFetcher, setDbFetcher } from "../../ai/tools/dataClient";
import { nodeDbFetcher } from "../../ai/tools/dbFetcherNode";
import { latestElection } from "../../ai/tools/dataset";
import { SUGGESTIONS } from "../../ai/app/suggestions";
import { followUps } from "../../ai/app/followups";
import { toChatQuestionIntent } from "../../ai/app/questionAdapter";
import { dispatchPrompt } from "../../ai/app/dispatchPrompt";
const output =
  process.argv.find((a) => a.startsWith("--output="))?.slice(9) ??
  "/tmp/ai-discovery-graph.json";
const production = process.argv.includes("--production");
const selected = process.argv
  .find((a) => a.startsWith("--ids="))
  ?.slice(6)
  .split(",");
const readJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.json();
};
setFetcher(
  production
    ? (path) =>
        readJson(
          `https://storage.googleapis.com/data-electionsbg-com/${path.replace(/^\//, "")}`,
        )
    : async (path) =>
        JSON.parse(fs.readFileSync(`data/${path.replace(/^\//, "")}`, "utf8")),
);
setDbFetcher(
  production
    ? (route, params) =>
        readJson(
          `https://electionsbg.com/api/db/${route}?${new URLSearchParams(
            Object.entries(params)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)]),
          )}`,
        )
    : nodeDbFetcher,
);
const provider = new HeuristicProvider();
const results: Record<string, unknown>[] = [];
const seen = new Set<string>();
for (const suggestion of SUGGESTIONS.filter(
  (s) => !selected || selected.includes(s.questionId),
)) {
  for (const lang of ["bg", "en"] as const) {
    const ctx = { lang, election: latestElection() };
    const intent = toChatQuestionIntent(
      suggestion.questionId,
      lang,
      suggestion.parameters,
    );
    const signature = JSON.stringify([lang, intent.tool, intent.args]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const run = async (s: typeof suggestion, parent?: string) => {
      const selectedIntent = toChatQuestionIntent(
        s.questionId,
        lang,
        s.parameters,
      );
      const response = await dispatchPrompt(
        provider,
        s[lang],
        ctx,
        undefined,
        undefined,
        selectedIntent,
      );
      const env = response.env;
      const status = discoveryStatus(response, selectedIntent.tool);
      results.push({
        questionId: s.questionId,
        parent,
        lang,
        text: s[lang],
        expected: selectedIntent,
        status,
        tool: response.tool,
        args: response.args,
        title: env?.title,
        kind: env?.kind,
        rows: env?.rows?.length,
        firstRow: env?.rows?.[0],
        facts: env?.facts,
        provenance: env?.provenance,
        ...(!env
          ? {
              error: response.text,
              prerequisite:
                /relation .* does not exist|ENOENT|ECONNREFUSED/.test(
                  response.text,
                ),
            }
          : {}),
      });
      return response;
    };
    const parent = await run(suggestion);
    if (parent.env)
      for (const next of followUps(parent.env, parent.args))
        await run(next, suggestion.questionId);
    console.log(suggestion.questionId, lang);
  }
}
const failures = results.filter(
  (r) => r.status !== "ok" && r.status !== "needs-input",
);
const clarifications = results.filter((r) => r.status === "needs-input").length;
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      target: production ? "production" : "local",
      total: results.length,
      failures: failures.length,
      clarifications,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ total: results.length, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
