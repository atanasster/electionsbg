/** Read-only code inventory. Run: node --import tsx scripts/ai/audit_starter_taxonomy.mjs */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";
import { QUESTION_CATALOG } from "../../src/lib/questions/catalog.ts";
import { SQL_QUESTION_CATALOG } from "../../src/lib/questions/sql/catalog.ts";
import { SQL_RECIPES } from "../../src/lib/questions/sql/recipes.ts";
import { TOOLS } from "../../ai/tools/registry.ts";
const require = createRequire(import.meta.url);
const { DB_ROUTES } = require("../../functions/db_routes.js");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
const readers = [];
for (const file of [...walk("ai/tools"), ...walk("src")].filter(
  (f) =>
    /\.tsx?$/.test(f) &&
    !/\.(test|spec)\./.test(f) &&
    !f.endsWith("/harness.ts"),
)) {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ["fetchDb", "fetchData", "fetchJson", "dataUrl"].includes(
        n.expression.getText(sf),
      ) &&
      n.arguments[0]
    ) {
      const arg = n.arguments[0],
        literal =
          ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg);
      readers.push({
        file,
        line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        call: n.expression.getText(sf),
        literal,
        target: literal ? arg.text : arg.getText(sf),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const ddl = [];
for (const file of walk("scripts/db/schema/pg").filter((f) =>
  f.endsWith(".sql"),
)) {
  const source = fs.readFileSync(file, "utf8");
  for (const m of source.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi,
  ))
    ddl.push({
      name: m[1],
      file,
      line: source.slice(0, m.index).split("\n").length,
    });
}
const chat = QUESTION_CATALOG.questions,
  sql = SQL_QUESTION_CATALOG.questions;
const categories = QUESTION_CATALOG.categories.map((c) => ({
  id: c.id,
  label: c.label.bg,
  subcategories: c.subcategories.map((s) => {
    const cq = chat.filter(
        (q) => q.categoryId === c.id && q.subcategoryId === s.id,
      ),
      sq = sql.filter((q) => q.categoryId === c.id && q.subcategoryId === s.id);
    return {
      id: s.id,
      label: s.label.bg,
      chatReady: cq.filter((q) => q.chat.status === "ready").map((q) => q.id),
      sqlReady: sq.filter((q) => q.sql.status === "ready").map((q) => q.id),
      sqlReview: sq.filter((q) => q.sql.status === "review").map((q) => q.id),
    };
  }),
}));
const topics = read("docs/audits/ai-chat-tool-topics.json");
const tools = TOOLS.map((t) => ({
  name: t.name,
  domain: t.domain,
  topic: topics[t.name] ?? null,
  description: t.description,
  examples: t.examples,
  starterIds: chat
    .filter((q) => q.chat.capabilityId === t.name)
    .map((q) => q.id),
}));
const routes = Object.keys(DB_ROUTES)
  .sort()
  .map((name) => ({
    name,
    chatLiteralReaders: readers.filter(
      (r) =>
        r.file.startsWith("ai/") &&
        r.call === "fetchDb" &&
        r.literal &&
        r.target === name,
    ),
    implementation: DB_ROUTES[name].toString(),
  }));
const datasets = read("data/data_map.json")
  .nodes.filter((n) => n.kind === "dataset")
  .map((n) => ({
    id: n.id,
    label: n.label.bg,
    path: n.path ?? null,
    serving: n.serving,
    tables: n.tables ?? [],
    recipesWithDirectRelationReference: SQL_RECIPES.filter((r) =>
      r.relations.some((t) => (n.tables ?? []).includes(t)),
    ).map((r) => r.id),
  }));
const recipes = SQL_RECIPES.map((r) => ({
  id: r.id,
  questionId: r.questionId,
  relations: r.relations,
  parameters: r.parameters,
  selectable: sql.some(
    (q) => q.sql.status === "ready" && q.sql.capabilityId === r.id,
  ),
  category:
    sql.find((q) => q.sql.status === "ready" && q.sql.capabilityId === r.id)
      ?.categoryId ?? null,
}));
const previous = fs.readFileSync(
  "scripts/ai/audit_question_coverage.ts",
  "utf8",
);
const oldTopicBlock = previous.slice(
  previous.indexOf("const sqlTopic:"),
  previous.indexOf("const sqlChatLinks:"),
);
const oldMappings = [
  ...oldTopicBlock.matchAll(/^  "([^"]+)": \["([^"]+)", "([^"]+)"\],$/gm),
].map((m) => ({ id: m[1], category: m[2], subcategory: m[3] }));
const classificationDrift = oldMappings.flatMap((old) => {
  const q = sql.find((q) => q.id === old.id);
  return q &&
    (q.categoryId !== old.category || q.subcategoryId !== old.subcategory)
    ? [
        {
          id: old.id,
          audit: [old.category, old.subcategory],
          runtime: [q.categoryId, q.subcategoryId],
        },
      ]
    : [];
});
const leaves = categories.flatMap((c) => c.subcategories);
const summary = {
  categories: categories.length,
  subcategories: leaves.length,
  chatQuestions: chat.length,
  chatWithoutSourceIds: chat.filter((q) => !q.sourceIds?.length).length,
  sqlCatalogQuestions: sql.length,
  chatVisibleCategories: categories.filter((c) =>
    c.subcategories.some((s) => s.chatReady.length),
  ).length,
  sqlVisibleCategories: categories.filter((c) =>
    c.subcategories.some((s) => s.sqlReady.length),
  ).length,
  chatVisibleSubcategories: leaves.filter((s) => s.chatReady.length).length,
  sqlVisibleSubcategories: leaves.filter((s) => s.sqlReady.length).length,
  emptyOnBoth: leaves.filter((s) => !s.chatReady.length && !s.sqlReady.length)
    .length,
  runtimeTools: tools.length,
  toolsWithoutStarters: tools.filter((t) => !t.starterIds.length).length,
  sqlRecipes: recipes.length,
  selectableSqlRecipes: recipes.filter((r) => r.selectable).length,
  unselectableSqlRecipes: recipes.filter((r) => !r.selectable).map((r) => r.id),
  dualReady: chat
    .filter((q) => q.chat.status === "ready" && q.sql.status === "ready")
    .map((q) => q.id),
  apiRoutes: routes.length,
  routesWithoutLiteralChatReader: routes.filter(
    (r) => !r.chatLiteralReaders.length,
  ).length,
  datasets: datasets.length,
  sqlFunctionDeclarations: ddl.length,
  classificationDrift: classificationDrift.length,
};
const result = {
  generatedAt: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  scope:
    "Static code inventory, before server capability downgrade. API literal absence and direct dataset-relation absence are candidates, not proof of inaccessible data; dynamic helpers and SQL functions can expose additional sources. No production readiness or freshness claim.",
  summary,
  categories,
  tools,
  recipes,
  classificationDrift,
  datasets,
  routes,
  readers,
  sqlFunctions: ddl,
};
fs.writeFileSync(
  "docs/audits/starter-taxonomy-coverage-2026-09-09.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
