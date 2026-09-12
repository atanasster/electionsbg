import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildFundingQuery } from "./buildFundingQuery";
import {
  FUNDING_CAPABILITIES,
  validateFundingQuery,
} from "../../src/lib/fundingQuery";

describe("deployed funding validator", () => {
  it("is fresh and loads from a functions-only directory without TS dependencies", async () => {
    await buildFundingQuery();
    const dir = mkdtempSync(join(tmpdir(), "funding-validator-"));
    try {
      const target = join(dir, "validator.cjs");
      copyFileSync("functions/generated/funding_query.js", target);
      const require = createRequire(import.meta.url);
      const shipped = require(target) as {
        validateFundingQuery: typeof validateFundingQuery;
        FUNDING_CAPABILITIES: typeof FUNDING_CAPABILITIES;
      };
      expect(shipped.FUNDING_CAPABILITIES).toEqual(FUNDING_CAPABILITIES);
      for (const raw of [
        {
          corpus: "interregPartners",
          relationship: "operationsToPartners",
          parentQuery: encodeURIComponent(
            JSON.stringify({
              corpus: "interregOperations",
              programmeIds: Array.from(
                { length: 114 },
                (_, i) => "x".repeat(55) + i,
              ),
            }),
          ),
        },
        { corpus: "isunProjects", from: "2026-01-01" },
        { corpus: "agriPayments", financialYears: ["2025"] },
        { corpus: "interregPartners", basePredicates: ["unpublishedBudget"] },
      ])
        expect(shipped.validateFundingQuery(raw)).toEqual(
          validateFundingQuery(raw),
        );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
