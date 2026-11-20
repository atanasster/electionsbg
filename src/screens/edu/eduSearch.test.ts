// The edu finder: the bodies group spans all four lists — the roll-up (one row per
// institution, a retired EIK finding its successor), VERIFY, ADJACENT and the
// external higher schools, the last three labelled as outside the totals — ranked
// by the blob and landing on all-time awarder pages; then the shared
// whole-register groups.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { searchIndex } from "@/lib/entitySearchIndex";
import type { EduHubStats } from "@/data/edu/hubStats";
import { eduBodiesIndex, eduSearchSources } from "./eduSearch";

const blob = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "data/education/derived/hub_stats.json"),
    "utf8",
  ),
) as EduHubStats;

const idx = () => eduBodiesIndex(blob, "bg", true);

describe("edu finder", () => {
  it("finds an institution by name and links it on the all-time window", () => {
    const h = searchIndex(idx(), "софийски университет")[0];
    expect(h?.id).toBe("000670680");
    expect(h!.href).toBe("/awarder/000670680?pscope=all");
    expect(h!.sub).toMatch(/€/);
  });

  it("finds an institution by its EIK", () => {
    expect(searchIndex(idx(), "000455457")[0]?.id).toBe("000455457");
  });

  it("finds the successor by a retired EIK, never the retired row (A5/A6)", () => {
    const hits = searchIndex(idx(), "040624317");
    expect(hits.map((h) => h.id)).toEqual(["000124026"]);
  });

  it("labels a VERIFY centre as outside the totals (D3)", () => {
    const h = searchIndex(idx(), "000403275")[0];
    expect(h?.sub).toContain("извън сумите");
  });

  it("labels an ADJACENT body with its principal (D4)", () => {
    const h = searchIndex(idx(), "НАПОО")[0];
    expect(h?.id).toBe("130273618");
    expect(h!.sub).toContain("Министерски съвет");
  });

  it("lists an external higher school in its own sector, with no € (A2)", () => {
    const h = searchIndex(idx(), "Вапцаров")[0];
    expect(h?.id).toBe("129004492");
    expect(h!.sub).toContain("отбрана");
    expect(h!.sub).not.toMatch(/€/);
  });

  it("ranks by the blob's € once it loads", () => {
    // Hits are tiered (prefix before substring); the universe label „БАН" is a
    // prefix key of every БАН body, so these all sit in one tier.
    const hits = searchIndex(idx(), "бан", 50).filter((h) =>
      h.sub?.startsWith("БАН"),
    );
    expect(hits.length).toBeGreaterThan(5);
    const eur = new Map(blob.bodyIndex.map((b) => [b.eik, b.eur]));
    const ranked = hits.map((h) => eur.get(h.id) ?? 0);
    expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
  });

  it("before the blob loads, shows no €", () => {
    const hits = searchIndex(eduBodiesIndex(null, "bg", true), "университет");
    expect(hits.length).toBeGreaterThan(1);
    for (const h of hits) expect(h.sub).not.toMatch(/€/);
  });

  it("labels the outside lists in English too", () => {
    const en = eduBodiesIndex(blob, "en", false);
    expect(searchIndex(en, "000403275")[0]?.sub).toMatch(/outside the totals/i);
    const ext = searchIndex(en, "129004492")[0];
    expect(ext?.sub).toMatch(/defen[cs]e/i);
    expect(ext!.sub).not.toMatch(/€/);
  });

  it("puts the sector group first, then the whole-register ones", () => {
    const ids = eduSearchSources(blob, "bg", true).map((s) => s.id);
    expect(ids[0]).toBe("bodies");
    expect(ids.length).toBeGreaterThan(1);
  });
});
