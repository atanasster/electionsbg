/** Read-only local integration probe. Never infers readiness from row estimates. */
import fs from "node:fs";
import { runTool } from "../../ai/tools/registry";
import { latestElection } from "../../ai/tools/dataset";
import { setFetcher, setDbFetcher } from "../../ai/tools/dataClient";
import { nodeDbFetcher } from "../../ai/tools/dbFetcherNode";
import { QUESTION_CATALOG } from "../../src/lib/questions/catalog";
import { route } from "../../ai/orchestrator/router";
setFetcher(async (path) =>
  JSON.parse(fs.readFileSync(`data/${path.replace(/^\//, "")}`, "utf8")),
);
setDbFetcher(nodeDbFetcher);
const results = [];
const filter = new Set(process.argv.slice(2));
for (const q of QUESTION_CATALOG.questions.filter(
  (q) => !filter.size || filter.has(q.id),
)) {
  if (q.chat.status !== "ready" || !q.chat.capabilityId) continue;
  const routed = route(q.question.bg, {
    lang: "bg",
    election: latestElection(),
  });
  const args = routed?.args ?? {};
  try {
    if (routed?.tool !== q.chat.capabilityId)
      throw new Error(`Wrong route: ${routed?.tool}`);
    const e = await runTool(routed.tool, args, {
      lang: "bg",
      election: latestElection(),
    });
    results.push({
      id: q.id,
      args,
      title: e.title,
      rows: e.rows?.length ?? null,
      facts: e.facts,
      provenance: e.provenance,
      clarify: Boolean(e.clarify),
    });
  } catch (error) {
    results.push({ id: q.id, args, error: String(error) });
  }
  console.log(q.id, "error" in results.at(-1)! ? "ERROR" : "ok");
}
fs.writeFileSync(
  "/tmp/question-catalog-probes.json",
  JSON.stringify(results, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { total: results.length, errors: results.filter((r) => "error" in r) },
    null,
    2,
  ),
);
process.exit(results.some((r) => "error" in r) ? 1 : 0);
