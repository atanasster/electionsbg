import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { buildRollcallQuery } from "./buildRollcallQuery";
import { validateRollcallQuery } from "../../src/lib/rollcallQuery";
it("ships the same roll-call validator", async () => {
  await buildRollcallQuery();
  const shipped = createRequire(import.meta.url)(
    "../../functions/generated/rollcall_query.js",
  );
  for (const q of [
    { corpus: "parliamentVotes" },
    { corpus: "councilCasts", seatIds: ["52:1"] },
    {
      corpus: "parliamentVotes",
      from: "2026-02-30",
      toExclusive: "2026-03-01",
    },
  ])
    expect(shipped.validateRollcallQuery(q)).toEqual(validateRollcallQuery(q));
});
