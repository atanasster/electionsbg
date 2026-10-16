// The transport finder: the bodies group is the sector register plus the VERIFY body
// (labelled as outside the totals), ranked by the blob and landing on all-time awarder
// pages; the sections group lands on the contracts naming both places; the two server
// groups are the shared whole-register ones.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { searchIndex } from "@/lib/entitySearchIndex";
import type { TransportHubStats } from "@/data/transport/hubStats";
import {
  transportBodiesIndex,
  transportSectionsIndex,
  transportSearchSources,
} from "./transportSearch";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/transport/derived/hub_stats.json"),
    "utf8",
  ),
) as TransportHubStats;

describe("transport finder", () => {
  it("finds a body by name and links it on the all-time window", () => {
    const h = searchIndex(transportBodiesIndex(blob, "bg", true), "булатса")[0];
    expect(h?.id).toBe("000697179");
    expect(h!.href).toBe("/awarder/000697179?pscope=all");
  });

  it("finds a body by its mode", () => {
    const hits = searchIndex(transportBodiesIndex(blob, "bg", true), "въздух");
    expect(hits.map((x) => x.id)).toContain("115007069"); // Летище Пловдив (D2)
  });

  it("lists the VERIFY body as outside the totals (D3)", () => {
    const h = searchIndex(transportBodiesIndex(blob, "bg", true), "калафат")[0];
    expect(h?.id).toBe("202623635");
    expect(h!.sub).toContain("извън сумите");
  });

  it("ranks by the blob's € once it loads", () => {
    const hits = searchIndex(transportBodiesIndex(blob, "bg", true), "дп");
    const eur = new Map(blob.bodyIndex.map((b) => [b.eik, b.eur]));
    const ranked = hits.map((h) => eur.get(h.id) ?? 0);
    expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
  });

  it("lands a section on the contracts naming both places", () => {
    const h = searchIndex(transportSectionsIndex(blob, "bg"), "видин")[0];
    expect(h?.href).toMatch(
      /^\/procurement\/contracts\?sector=transport&pscope=all&q=%D0%92%D0%B8%D0%B4%D0%B8%D0%BD/,
    );
  });

  it("before the blob loads, shows no € and has no sections", () => {
    const hits = searchIndex(transportBodiesIndex(null, "bg", true), "дп");
    expect(hits.length).toBeGreaterThan(1);
    for (const h of hits) expect(h.sub).not.toMatch(/€/);
    expect(searchIndex(transportSectionsIndex(null, "bg"), "видин")).toEqual(
      [],
    );
  });

  it("puts the two sector groups first, then the whole-register ones", () => {
    const ids = transportSearchSources(blob, "bg", true).map((s) => s.id);
    expect(ids.slice(0, 2)).toEqual(["bodies", "sections"]);
    expect(ids.length).toBeGreaterThan(2);
  });
});
