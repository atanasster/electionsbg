// run() tests for the MP declared-assets tools after their persons-pg-retirement-v1 T2.5
// cutover from the retired assets-rankings.json(+-top) onto the `mp_assets_rankings` registry.
// The stub returns the /api/db/table body shape ({ rows }) with money as STRINGS (Postgres
// numeric over the wire) so the tool's Number() coercion and the per-party rollup are exercised.

import { beforeEach, describe, it, expect, afterEach } from "vitest";
import {
  mpConnectionsTop,
  mpConnectionsByParty,
  mpAssetsTop,
  mpAssetsByParty,
} from "./people";
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

// ── The two MP-connection ranking tools, after the move off the retired shards ──
//
// They read /api/db/graph-mp-rankings now. The numbers they report are LOWER
// than the shards' were, and that is the correction rather than a regression:
// parliament/connections-rankings*.json matched a company officer to a power
// roster BY NAME and kept the match, while the PG graph is built from the gated
// person layer, which refuses a name the Commerce Registry records for more
// than one person. Measured: the shards' highest degree was 318 against the
// graph's 12 — and the shard file was UNSORTED, so the old tool's headline was
// its first record rather than the most connected MP.
describe("MP connection rankings (PG-backed)", () => {
  const mps = [
    { name: "А Б В", party: "ГЕРБ", degree: 12 },
    { name: "Г Д Е", party: "ГЕРБ", degree: 8 },
    { name: "Ж З И", party: "БСП", degree: 6 },
  ];

  beforeEach(() => {
    clearDataCache();
    setDbFetcher(async (route: string) => {
      if (route !== "graph-mp-rankings")
        throw new Error(`unexpected route ${route}`);
      return { mps };
    });
  });

  it("ranks MPs by their graph degree", async () => {
    const env = await mpConnectionsTop({}, { lang: "bg" } as never);
    expect(env.rows?.[0]).toMatchObject({ mp: "А Б В", links: 12 });
    expect(env.facts?.most_connected).toBe("А Б В");
    // provenance must name the route, not the retired file — otherwise a
    // reader is told the number came from something that no longer exists.
    expect(env.provenance).toContain("/api/db/graph-mp-rankings");
    expect(JSON.stringify(env.provenance)).not.toContain(
      "connections-rankings",
    );
  });

  it("aggregates by party over the SITTING parliament only", async () => {
    let asked: Record<string, unknown> = {};
    setDbFetcher(async (_r: string, q: Record<string, unknown>) => {
      asked = q;
      return { mps };
    });
    const env = await mpConnectionsByParty({}, { lang: "bg" } as never);
    // person_role holds one row per (mp_id, ns) — 754 people across four
    // National Assemblies against the sitting 97 — so an unrestricted rollup
    // answers a question nobody asked.
    expect(asked.current).toBe(1);
    expect(env.rows?.[0]).toMatchObject({ party: "ГЕРБ", mps: 2, links: 20 });
  });
});
