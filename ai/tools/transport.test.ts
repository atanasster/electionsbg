// The AI transport tools answer on the hub's own rules (transport-hub-v1 C8), so the
// chat and /sector/transport cannot state two different numbers:
//   · transportSpending — rail share re-attributed (D8), ex-member single-bid rate,
//     no member-inclusive count fallback;
//   · transportEuFunds — grant basis only, refusing an older function's answer;
//   · railSubsidy — an unpublished capital transfer is not zero (T9 F3).

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchData, fetchDb } from "./dataClient";
import { railSubsidy, transportEuFunds, transportSpending } from "./transport";
import { TRANSPORT_EIK } from "@/lib/transportReferenceData";

vi.mock("./dataClient", () => ({ fetchDb: vi.fn(), fetchData: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const ctx = { lang: "en", election: "2026_04_19" } as const;
const NKZHI = "130823243";

const groupModel = (byUnit: { eik: string; totalEur: number }[], byCpv: { cpv: string; totalEur: number }[]) => ({
  totalEur: byUnit.reduce((a, u) => a + u.totalEur, 0),
  contractCount: 999,
  bidKnownN: 0,
  singleBidN: 0,
  suppliers: [],
  byCpv: byCpv.map((c) => ({ ...c, contractCount: 1, bidKnownN: 0, singleBidN: 0 })),
  byCpvContractor: [],
  byMethod: [{ method: "open", totalEur: 100 }],
  byYear: [],
  byUnit: byUnit.map((u) => ({ ...u, contractCount: 1, bidKnownN: 0, singleBidN: 0 })),
}); // prettier-ignore

describe("transportSpending", () => {
  it("re-attributes the ministry's PSO to rail and uses the ex-member pair", async () => {
    vi.mocked(fetchDb).mockImplementation(async (route, q) => {
      if (route === "awarder-group-model")
        return (q as { eiks: string }).eiks === TRANSPORT_EIK
          ? groupModel([{ eik: TRANSPORT_EIK, totalEur: 60 }], [{ cpv: "60210000", totalEur: 50 }, { cpv: "45000000", totalEur: 10 }]) // prettier-ignore
          : groupModel([{ eik: TRANSPORT_EIK, totalEur: 60 }, { eik: NKZHI, totalEur: 40 }], []); // prettier-ignore
      if (route === "awarder-group-rollup")
        return { exMembers: true, operators: [{ eik: NKZHI, contractCount: 10, bidKnownN: 8, singleBidN: 2 }] }; // prettier-ignore
      return { singleBidExMembers: 40, bidKnownExMembers: 100 };
    });
    const env = await transportSpending({}, ctx);
    expect(env.facts?.rail_share).toBe("90%"); // (40 + 50) / 100
    expect(env.facts?.rail_share_by_awarder).toBe("40%");
    expect(env.facts?.single_bid_share).toBe("25%"); // 2 / 8, ex-member
    expect(env.facts?.national_single_bid_share).toBe("40%");
    expect(env.facts?.contracts).toBe("10");
  });

  it("states no count when the rollup is not on the ex-member basis", async () => {
    vi.mocked(fetchDb).mockImplementation(async (route) => {
      if (route === "awarder-group-model") return groupModel([{ eik: NKZHI, totalEur: 40 }], []); // prettier-ignore
      if (route === "awarder-group-rollup") return { operators: [{ eik: NKZHI, contractCount: 10, bidKnownN: 8, singleBidN: 2 }] }; // prettier-ignore
      return {};
    });
    const env = await transportSpending({}, ctx);
    expect(env.facts?.contracts).toBe("—"); // never the member-inclusive 999
    expect(env.facts?.single_bid_share).toBe("—");
  });
});

describe("transportEuFunds", () => {
  it("refuses an answer that is not on the grant basis", async () => {
    vi.mocked(fetchDb).mockResolvedValue({
      operators: [{ eik: NKZHI, contractedEur: 3_000_000_000, paidEur: 900_000_000, projectCount: 40 }],
    }); // prettier-ignore
    const env = await transportEuFunds({}, ctx);
    expect(env.facts?.total_grant).toBe("—");
    expect(env.rows).toEqual([]);
  });

  it("divides paid by grant on the grant basis", async () => {
    vi.mocked(fetchDb).mockResolvedValue({
      basis: "grant",
      operators: [{ eik: NKZHI, grantEur: 1_000_000_000, totalEur: 2_000_000_000, paidEur: 660_000_000, projectCount: 40 }],
    }); // prettier-ignore
    const env = await transportEuFunds({}, ctx);
    expect(env.facts?.absorption).toBe("66%");
  });
});

describe("railSubsidy", () => {
  it("gives no total for a year whose capital transfers are unpublished", async () => {
    vi.mocked(fetchData).mockImplementation(
      async (path) =>
      path.includes("rail_subsidy")
        ? { years: [{ fiscalYear: 2024, bdzPassengerPsoEur: 100_000_000, nkzhiOperatingEur: 150_000_000, bdzCapitalEur: null, nkzhiCapitalEur: null }] } // prettier-ignore
        : { series: [{ year: 2024, passengers: 20_000_000, passengerKmMio: null }] }, // prettier-ignore
    );
    const env = await railSubsidy({}, ctx);
    expect(env.facts?.total_rail_subsidy).toBe("—");
    expect(env.facts?.nkzhi_subsidy).toBe("—");
    expect(env.facts?.subsidy_per_passenger).toBe("€5.00");
    expect(String(env.facts?.note)).toMatch(
      /does not set the 2024 capital transfers/,
    );
  });
});
