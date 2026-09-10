/** Read-only smoke against local corpus files and the real database route handlers.
 * node --import tsx scripts/ai/toolWorkspaceSmoke.ts <output.json>
 * Availability is reported separately from an empty answer; no fixture fallback.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setFetcher, setDbFetcher } from "../../ai/tools/dataClient";
import { nodeDbFetcher } from "../../ai/tools/dbFetcherNode";
import { runTool } from "../../ai/tools/registry";
import { latestElection } from "../../ai/tools/dataset";
import { LIBRARY } from "../../ai/app/explorer/library";
import { toChatQuestionIntent } from "../../ai/app/questionAdapter";
import { emptyEnvelope } from "../../ai/app/explorer/workspace";
setFetcher(async (path) =>
  JSON.parse(
    await readFile(
      join(process.cwd(), "data", path.replace(/^\//, "")),
      "utf8",
    ),
  ),
);
setDbFetcher(nodeDbFetcher);
const rows = [];
for (const name of [
  "budgetVariance",
  "nationalResults",
  "localCouncil",
  "companyConnections",
  "macroOverview",
  "graoPopulation",
  "contractSearch",
  "presidentialResults",
  "personProfile",
]) {
  const entry = LIBRARY.find((e) => e.tool.name === name)!;
  const { args } = toChatQuestionIntent(entry.questions[0].id, "en");
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const env = await Promise.race([
      runTool(name, args, { lang: "en", election: latestElection() }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Source timeout after 20 seconds")),
          20000,
        );
      }),
    ]);
    rows.push({
      tool: name,
      domain: entry.tool.domain,
      args,
      status: env.clarify
        ? "clarification"
        : emptyEnvelope(env)
          ? "empty"
          : "success",
      title: env.title,
      rows: env.rows?.length,
      provenance: env.provenance,
      elapsedMs: Date.now() - start,
    });
  } catch (error) {
    rows.push({
      tool: name,
      domain: entry.tool.domain,
      args,
      status: "unavailable",
      error: String(error),
      elapsedMs: Date.now() - start,
    });
  } finally {
    clearTimeout(timer);
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  source:
    "Local data/ corpus and local Postgres via production route handlers; no stubbed fallback",
  rows,
};
await writeFile(
  process.argv[2] ?? "/tmp/tool-workspace-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    rows.map(({ tool, domain, status }) => ({ tool, domain, status })),
    null,
    2,
  ),
);
process.exit(0);
