// The water finder: the operator group is the sector register, ranked by the
// blob and landing on all-time company pages; the two server groups are labelled
// as whole-register (the route takes no sector) and share ONE request per needle.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { searchIndex } from "@/lib/entitySearchIndex";
import { __resetProcurementSearchCache } from "@/screens/components/search/procurementSearchSource";
import type { WaterHubStats } from "@/data/water/hubStats";
import type { ServerSource } from "@/ux/search/hubSearchSources";
import { waterOperatorsIndex, waterSearchSources } from "./waterSearch";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/water/derived/hub_stats.json"),
    "utf8",
  ),
) as WaterHubStats;

afterEach(() => {
  vi.unstubAllGlobals();
  __resetProcurementSearchCache();
});

describe("water finder", () => {
  it("finds an operator by province and links it on the all-time window", () => {
    const hits = searchIndex(waterOperatorsIndex(blob, "bg", true), "варна");
    const h = hits.find((x) => x.label.includes("Варна"));
    expect(h).toBeTruthy();
    expect(h!.href).toMatch(/^\/company\/\d+\?pscope=all$/);
  });

  it("sends a liquidated operator to its successor and says it is liquidated", () => {
    const hits = searchIndex(
      waterOperatorsIndex(blob, "bg", true),
      "пазарджик",
    );
    const dead = hits.find((x) => x.id === "822106665");
    expect(dead?.sub).toContain("в ликвидация");
    expect(dead?.href).toContain("/company/205323041");
    // No € of its own beside a link to another company's page.
    expect(dead?.sub).not.toMatch(/€/);
    expect(dead?.sub).toContain("→");
  });

  it("ranks by the blob's € once it has loaded", () => {
    const hits = searchIndex(
      waterOperatorsIndex(blob, "bg", true),
      "пазарджик",
    );
    const eur = new Map(blob.operatorIndex.map((o) => [o.eik, o.eur]));
    // A row that links to its successor ranks as 0 — its own € is not shown.
    const ranked = hits.map((h) =>
      h.id === "822106665" ? 0 : (eur.get(h.id) ?? 0),
    );
    expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
  });

  it("still finds operators before the blob loads", () => {
    expect(
      searchIndex(waterOperatorsIndex(null, "bg", true), "софийска вода"),
    ).not.toHaveLength(0);
  });

  it("sends see-all to the set the group searched (no ?sector)", () => {
    const contracts = waterSearchSources(blob, "bg", true).find(
      (s) => s.id === "contracts",
    ) as ServerSource;
    const href = String(contracts.seeAll?.("пречиствателна")?.to ?? "");
    expect(href).not.toContain("sector=");
  });

  it("labels both server groups as whole-register", () => {
    for (const s of waterSearchSources(blob, "bg", true).filter(
      (x) => x.kind === "server",
    ))
      expect(s.label.bg).toContain("в целия регистър");
  });

  it("issues ONE request for both server groups", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ companies: [], contracts: [] }),
    }));
    vi.stubGlobal("fetch", fetch);
    const servers = waterSearchSources(blob, "bg", true).filter(
      (x): x is ServerSource => x.kind === "server",
    );
    const ac = new AbortController();
    await Promise.all(servers.map((s) => s.fetch("помпа", ac.signal)));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
