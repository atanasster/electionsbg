import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { currentQuestionCoverage } from "./current_question_coverage";
import { QUESTION_DEFINITIONS } from "../../src/lib/questions/catalog";
import { route } from "../../ai/orchestrator/router";
import { resolveMacroKey } from "../../ai/tools/macro";
import labels from "../../ai/tools/macroLabels.json";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
it("keeps the inventory current and every executable tool discoverable with sources", () => {
  const report = currentQuestionCoverage();
  expect(report).toEqual(read("docs/audits/current-question-coverage.json"));
  expect(report.missingToolStarters).toEqual([]);
  expect(report.missingSourceIds).toEqual([]);
});
it("pins both language texts to normal-provider validation records", () => {
  const probes = read(
    "docs/audits/starter-provider-validation-2026-09-10.json",
  );
  expect(probes).toHaveLength(QUESTION_DEFINITIONS.length * 2);
  for (const q of QUESTION_DEFINITIONS)
    for (const lang of ["bg", "en"] as const) {
      const p = probes.find(
        (r: { id: string; lang: string }) => r.id === q.id && r.lang === lang,
      );
      expect(p, q.id + lang).toBeDefined();
      expect(p.error, q.id + lang).toBeUndefined();
      expect(p.text, q.id + lang).toBe(q.question[lang]);
      expect(p.tool, q.id + lang).toBe(q.chat.capabilityId);
      expect(p.provenance.length, q.id + lang).toBeGreaterThan(0);
      const routed = route(p.text, { lang, election: "2026_04_19" });
      expect(routed?.tool, q.id + lang).toBe(p.tool);
      expect(routed?.args ?? {}, q.id + lang).toEqual(p.args);
    }
});
it("gates every source macro measure on explicit bilingual discovery", () => {
  const source = read("data/macro.json");
  expect(Object.keys(labels).sort()).toEqual(
    Object.keys(source.indicators).sort(),
  );
  for (const [id, meta] of Object.entries(labels)) {
    expect(source.indicators[id].titleBg).toBe(meta.bg);
    const q = QUESTION_DEFINITIONS.find((q) => q.id === "macro-" + id);
    expect(q?.chat.capabilityId, id).toBe("macroIndicator");
    expect(resolveMacroKey(meta.bg), id).toBe(id);
    for (const lang of ["bg", "en"] as const) {
      expect(
        route(q!.question[lang], { lang, election: "2026_04_19" })?.args
          .indicator,
        id + lang,
      ).toBe(id);
    }
  }
});
it("keeps every SQL recipe tied to its validated default statement", async () => {
  const { createHash } = await import("node:crypto");
  const { SQL_RECIPES_BY_ID } =
    await import("../../src/lib/questions/sql/recipes");
  const { renderSqlQuestion } =
    await import("../../src/lib/questions/sql/render");
  const checked = read(
    "docs/audits/starter-sql-validation-2026-09-10.json",
  ).results;
  expect(checked).toHaveLength(SQL_RECIPES_BY_ID.size);
  for (const recipe of SQL_RECIPES_BY_ID.values()) {
    const row = checked.find((r: { id: string }) => r.id === recipe.id);
    expect(row?.error, recipe.id).toBeUndefined();
    expect(row?.sqlSha256, recipe.id).toBe(
      createHash("sha256")
        .update(renderSqlQuestion(recipe.id).sql)
        .digest("hex"),
    );
  }
});
