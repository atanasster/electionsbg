import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { questionById } from "../../src/lib/questions/catalog";
import { SQL_RECIPES_BY_ID } from "../../src/lib/questions/sql/recipes";

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
      "../../docs/audits/step8-capability-dispositions.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { outcomes: Outcome[] };

describe("Step 8 capability dispositions", () => {
  it("records every election and civic slice with exact prerequisites", () => {
    expect(audit.outcomes.map((row) => row.id).sort()).toEqual(
      [
        "administrative-service-discovery",
        "latest-parliamentary-national-results",
        "local-election-results",
        "municipality-school-comparison",
        "parliamentary-results-by-mir",
        "parliamentary-results-by-oblast",
        "presidential-national-round-results",
        "presidential-results-by-municipality",
        "presidential-results-by-oblast",
        "school-context-and-history",
        "school-matura-profile",
        "textbook-detail",
        "water-operator-service-coverage",
        "water-rationing-and-outages",
      ].sort(),
    );
    expect(new Set(audit.outcomes.map((row) => row.id)).size).toBe(
      audit.outcomes.length,
    );
    for (const row of audit.outcomes) {
      expect(row.sources.length, row.id).toBeGreaterThan(0);
      if (row.chat !== "ready" || row.sql !== "ready")
        expect(row.prerequisite?.length, row.id).toBeGreaterThan(40);
    }
  });

  it("promotes only the two national result grains", () => {
    expect(
      audit.outcomes
        .filter((row) => row.chat === "ready" && row.sql === "ready")
        .map((row) => row.id),
    ).toEqual([
      "latest-parliamentary-national-results",
      "presidential-national-round-results",
    ]);
    for (const id of ["nationalResults", "presidentialResults"]) {
      expect(questionById(id)?.chat.status).toBe("ready");
      expect(questionById(id)?.sql.status).toBe("ready");
      expect(SQL_RECIPES_BY_ID.has(id)).toBe(true);
    }
  });

  it("does not substitute adjacent metrics for missing civic evidence", () => {
    expect(
      audit.outcomes.find((row) => row.id === "water-rationing-and-outages"),
    ).toMatchObject({ chat: "unavailable", sql: "unavailable" });
    expect(
      audit.outcomes.find((row) => row.id === "textbook-detail"),
    ).toMatchObject({ chat: "unavailable", sql: "unavailable" });
  });
});
