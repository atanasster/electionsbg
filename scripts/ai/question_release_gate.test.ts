import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../ai/tools/registry";
import { QUESTION_DEFINITIONS } from "../../src/lib/questions/catalog";
import { resolveQuestionSelection } from "../../src/lib/questions/resolve";
import { SQL_RECIPES_BY_ID } from "../../src/lib/questions/sql/recipes";
import { renderSqlQuestion } from "../../src/lib/questions/sql/render";
import { SOURCE_GROUPS } from "../data_map/model";

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(`docs/audits/${name}`, "utf8")) as T;
const wiring = read<{ sources: Array<{ id: string }> }>("ai-chat-wiring.json");
const historical = read<{ sourceGroups: Array<{ id: string }> }>(
  "question-capability-matrix.json",
);
const toolTopics = read<Record<string, unknown>>("ai-chat-tool-topics.json");
const parity = read<{
  version: number;
  questions: Array<{
    id: string;
    chatCapability: string;
    sqlRecipe: string;
    parameters: Record<string, string | number>;
    grainKey: string;
    periodKey: string;
    sourceVersionField: string;
    relation: string;
    migration: string;
    signature: string;
    caseId: string;
    fixture: string;
    expected: Record<string, string | number>;
  }>;
}>("dual-ready-parity.json");

describe("question release coverage gate", () => {
  it("requires an explicit decision for every runtime tool and source group", () => {
    const catalogTools = new Set(
      QUESTION_DEFINITIONS.flatMap((question) =>
        question.chat.capabilityId ? [question.chat.capabilityId] : [],
      ),
    );
    const decidedTools = new Set([...Object.keys(toolTopics), ...catalogTools]);
    expect(
      TOOLS.map((tool) => tool.name).filter((name) => !decidedTools.has(name)),
    ).toEqual([]);
    expect(wiring.sources.map((source) => source.id).sort()).toEqual(
      historical.sourceGroups.map((source) => source.id).sort(),
    );
    expect(wiring.sources.map((source) => source.id).sort()).toEqual(
      SOURCE_GROUPS.map((source) => `src:${source.id}`).sort(),
    );
  });

  it("pins every dual-ready question to a parity contract and fixture", () => {
    const dualReady = QUESTION_DEFINITIONS.filter(
      (question) =>
        question.chat.status === "ready" && question.sql.status === "ready",
    );
    expect(parity.version).toBe(2);
    expect(parity.questions.map((row) => row.id)).toEqual(
      dualReady.map((question) => question.id),
    );
    for (const row of parity.questions) {
      expect(SQL_RECIPES_BY_ID.has(row.id), row.id).toBe(true);
      expect(row.chatCapability, row.id).toBe(row.id);
      expect(row.sqlRecipe, row.id).toBe(row.id);
      expect(Object.keys(row.parameters).length, row.id).toBeGreaterThan(0);
      expect(row.periodKey.length, row.id).toBeGreaterThan(3);
      expect(row.grainKey.length, row.id).toBeGreaterThan(3);
      expect(row.sourceVersionField, row.id).toBe("source_sha256");
      expect(row.expected.votes, row.id).toBeGreaterThan(0);
      expect(existsSync(row.fixture), row.id).toBe(true);
      expect(readFileSync(row.fixture, "utf8"), row.id).toContain(row.caseId);
      const migration = readFileSync(row.migration, "utf8");
      expect(migration, row.id).toContain(row.signature);
      expect(SQL_RECIPES_BY_ID.get(row.id)?.relations, row.id).toContain(
        row.relation,
      );
    }
  });

  it("keeps selector and SQL parameter contracts aligned for dual-ready rows", () => {
    for (const row of parity.questions) {
      const question = QUESTION_DEFINITIONS.find(
        (candidate) => candidate.id === row.id,
      )!;
      const recipe = SQL_RECIPES_BY_ID.get(row.id)!;
      const byId = new Map(
        recipe.parameters.map((parameter) => [parameter.id, parameter]),
      );
      for (const parameter of question.parameters) {
        const sql = byId.get(parameter.id);
        expect(sql, `${row.id}.${parameter.id}`).toBeDefined();
        expect(sql?.required, `${row.id}.${parameter.id}`).toBe(
          parameter.required,
        );
        expect(sql?.min, `${row.id}.${parameter.id}`).toBe(parameter.min);
        expect(sql?.max, `${row.id}.${parameter.id}`).toBe(parameter.max);
        expect(sql?.values, `${row.id}.${parameter.id}`).toEqual(
          parameter.values,
        );
        const expectedSqlKind: Record<string, string> = {
          election: "code",
          enum: "enum",
          number: "integer",
        }[parameter.kind];
        if (expectedSqlKind)
          expect(sql?.kind, `${row.id}.${parameter.id}`).toBe(expectedSqlKind);
        if (question.defaults[parameter.id] !== undefined)
          expect(sql?.default, `${row.id}.${parameter.id}`).toBe(
            question.defaults[parameter.id],
          );
      }
      expect([...byId.keys()].sort(), row.id).toEqual(
        question.parameters.map((parameter) => parameter.id).sort(),
      );
      expect(question.sourceIds, row.id).toEqual(recipe.relations);
      const resolved = resolveQuestionSelection(question, row.parameters);
      const rendered = renderSqlQuestion(row.sqlRecipe, resolved.parameters);
      expect(rendered.sql, row.id).toContain(row.relation);
    }
  });
});
