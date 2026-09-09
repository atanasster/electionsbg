// Local, read-only execution probe for candidate starter examples. No LLM calls.
import fs from "node:fs";
import { TOOLS, runTool } from "../../ai/tools/registry";
import { route } from "../../ai/orchestrator/router";
import { latestElection } from "../../ai/tools/dataset";
import { setFetcher, setDbFetcher } from "../../ai/tools/dataClient";
import { nodeDbFetcher } from "../../ai/tools/dbFetcherNode";
setFetcher(async (p) =>
  JSON.parse(fs.readFileSync(`data/${p.replace(/^\//, "")}`, "utf8")),
);
setDbFetcher(nodeDbFetcher);
const out = [];
for (const t of TOOLS) {
  const e = t.examples.find((e) =>
    (["bg", "en"] as const).every((lang) => {
      const r = route(e[lang], { lang, election: latestElection() });
      return (
        r?.tool === t.name &&
        t.params.filter((p) => p.required).every((p) => r.args[p.name] != null)
      );
    }),
  );
  if (!e) continue;
  try {
    const responses = [];
    for (const lang of ["bg", "en"] as const) {
      const r = route(e[lang], { lang, election: latestElection() })!;
      const env = await runTool(t.name, r.args, {
        lang,
        election: latestElection(),
      });
      responses.push({
        lang,
        args: r.args,
        title: env.title,
        kind: env.kind,
        rows: env.rows?.length,
        facts: env.facts,
        provenance: env.provenance,
      });
    }
    out.push({ tool: t.name, ...e, responses });
  } catch (err) {
    out.push({ tool: t.name, ...e, error: String(err) });
  }
}
fs.writeFileSync("/tmp/chat-starter-probes.json", JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    { probed: out.length, errors: out.filter((x) => "error" in x) },
    null,
    2,
  ),
);
// Local database pools keep the process alive; exit explicitly, and make
// transport/execution failures observable to a caller running this as a gate.
// Empty or semantically wrong envelopes still require the documented review.
process.exit(out.some((x) => "error" in x) ? 1 : 0);
