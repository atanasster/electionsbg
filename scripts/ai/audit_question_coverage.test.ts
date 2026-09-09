import { describe, expect, it } from "vitest";
import { buildQuestionCapabilityMatrix } from "./audit_question_coverage";

const matrix = buildQuestionCapabilityMatrix();

describe("question capability matrix", () => {
  it("accounts for every current source and question origin", () => {
    expect(matrix.summary).toMatchObject({
      rows: 444,
      chatStarters: 150,
      editorialQuestions: 257,
      sqlQueries: 37,
      sourceGroups: 47,
    });
    expect(new Set(matrix.questions.map((q) => q.id)).size).toBe(444);
  });

  it("does not infer cross-surface readiness from a related capability", () => {
    for (const row of matrix.questions) {
      if (row.origin === "sql-library" && row.chat.capability)
        expect(row.chat.status, row.id).toBe("review");
      if (row.origin === "chat-starter" && row.sql.capability)
        expect(row.sql.status, row.id).toBe("review");
    }
  });

  it("records per-question measure, grain and implementation disposition", () => {
    for (const row of matrix.questions) {
      expect(row.measure.trim().length, `${row.id} measure`).toBeGreaterThan(
        20,
      );
      expect(row.grain.trim().length, `${row.id} grain`).toBeGreaterThan(20);
      expect(row.plannedStep, `${row.id} step`).toBeTypeOf("number");
      expect(row.gap, `${row.id} gap`).not.toBeNull();
    }
    expect(
      matrix.questions.find((q) => q.id === "chat:nationalResults")
        ?.plannedStep,
    ).toBe(8);
  });

  it("records a distinct coverage assessment for every source", () => {
    expect(new Set(matrix.sourceGroups.map((s) => s.disposition)).size).toBe(
      47,
    );
    for (const source of matrix.sourceGroups) {
      expect(source.disposition.length, source.id).toBeGreaterThan(20);
      expect(["covered", "partial", "unavailable", "review"]).toContain(
        source.status,
      );
    }
  });
});
