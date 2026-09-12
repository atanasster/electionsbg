import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildProcurementQuery } from "./buildProcurementQuery";
import {
  PROCUREMENT_CAPABILITY,
  validateProcurementQuery,
} from "../../src/lib/procurementQuery";

describe("deployed procurement validator", () => {
  it("is fresh and loads from a functions-only directory without TS dependencies", async () => {
    await buildProcurementQuery();
    const dir = mkdtempSync(join(tmpdir(), "procurement-validator-"));
    try {
      const target = join(dir, "validator.cjs");
      copyFileSync("functions/generated/procurement_query.js", target);
      const require = createRequire(import.meta.url);
      const shipped = require(target) as {
        validateProcurementQuery: typeof validateProcurementQuery;
        PROCUREMENT_CAPABILITY: typeof PROCUREMENT_CAPABILITY;
      };
      expect(shipped.PROCUREMENT_CAPABILITY).toEqual(PROCUREMENT_CAPABILITY);
      for (const raw of [
        { corpus: "contracts", from: "2026-01-01" },
        { corpus: "appeals", year: 2026 },
        { corpus: "tenders", basePredicates: ["risk:rushedDeadline"] },
      ])
        expect(shipped.validateProcurementQuery(raw)).toEqual(
          validateProcurementQuery(raw),
        );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
