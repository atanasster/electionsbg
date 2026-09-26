import { expect, it } from "vitest";
import { buildCoverage } from "./build_coverage";
import type { Agency, Poll } from "../../../src/data/polls/pollsTypes";
it("separates accepted data, incomplete historical review and a failed site check", () => {
  const agencies = [{ id: "GIB" }, { id: "ML" }] as Agency[];
  const p = {
    id: "x",
    agencyId: "ML",
    cycle: "2016_11_06_pvr",
    fieldwork: "Oct 13 2016",
  } as Poll;
  const result = buildCoverage(
    agencies,
    [p],
    {
      reviewedAt: "2026-09-26",
      publications: [
        { agencyId: "ML", year: 2016, status: "accepted" },
        { agencyId: "ML", year: 2016, status: "missing_metadata" },
      ],
    },
    {
      GIB: {
        lastChecked: "2026-09-25",
        meta: { armErrors: { site: "failed" } },
      },
    },
  );
  expect(result.agencies[0]).toMatchObject({
    accepted: 0,
    unavailable: true,
    lastChecked: "2026-09-25",
  });
  expect(result.agencies[1]).toMatchObject({
    accepted: 1,
    missingMetadata: 1,
    reviewedPublications: 2,
    from: "2016-10-13",
    to: "2016-10-13",
  });
  expect(result.agencies[1].cycles.find((c) => c.year === 2001)?.accepted).toBe(
    0,
  );
});
