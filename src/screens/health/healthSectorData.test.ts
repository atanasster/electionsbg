// Unit tests for the /sector/health pure helpers (docs/plans/health-hub-v1.md T3):
// the retired-EIK fold and the hub's national-minus-sector baseline.

import { describe, it, expect } from "vitest";
import { foldBodies, healthPct, successorOf } from "./healthSectorData";
import { healthHubKpis, otherBuyersPair, pct } from "./healthHubFigures";
import type { HealthBodyAgg } from "@/data/health/useHealthSector";
import type { HealthHubStats } from "@/data/health/hubStats";

// РИОКОЗ — Благоевград (до 2012) → РЗИ — Благоевград.
const RETIRED = "000022349";
const SUCCESSOR = "176030552";

const body = (eik: string, totalEur: number, n = 1): HealthBodyAgg => ({
  eik,
  totalEur,
  contractCount: n,
  bidKnownN: n,
  singleBidN: 1,
  frameworkEur: 0,
  frameworkN: 0,
});

describe("foldBodies", () => {
  it("merges a retired ЕИК into its successor's row", () => {
    const out = foldBodies([body(RETIRED, 10, 2), body(SUCCESSOR, 5, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      eik: SUCCESSOR,
      totalEur: 15,
      contractCount: 3,
      singleBidN: 2,
    });
  });

  it("gives a row that only the retired ЕИК filled the successor's universe", () => {
    const out = foldBodies([body(RETIRED, 10)]);
    expect(out[0].eik).toBe(SUCCESSOR);
    expect(out[0].universe).toBe("mz_bodies");
  });

  it("leaves a body outside the register unfolded, with no universe", () => {
    expect(successorOf("999999999")).toBe("999999999");
    expect(foldBodies([body("999999999", 1)])[0].universe).toBeNull();
  });
});

const stats = (p: Partial<HealthHubStats["procurement"]>): HealthHubStats =>
  ({
    year: 2025,
    nzok: { expenditureEur: 0 },
    payments: { careEur: 0, careFacilities: 0 },
    medicines: { eur: 0, inns: 0 },
    procurement: {
      eur: 100,
      contracts: 10,
      singleBid: 2,
      bidKnown: 8,
      nationalSingleBid: 42,
      nationalBidKnown: 108,
      frameworkCeilingEur: 0,
      frameworkCeilingContracts: 0,
      nullAmountContracts: 0,
      firstDate: "2020-01-01",
      lastDate: "2025-12-31",
      institutions: 3,
      ...p,
    },
  }) as unknown as HealthHubStats;

describe("the hub's competition baseline", () => {
  it("is every OTHER buyer: national minus the sector", () => {
    expect(otherBuyersPair(stats({}))).toEqual({
      singleBid: 40,
      bidKnown: 100,
    });
  });

  it("formats through the one percent formatter", () => {
    expect(pct(1, 4, false)).toBe(healthPct(0.25, false));
    expect(pct(1, 0, false)).toBeNull();
  });

  it("drops the “against X%” clause when no other buyer has a known bid count", () => {
    const withOthers = healthHubKpis(stats({}), "en", false);
    expect(withOthers.at(-1)?.basis).toContain("against 40%");
    const none = healthHubKpis(
      stats({ nationalSingleBid: 2, nationalBidKnown: 8 }),
      "en",
      false,
    );
    expect(none.at(-1)?.basis).toContain("25% single-bid");
    expect(none.at(-1)?.basis).not.toContain("against");
  });
});
