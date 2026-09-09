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
  chatCapability?: string;
  sqlRecipe?: string;
  reviewEvidence?: string;
};
const audit = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/audits/step9-existing-data-dispositions.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { families: Array<{ id: string; capabilities: Outcome[] }> };

describe("Step 9 existing-data dispositions", () => {
  const outcomes = audit.families.flatMap((family) => family.capabilities);

  it("covers every required family with distinct capability decisions", () => {
    const expected = {
      "procurement-registers": [
        "top-contractors",
        "procurement-appeals",
        "company-registry-connections",
        "ted-notice-lineage",
        "cprs-registration",
        "aop-experts",
        "contract-benchmark-and-criteria",
      ],
      "eu-funding": [
        "open-calls-current-conditions",
        "isun-procedure-fit",
        "isun-procedure-rate",
        "project-completion-and-payments",
        "interreg-operation-programme-partner",
      ],
      health: [
        "hospital-payment-history",
        "hospital-financials-and-activity",
        "drug-pack-quarter-price",
        "drug-molecule-detail",
      ],
      "local-accountability-courts": [
        "council-resolution-detail",
        "named-councillor-votes",
        "magistrate-filings-relationships",
        "court-detail-and-coverage",
      ],
      "transport-security-geography": [
        "transport-project-map",
        "transport-facility-map",
        "security-directorate-map",
        "road-safety-hotspots",
      ],
      "broader-tools": [
        "energy-generation-series",
        "energy-price-series",
        "power-plant-capacity",
        "culture-grants",
        "culture-films",
        "social-benefits-series",
        "retail-prices-comparison",
        "macro-series",
        "regional-series",
        "census-population",
        "grao-registered-population",
        "poll-series",
      ],
    };
    expect(
      Object.fromEntries(
        audit.families.map((family) => [
          family.id,
          family.capabilities.map((row) => row.id),
        ]),
      ),
    ).toEqual(expected);
    expect(new Set(outcomes.map((row) => row.id)).size).toBe(outcomes.length);
    for (const row of outcomes) {
      expect(row.sources.length, row.id).toBeGreaterThan(0);
      if (row.chat !== "ready" || row.sql !== "ready")
        expect(row.prerequisite?.length, row.id).toBeGreaterThan(80);
      if (row.sql === "ready") expect(row.chat, row.id).toBe("ready");
    }
  });

  it("keeps candidate SQL recipes in review until parity evidence exists", () => {
    const sharedIds: Record<string, string> = {
      "top-contractors": "topContractors",
      "procurement-appeals": "procurementAppeals",
      "company-registry-connections": "companyConnections",
    };
    expect(
      outcomes
        .filter((row) => row.chat === "ready" && row.sql === "ready")
        .map((row) => row.id),
    ).toEqual([]);
    for (const [outcomeId, questionId] of Object.entries(sharedIds)) {
      const outcome = outcomes.find((row) => row.id === outcomeId)!;
      expect(outcome.chat).toBe("ready");
      expect(outcome.sql).toBe("review");
      expect(outcome.chatCapability).toBe(questionId);
      expect(questionById(questionId)?.chat.status).toBe("ready");
      expect(questionById(questionId)?.sql.status).toBe("review");
      expect(SQL_RECIPES_BY_ID.has(questionId)).toBe(true);
    }
  });

  it("keeps distinct value and geography meanings explicit", () => {
    expect(
      outcomes.find((row) => row.id === "contract-benchmark-and-criteria")
        ?.prerequisite,
    ).toContain("contracted value as paid");
    expect(
      outcomes.find((row) => row.id === "transport-project-map")?.prerequisite,
    ).toContain("beneficiary registered seat");
    expect(
      outcomes.find((row) => row.id === "interreg-operation-programme-partner")
        ?.prerequisite,
    ).toContain("deduplicate Interreg");
    expect(
      outcomes.find((row) => row.id === "isun-procedure-rate")?.prerequisite,
    ).toContain("rejected applications");
    expect(
      outcomes.find((row) => row.id === "named-councillor-votes")?.prerequisite,
    ).toContain("unpublished");
  });
});
