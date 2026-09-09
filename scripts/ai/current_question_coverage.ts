/** Runtime-derived inventory. No historical classifications or PostgreSQL row estimates. */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { QUESTION_CATEGORIES } from "../../src/lib/questions/catalog";
import { SQL_QUESTION_CATALOG } from "../../src/lib/questions/sql/catalog";
import { SQL_RECIPES_BY_ID } from "../../src/lib/questions/sql/recipes";
import { TOOLS } from "../../ai/tools/registry";
export const currentQuestionCoverage = () => {
  const questions = SQL_QUESTION_CATALOG.questions;
  const chat = questions.filter((q) => q.chat.status === "ready");
  const sql = questions.filter((q) => q.sql.status === "ready");
  return {
    basis:
      "Runtime question catalog; readiness does not assert complete data coverage or current production deployment.",
    totals: {
      categories: QUESTION_CATEGORIES.length,
      leaves: QUESTION_CATEGORIES.reduce(
        (n, c) => n + c.subcategories.length,
        0,
      ),
      chat: chat.length,
      sql: sql.length,
      dual: questions.filter(
        (q) => q.chat.status === "ready" && q.sql.status === "ready",
      ).length,
      tools: TOOLS.length,
      recipes: SQL_RECIPES_BY_ID.size,
    },
    missingToolStarters: TOOLS.filter(
      (t) => !chat.some((q) => q.chat.capabilityId === t.name),
    ).map((t) => t.name),
    missingSourceIds: questions
      .filter(
        (q) =>
          (q.chat.status === "ready" || q.sql.status === "ready") &&
          !q.sourceIds.length,
      )
      .map((q) => q.id),
    leaves: QUESTION_CATEGORIES.flatMap((c) =>
      c.subcategories.map((s) => ({
        category: c.id,
        subcategory: s.id,
        label: {
          bg: c.label.bg + " / " + s.label.bg,
          en: c.label.en + " / " + s.label.en,
        },
        chat: chat
          .filter((q) => q.categoryId === c.id && q.subcategoryId === s.id)
          .map((q) => q.id),
        sql: sql
          .filter((q) => q.categoryId === c.id && q.subcategoryId === s.id)
          .map((q) => q.id),
      })),
    ),
  };
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = currentQuestionCoverage();
  writeFileSync(
    "docs/audits/current-question-coverage.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report.totals));
  if (report.missingToolStarters.length || report.missingSourceIds.length)
    process.exitCode = 1;
}
