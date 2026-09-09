/** Read-only chat wiring audit. Writes a review snapshot, never calls a model or database.
 * Run: node --import tsx scripts/ai/audit_chat.ts
 * Literal readers are evidence of access, not proof every field reaches an answer.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { TOOLS } from "../../ai/tools/registry";
import { route } from "../../ai/orchestrator/router";
import { latestElection } from "../../ai/tools/dataset";
import { STARTERS } from "../../ai/app/starters";
import { isExcluded } from "../bucket_sync_paths";

const walk = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
const files = walk("ai/tools").filter(
  (p) =>
    p.endsWith(".ts") &&
    !/\.(test|harness)\.ts$/.test(p) &&
    !/\/harness.ts$/.test(p),
);
const reads: {
  file: string;
  line: number;
  kind: string;
  target: string;
  dynamic: boolean;
  excluded: string | null;
  existsLocally: boolean | null;
}[] = [];
for (const file of files) {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ["fetchData", "fetchDb"].includes(n.expression.getText(sf)) &&
      n.arguments[0]
    ) {
      const a = n.arguments[0];
      const literal =
        ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a);
      const target = literal ? a.text : a.getText(sf);
      const kind = n.expression.getText(sf);
      reads.push({
        file,
        line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        kind,
        target,
        dynamic: !literal,
        excluded:
          kind === "fetchData" && literal
            ? isExcluded(target.replace(/^\//, ""))
            : null,
        existsLocally:
          kind === "fetchData" && literal
            ? fs.existsSync(path.join("data", target.replace(/^\//, "")))
            : null,
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const require = createRequire(import.meta.url);
const apiNames = Object.keys(
  require("../../functions/db_routes.js").DB_ROUTES,
).sort();
const vectors = JSON.parse(fs.readFileSync("ai/llm/tool_vectors.json", "utf8"))
  .vectors as { name: string }[];
const tools = TOOLS.map((t) => ({
  name: t.name,
  domain: t.domain,
  description: t.description,
  params: t.params,
  examples: t.examples.map((e) => ({
    ...e,
    bgRoute: route(e.bg, { lang: "bg", election: latestElection() }),
    enRoute: route(e.en, { lang: "en", election: latestElection() }),
  })),
}));
const examples = tools.flatMap((t) =>
  t.examples.flatMap((e) =>
    (["bg", "en"] as const).map((lang) => ({
      tool: t.name,
      lang,
      question: e[lang],
      actual: e[`${lang}Route`],
    })),
  ),
);
const mismatches = examples.filter((e) => e.actual?.tool !== e.tool);
const called = new Set(
  reads.filter((r) => r.kind === "fetchDb" && !r.dynamic).map((r) => r.target),
);
const dataMap = JSON.parse(fs.readFileSync("data/data_map.json", "utf8"));
const result = {
  generatedAt: new Date().toISOString(),
  scope:
    "Local source audit; no production freshness or model accuracy claim. API differences are review candidates; generic company/table/payload routes and helper calls can expose multiple datasets.",
  summary: {
    tools: tools.length,
    starters: STARTERS.length,
    examples: examples.length,
    routingMismatches: mismatches.length,
    bgMismatches: mismatches.filter((e) => e.lang === "bg").length,
    enMismatches: mismatches.filter((e) => e.lang === "en").length,
    unrouted: mismatches.filter((e) => !e.actual).length,
    apiRoutes: apiNames.length,
    literalApiRoutes: called.size,
  },
  missingVectors: tools
    .filter((t) => !vectors.some((v) => v.name === t.name))
    .map((t) => t.name),
  routingMismatches: mismatches,
  reads,
  apiWithoutLiteralReader: apiNames.filter((n) => !called.has(n)),
  unknownLiteralApi: [...called].filter((n) => !apiNames.includes(n)),
  sources: dataMap.nodes.filter((n: { kind: string }) => n.kind === "source"),
  tools,
};
fs.writeFileSync(
  "docs/audits/ai-chat-wiring.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      summary: result.summary,
      missingVectors: result.missingVectors,
      unknownLiteralApi: result.unknownLiteralApi,
      excludedReads: reads.filter((r) => r.excluded),
      missingLocal: reads.filter((r) => r.existsLocally === false),
    },
    null,
    2,
  ),
);
