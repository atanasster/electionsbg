import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Outcome = {
  id: string;
  chat: "ready" | "review" | "unavailable";
  sql: "ready" | "review" | "unavailable";
  sources: string[];
  prerequisite: string | null;
};

const audit = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/audits/step7-capability-dispositions.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { outcomes: Outcome[] };

describe("Step 7 capability dispositions", () => {
  it("records every required family and a decision for each slice", () => {
    expect(audit.outcomes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(audit.outcomes.map((outcome) => outcome.id)).size).toBe(
      audit.outcomes.length,
    );
    for (const outcome of audit.outcomes) {
      expect(outcome.sources.length, outcome.id).toBeGreaterThan(0);
      expect(outcome.chat, outcome.id).toMatch(/^(ready|review|unavailable)$/);
      expect(outcome.sql, outcome.id).toMatch(/^(ready|review|unavailable)$/);
      if (outcome.chat !== "ready" || outcome.sql !== "ready")
        expect(outcome.prerequisite?.length, outcome.id).toBeGreaterThan(30);
    }
  });

  it("does not promote a one-surface Step 7 capability", () => {
    for (const outcome of audit.outcomes)
      expect(outcome.chat === "ready", outcome.id).toBe(
        outcome.sql === "ready",
      );
  });

  it("keeps actual execution evidence unavailable until it is ingested", () => {
    expect(
      audit.outcomes.find(
        (outcome) => outcome.id === "contract-execution-evidence",
      ),
    ).toMatchObject({ chat: "unavailable", sql: "unavailable" });
  });
});
