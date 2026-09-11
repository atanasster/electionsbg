import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generatedTask,
  referenceTasks,
  scoreTask,
  metrics,
  type Row,
} from "./evaluation";
import { numbersGrounded } from "../llm/grounding";
import type { Sample } from "./questions";
const samples: Sample[] = JSON.parse(
  readFileSync("data/ai/toolgrad/questions.json", "utf8"),
).samples;
describe("pilot evaluation", () => {
  it("documents that number-presence gates cannot prove semantic correctness", () => {
    const facts = { turnout_2024: "40%", turnout_2025: "30%" };
    expect(
      numbersGrounded("Turnout rose from 30% in 2024 to 40% in 2025.", facts),
    ).toBe(true);
    expect(
      numbersGrounded("Turnout fell by ten percentage points.", facts),
    ).toBe(true);
  });
  it("removes real person names and identifiers from outbound tasks, including history", () => {
    const tasks = [...samples.map(generatedTask), ...referenceTasks()];
    const sent = tasks.map((t) => t.question).join("\n");
    for (const privateValue of [
      "Бойко",
      "Борисов",
      "Асен",
      "Asen",
      "831646048",
      "000695324",
      "00044-2025-0125",
    ])
      expect(sent).not.toContain(privateValue);
    expect(tasks.some((t) => t.masked)).toBe(true);
  });
  it("accepts supported cycle/place aliases but rejects extra filters and dropped arguments", () => {
    const task = generatedTask(
      samples.find((s) => s.workflow === "municipal-mayor" && s.lang === "en")!,
    );
    expect(
      scoreTask(
        task,
        JSON.stringify({
          tool: task.expectedTool,
          args: { place: "Plovdiv", cycle: "2023" },
        }),
      ).callOk,
    ).toBe(true);
    expect(
      scoreTask(
        task,
        JSON.stringify({ tool: task.expectedTool, args: { place: "Plovdiv" } }),
      ).callOk,
    ).toBe(false);
    const total = generatedTask(
      samples.find((s) => s.workflow === "procurement-total")!,
    );
    expect(
      scoreTask(
        total,
        JSON.stringify({ tool: total.expectedTool, args: { year: 2024 } }),
      ).callOk,
    ).toBe(false);
  });
  it("never rewards transport errors, invalid JSON or invented entities on clarification cases", () => {
    const task = referenceTasks().find((t) => t.expectedTool === null)!;
    expect(scoreTask(task, '{"tool":null,"args":{}}').clarificationOk).toBe(
      true,
    );
    expect(scoreTask(task, '{"tool":null,"args":{}}', "HTTP 500").callOk).toBe(
      false,
    );
    expect(scoreTask(task, "invalid").callOk).toBe(false);
    expect(
      scoreTask(
        task,
        '{"tool":"personWealth","args":{"name":"Example Official"}}',
      ).callOk,
    ).toBe(false);
  });
  it("reports missing billed cost as unknown", () => {
    expect(
      metrics([
        {
          elapsedMs: 10,
          toolOk: true,
          callOk: true,
          argsOk: null,
          clarificationOk: null,
          usage: { prompt_tokens: 50 },
        } as Row,
      ]).billedUSD,
    ).toBe(null);
    expect(metrics([]).medianMs).toBe(null);
  });
});
