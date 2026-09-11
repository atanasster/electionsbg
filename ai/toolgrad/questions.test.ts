import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseQuestions,
  makeSamples,
  verifySamples,
  splitFor,
  STYLES,
  generationMessages,
  restoreQuestions,
} from "./questions";
import type { Corpus } from "./corpus";
const corpus: Corpus = JSON.parse(
  readFileSync("data/ai/toolgrad/corpus.json", "utf8"),
);
describe("answer-first question dataset", () => {
  it("validates the committed reviewed dataset against execution captures", () => {
    const dataset = JSON.parse(
      readFileSync("data/ai/toolgrad/questions.json", "utf8"),
    );
    expect(dataset.status).toBe("agent-reviewed");
    expect(() => verifySamples(dataset.samples, corpus)).not.toThrow();
    expect(
      dataset.samples.some((s: { question: string }) =>
        /__\w+__|_style_|governanceProfile/.test(s.question),
      ),
    ).toBe(false);
  });
  it("keeps names, identifiers and captured fact values out of outbound generation", () => {
    const c = corpus.captures.find((c) => c.seed.tool === "personWealth")!;
    const payload = JSON.stringify(generationMessages(c));
    expect(payload).not.toContain(String(c.seed.args.name));
    expect(payload).not.toContain("574370");
    expect(payload).toContain("__name__");
    expect(
      restoreQuestions(c, [
        { style: "natural", question: "Declared wealth of __name__?" },
      ])[0].question,
    ).toContain(String(c.seed.args.name));
    expect(() =>
      restoreQuestions(c, [{ style: "natural", question: "Who is wealthy?" }]),
    ).toThrow("Missing placeholder");
  });
  it("refuses incomplete, duplicated and malformed generation", () => {
    expect(() => parseQuestions('{"questions":[]}')).toThrow();
    expect(() =>
      parseQuestions(
        JSON.stringify({
          questions: STYLES.map((style) => ({
            style,
            question: "A repeated question?",
          })),
        }),
      ),
    ).toThrow("Duplicate");
    expect(() => parseQuestions('{"questions":[null,null,null]}')).toThrow();
  });
  it("keeps all translations and paraphrases of a workflow in one split", () => {
    const samples = corpus.captures.flatMap((c) =>
      makeSamples(
        c,
        STYLES.map((style) => ({
          style,
          question: `Question about ${c.seed.id} in ${c.context.lang} style ${style}?`,
        })),
      ),
    );
    expect(() => verifySamples(samples, corpus)).not.toThrow();
    expect(samples.filter((s) => s.split === "holdout")).toHaveLength(36);
    expect(samples.filter((s) => s.split === "development")).toHaveLength(108);
    samples[0] = {
      ...samples[0],
      split:
        splitFor(samples[0].workflow) === "holdout" ? "development" : "holdout",
    };
    expect(() => verifySamples(samples, corpus)).toThrow("captured workflow");
  });
  it("rejects altered arguments, missing examples and duplicate ids", () => {
    const samples = corpus.captures.flatMap((c) =>
      makeSamples(
        c,
        STYLES.map((style) => ({
          style,
          question: `Question about ${c.seed.id} in ${c.context.lang} style ${style}?`,
        })),
      ),
    );
    expect(() => verifySamples(samples.slice(1), corpus)).toThrow("Incomplete");
    samples[1] = samples[0];
    expect(() => verifySamples(samples, corpus)).toThrow("sample id");
    samples[0] = { ...samples[0], args: { election: "2024" } };
    expect(() => verifySamples(samples, corpus)).toThrow("captured workflow");
  });
});
