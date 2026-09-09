/** Read-only local integration probe. Never infers readiness from row estimates. */
import fs from "node:fs";
import { HeuristicProvider } from "../../ai/llm/provider";
import { latestElection } from "../../ai/tools/dataset";
import { setFetcher, setDbFetcher } from "../../ai/tools/dataClient";
import { nodeDbFetcher } from "../../ai/tools/dbFetcherNode";
import { QUESTION_CATALOG } from "../../src/lib/questions/catalog";
import { route } from "../../ai/orchestrator/router";
setFetcher(async (path) =>
  JSON.parse(fs.readFileSync(`data/${path.replace(/^\//, "")}`, "utf8")),
);
setDbFetcher(nodeDbFetcher);
const provider = new HeuristicProvider();
const results = [];
const updateSources = process.argv.includes("--update-sources");
const outputArg = process.argv.slice(2).find((a) => a.startsWith("--output="));
const outputPath =
  outputArg?.slice("--output=".length) ?? "/tmp/question-catalog-probes.json";
const filter = new Set(
  process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--output=") && a !== "--update-sources"),
);
for (const q of QUESTION_CATALOG.questions.filter(
  (q) => !filter.size || filter.has(q.id),
)) {
  if (q.chat.status !== "ready" || !q.chat.capabilityId) continue;
  for (const lang of ["bg", "en"] as const) {
    const routed = route(q.question[lang], {
      lang,
      election: latestElection(),
    });
    const args = routed?.args ?? {};
    try {
      if (routed?.tool !== q.chat.capabilityId)
        throw new Error(`Wrong route: ${routed?.tool}`);
      const response = await provider.respond(q.question[lang], {
        lang,
        election: latestElection(),
      });
      if (!response.env) throw new Error(response.text);
      if (response.tool !== q.chat.capabilityId)
        throw new Error(`Wrong provider route: ${response.tool}`);
      const e = response.env;
      results.push({
        id: q.id,
        lang,
        text: q.question[lang],
        tool: response.tool,
        args,
        title: e.title,
        rows: e.rows?.length ?? null,
        facts: e.facts,
        provenance: e.provenance,
        clarify: Boolean(e.clarify),
      });
    } catch (error) {
      results.push({ id: q.id, lang, args, error: String(error) });
    }
    console.log(q.id, lang, "error" in results.at(-1)! ? "ERROR" : "ok");
  }
}
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n");
if (updateSources) {
  if (filter.size || results.some((r) => "error" in r))
    throw new Error("Source inventory requires a complete successful probe");
  const sources: Record<string, string[]> = {};
  for (const result of results) {
    if (!("tool" in result) || !result.tool || !result.provenance?.length)
      throw new Error("Missing provider provenance");
    sources[result.tool] = [
      ...new Set([...(sources[result.tool] ?? []), ...result.provenance]),
    ].sort();
  }
  fs.writeFileSync(
    "ai/app/toolSources.json",
    JSON.stringify(
      Object.fromEntries(Object.entries(sources).sort()),
      null,
      2,
    ) + "\n",
  );
}
console.log(
  JSON.stringify(
    { total: results.length, errors: results.filter((r) => "error" in r) },
    null,
    2,
  ),
);
process.exit(results.some((r) => "error" in r) ? 1 : 0);
