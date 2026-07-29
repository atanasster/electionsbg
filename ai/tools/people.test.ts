// run() tests for the MP declared-assets tools after their persons-pg-retirement-v1 T2.5
// cutover from the retired assets-rankings.json(+-top) onto the `mp_assets_rankings` registry.
// The stub returns the /api/db/table body shape ({ rows }) with money as STRINGS (Postgres
// numeric over the wire) so the tool's Number() coercion and the per-party rollup are exercised.

import { describe, it, expect, afterEach } from "vitest";
import { mpAssetsTop, mpAssetsByParty } from "./people";
import { setDbFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const ctx = { lang: "bg" } as ToolContext;

describe("mpAssetsTop run()", () => {
  afterEach(() => clearDataCache());

  it("maps the registry's net-worth-ranked rows into the assets table", async () => {
    // Server order is trusted (sort net_worth_eur desc NULLS LAST); the tool does not re-sort.
    setDbFetcher(async () => ({
      rows: [
        {
          name: "Делян Славчев Пеевски",
          partyGroupShort: "ПГ на ДПС",
          isCurrent: true,
          totalAssetsEur: "10972598",
          netWorthEur: "10972598",
        },
        {
          name: "Станислав Тодоров Трифонов",
          partyGroupShort: null,
          isCurrent: true,
          totalAssetsEur: "7608938",
          netWorthEur: "7608938",
        },
      ],
    }));
    const env = await mpAssetsTop({}, ctx);
    expect(env.tool).toBe("mpAssetsTop");
    const rows = env.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0].mp).toBe("Делян Славчев Пеевски");
    // null group renders as an em dash, never "null".
    expect(rows[1].group).toBe("—");
    // String money is coerced + formatted (non-empty, not the literal string).
    expect(typeof rows[0].assets).toBe("string");
    expect(rows[0].assets).not.toBe("10972598");
    expect(String(rows[0].assets).length).toBeGreaterThan(0);
    // Grounded facts point at the richest MP, off person_wealth_year (the registry).
    expect(env.facts.richest).toBe("Делян Славчев Пеевски");
    expect(String(env.facts.richest_assets).length).toBeGreaterThan(0);
    expect(env.provenance).toEqual(["db:mp_assets_rankings"]);
  });
});

describe("mpAssetsByParty run()", () => {
  afterEach(() => clearDataCache());

  it("rolls declaring MPs up per party, dropping group-less MPs", async () => {
    setDbFetcher(async () => ({
      rows: [
        {
          name: "A",
          partyGroupShort: "ПГ на ГЕРБ – СДС",
          isCurrent: true,
          totalAssetsEur: "300000",
          netWorthEur: "300000",
        },
        {
          name: "B",
          partyGroupShort: "ПГ на ГЕРБ – СДС",
          isCurrent: true,
          totalAssetsEur: "100000",
          netWorthEur: "100000",
        },
        {
          name: "C",
          partyGroupShort: "ПГ на ДПС",
          isCurrent: true,
          totalAssetsEur: "900000",
          netWorthEur: "900000",
        },
        // Group-less (independent) MP — must be excluded from the party rollup entirely.
        {
          name: "D",
          partyGroupShort: null,
          isCurrent: true,
          totalAssetsEur: "5000000",
          netWorthEur: "5000000",
        },
      ],
    }));
    const env = await mpAssetsByParty({}, ctx);
    expect(env.tool).toBe("mpAssetsByParty");
    const rows = env.rows ?? [];
    // Two party rows, sorted by average desc: ДПС (900k avg) over ГЕРБ (200k avg). No "—" row.
    expect(rows.map((r) => r.party)).toEqual(["ДПС", "ГЕРБ – СДС"]);
    expect(rows.every((r) => r.party !== "—")).toBe(true);
    const gerb = rows.find((r) => r.party === "ГЕРБ – СДС");
    expect(gerb?.mps).toBe(2);
    // richest_party names the top-average group.
    expect(String(env.facts.richest_party)).toContain("ДПС");
    expect(env.provenance).toEqual(["db:mp_assets_rankings"]);
  });
});
