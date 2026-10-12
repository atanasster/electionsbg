// The roads finder: the places group is built from the blob and lands on pages
// that can serve it; the two server groups are labelled as whole-register (the
// route takes no sector) and share ONE request per needle.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { searchIndex } from "@/lib/entitySearchIndex";
import { __resetProcurementSearchCache } from "@/screens/components/search/procurementSearchSource";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import type { ServerSource } from "@/ux/search/hubSearchSources";
import { roadsPlacesIndex, roadsSearchSources } from "./roadsSearch";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/roads/derived/hub_stats.json"),
    "utf8",
  ),
) as RoadsHubStats;

afterEach(() => {
  vi.unstubAllGlobals();
  __resetProcurementSearchCache();
});

describe("roads finder", () => {
  it("finds a corridor and links it to the focused network page", () => {
    const hits = searchIndex(roadsPlacesIndex(blob, "bg", true), "хемус");
    const h = hits.find((x) => x.label === "Хемус");
    expect(h).toBeTruthy();
    expect(h!.href).toBe(
      `/sector/roads/network?corridor=${encodeURIComponent("Хемус")}&pscope=all`,
    );
  });

  it("offers no ОПУ rows — the procurement page cannot show one by itself", () => {
    expect(searchIndex(roadsPlacesIndex(blob, "bg", true), "опу")).toHaveLength(
      0,
    );
    expect(
      searchIndex(roadsPlacesIndex(blob, "bg", true), "софия"),
    ).toHaveLength(0);
  });

  it("sends see-all to the set the group searched (no ?sector)", () => {
    const contracts = roadsSearchSources(blob, "bg", true).find(
      (s) => s.id === "contracts",
    ) as ServerSource;
    const href = String(contracts.seeAll?.("магистрала")?.to ?? "");
    expect(href).not.toContain("sector=");
  });

  it("omits the places group until the blob has loaded", () => {
    const ids = roadsSearchSources(null, "bg", true).map((s) => s.id);
    expect(ids).toEqual(["contractors", "contracts"]);
  });

  it("labels both server groups as whole-register", () => {
    for (const s of roadsSearchSources(blob, "bg", true).filter(
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
    const servers = roadsSearchSources(blob, "bg", true).filter(
      (x): x is ServerSource => x.kind === "server",
    );
    const ac = new AbortController();
    await Promise.all(servers.map((s) => s.fetch("магистрала", ac.signal)));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
