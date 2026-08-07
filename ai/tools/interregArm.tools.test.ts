// The two invariants a future "helpful" edit is most likely to break, and both
// are invisible to every row count:
//
//   1. THE ARMS ARE NEVER SUMMED. ИСУН money is *attributed* — a contract naming
//      N общини contributes 1/N to each — while an Interreg figure is one
//      partner's own published budget at one address. `facts.total` must stay
//      the ИСУН figure and the Interreg money must travel beside it under its
//      own key. Merging them produces a number with no definition.
//   2. THE ARM IS ADDITIVE, NEVER LOAD-BEARING. A database without the Interreg
//      corpus — a checkout before migration 137, or a Cloud SQL where
//      apply_functions.ts was never run for 138 — must keep the exact ИСУН
//      answer it gave before, minus the Interreg keys.
//
// Hermetic: the db fetcher is swapped for an in-memory fixture. No DB, no bucket.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { placeEuProjects } from "./profile";
import { fundsOverview } from "./fiscal";
import { setDbFetcher, setFetcher, clearDataCache } from "./dataClient";
import fs from "node:fs";
import path from "node:path";
import type { ToolContext } from "./types";

const ctx = { lang: "bg" } as ToolContext;

const ISUN_TOTAL = 21_163_788.84;
const INTERREG_TOTAL = 1_399_045.34;

const muniSummary = {
  kind: "muni",
  placeId: "BGS12",
  rollup: {
    totalEur: ISUN_TOTAL,
    paidEur: 12_344_124.03,
    grantEur: 17_849_019.03,
    contractCount: 102,
    beneficiaryCount: 69,
  },
  topContracts: [
    { title: "Пример", totalEur: 500_000, paidEur: 250_000, muniCount: 1 },
  ],
  topPrograms: [],
  perCapitaEur: 100,
  population: 2628,
  perCapitaRank: 3,
  cohortSize: 13,
  oblastCode: "BGS",
};

const interregPlace = {
  budgetEur: INTERREG_TOTAL,
  operationCount: 7,
  partnerCount: 7,
  unpublishedPartnerCount: 0,
  operations: [
    {
      keepId: 17853,
      titleEn: "Cross-Border Cooperation for Promoting Bio-diversity",
      titleBg: null,
      period: "2021-2027",
      programmeBg: "Interreg BG-TR",
      programmeEn: "Interreg BG-TR",
      localBudgetEur: 357_183.12,
      // The whole cross-border project — four times the local share. It must
      // never reach a money field.
      operationTotalEur: 1_419_207.76,
    },
  ],
};

const fundsIndex = {
  totals: { beneficiaries: 1000, contractedEur: 44_000_000_000, paidEur: 1 },
  topByContracted: [{ name: "X", contractedEur: 1 }],
};

const interregOverview = {
  budgetEur: 396_391_983.4,
  partnerCount: 1493,
  operationCount: 1115,
  programmeCount: 19,
  placedCount: 1469,
  unpublishedPartnerCount: 21,
  periods: {},
  oblasts: {},
  programmes: [],
};

const fixture =
  (opts: { interreg: boolean }) =>
  async (route: string, params: Record<string, unknown>) => {
    if (route === "fund-payload" && params.kind === "muni-summary")
      return muniSummary;
    if (route === "fund-payload" && params.kind === "index") return fundsIndex;
    if (route === "fund-payload") return null;
    if (!opts.interreg)
      throw Object.assign(new Error("42P01"), { code: "42P01" });
    if (route === "interreg-place") return interregPlace;
    if (route === "interreg-overview") return interregOverview;
    return null;
  };

// resolvePlaceForData reads /municipalities.json through the STATIC fetcher,
// not the db one, so both have to be stubbed or the tool never gets a place.
const staticFixture = async (p: string) => {
  if (p.endsWith("municipalities.json"))
    return JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "data/municipalities.json"),
        "utf8",
      ),
    );
  throw new Error(`unexpected static fetch: ${p}`);
};

beforeEach(() => {
  clearDataCache();
  setFetcher(staticFixture as never);
});
afterEach(() => clearDataCache());

describe("the Interreg arm is additive, never merged", () => {
  it("keeps facts.total on the ИСУН basis and reports Interreg separately", async () => {
    setDbFetcher(fixture({ interreg: true }) as never);
    const env = await placeEuProjects({ place: "Малко Търново" }, ctx);
    const facts = env.facts ?? {};
    // The number a caller reads as "EU money here" must still be the ИСУН one.
    expect(facts.total).toContain("21");
    expect(facts.total).not.toContain("22,5");
    expect(facts.interreg_eur).toBeTruthy();
    expect(facts.interreg_projects).toBe("7");
    // And the operation TOTAL never appears as a money figure — €1,419,207 on
    // a municipality of 2,628 people would be four times the truth.
    expect(JSON.stringify(env)).not.toContain("1 419 207");
    expect(JSON.stringify(env)).not.toContain("1,419,207");
  });

  it("labels every Interreg row so it cannot read as an ИСУН contract", async () => {
    setDbFetcher(fixture({ interreg: true }) as never);
    const env = await placeEuProjects({ place: "Малко Търново" }, ctx);
    const rows = env.rows ?? [];
    const tagged = rows.filter((r) => String(r.project).includes("[Interreg]"));
    expect(tagged.length).toBe(1);
    // keep.eu publishes no expenditure at all, so "paid" is not derivable —
    // an em dash, never a zero.
    expect(tagged[0].paid).toBe("—");
  });

  it("answers identically without the corpus, minus the Interreg keys", async () => {
    setDbFetcher(fixture({ interreg: true }) as never);
    const withArm = await placeEuProjects({ place: "Малко Търново" }, ctx);
    clearDataCache();
    setDbFetcher(fixture({ interreg: false }) as never);
    const without = await placeEuProjects({ place: "Малко Търново" }, ctx);

    expect(without.facts?.total).toBe(withArm.facts?.total);
    expect(without.facts?.paid).toBe(withArm.facts?.paid);
    expect(without.facts?.contracts).toBe(withArm.facts?.contracts);
    expect(without.facts?.interreg_eur).toBeUndefined();
    expect(
      (without.rows ?? []).some((r) =>
        String(r.project).includes("[Interreg]"),
      ),
    ).toBe(false);
  });

  it("does not merge the national totals either", async () => {
    setDbFetcher(fixture({ interreg: true }) as never);
    const env = await fundsOverview({}, ctx);
    // €44bn stays €44bn; the €396m rides beside it under its own key.
    expect(env.facts?.contracted).toBeTruthy();
    expect(env.facts?.interreg_contracted).toBeTruthy();
    expect(env.facts?.contracted).not.toBe(env.facts?.interreg_contracted);
  });
});
