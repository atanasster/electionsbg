// The registry-name → obshtina join, and the collision it refuses to guess through.
//
// WHY THIS FILE EXISTS. The defect class here is SILENT: a wrong obshtina code resolves and
// serves at a 200, so every gate downstream is shard-relative and cannot see it. Until
// 2026-09-04 `Бяла/Варна/` and `Бяла/Русе/` both resolved to RSE04, which left obshtina
// VAR05 the one municipality of 288 with no shard at all while RSE04 published the merged
// roster of both — 36 rows carrying TWO mayors and TWO council chairs. The four assertions in
// scripts/db/tests/official_roster_obshtina.data.test.ts were all green throughout: each asks
// whether a shard's rows reached Postgres, none asks whether the shard SET covers the
// catalogue. Plan: docs/plans/officials-roster-missing-mayor-v1.md (T1, T4.1).
//
// Reads the committed catalogue and register index, so it needs no Postgres and no network.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildResolver, duplicateNames } from "./municipality_join";
import type {
  MunicipalIndexFile,
  MunicipalityInfo,
} from "../../src/data/dataTypes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const MUNICIPALITIES_PATH = path.join(ROOT, "data", "municipalities.json");
const INDEX_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "index.json",
);

const municipalities: MunicipalityInfo[] = JSON.parse(
  fs.readFileSync(MUNICIPALITIES_PATH, "utf-8"),
);
const resolve = buildResolver();

describe("buildResolver — the Бяла collision", () => {
  // The regression itself. Both spellings carry an oblast BECAUSE the bare name is
  // ambiguous; reading it is the whole fix.
  it("resolves each Бяла to its own obshtina", () => {
    expect(resolve("Бяла/Варна/")?.code).toBe("VAR05");
    expect(resolve("Бяла/Русе/")?.code).toBe("RSE04");
  });

  // ⚠️ THE MUTATION CHECK, and the reason the assertion above is not enough on its own: an
  // implementation that never reads the oblast still satisfies it for whichever Бяла the
  // catalogue happens to list last. Re-deriving the pre-fix rule here — bare name → the
  // deduped map, last-write-wins — must produce the WRONG answer for at least one of them,
  // otherwise "we read the oblast" is untested and catalogue order is doing the work.
  it("the oblast hint is what decides — the bare-name rule gets one of them wrong", () => {
    const bareLastWriteWins = new Map<string, string>();
    for (const m of municipalities) {
      if (m.oblast === "32") continue;
      if (["S23", "S24", "S25"].includes(m.oblast)) continue;
      bareLastWriteWins.set(m.name.toLowerCase(), m.obshtina);
    }
    const naive = bareLastWriteWins.get("бяла");
    expect(naive).toBeDefined();
    const correct = ["VAR05", "RSE04"].map((c) => c === naive);
    expect(correct.filter(Boolean)).toHaveLength(1);
    // …and the resolver disagrees with it on exactly the other one.
    const wrong = naive === "VAR05" ? "Бяла/Русе/" : "Бяла/Варна/";
    expect(resolve(wrong)?.code).not.toBe(naive);
  });

  it("a bare ambiguous name refuses rather than picking one", () => {
    expect(resolve("Бяла")).toBeNull();
  });

  // The refusal must be NARROW. искър/средец collide in the catalogue too, but each pairs a
  // province município with a Sofia район that rule 3 owns, so they must keep resolving — a
  // refusal rule that swept them in would drop two real municipalities from the shard tree.
  it("names that collide only with a Sofia район still resolve", () => {
    expect(resolve("Искър")?.code).toBe("PVN23");
    expect(resolve("Средец")?.code).toBe("BGS06");
    expect(resolve("Район Искър")?.code).toBe("S2414");
    expect(resolve("Район Средец")?.code).toBe("S2401");
  });
});

describe("buildResolver — the oblast hint's three outcomes", () => {
  it("an agreeing hint resolves a unique name", () => {
    expect(resolve("Разлог/Благоевград/")?.code).toBe("BLG37");
  });

  // Widening the refusal past ambiguity is deliberate (oblastNames.ts's "2011 Добрич
  // shape"), but it must not swallow the case below it.
  it("a contradicting hint refuses a unique name", () => {
    expect(resolve("Разлог/Варна/")).toBeNull();
  });

  it("an UNKNOWN oblast spelling still resolves a unique name", () => {
    // Nothing that matched before the oblast arm landed may stop matching, and the register
    // is free to invent a spelling oblastNames.ts has never seen.
    expect(resolve("Разлог/Несъществуваща/")?.code).toBe("BLG37");
  });

  it("a hint naming a real oblast with no such município refuses", () => {
    expect(resolve("Бяла/Пловдив/")).toBeNull();
  });
});

describe("duplicateNames", () => {
  it("reports the collisions that survive the resolver's own partition", () => {
    const dupes = duplicateNames();
    // Derived, not asserted as a literal set: the point is that it tracks the catalogue.
    // What is pinned is the PARTITION — Sofia районни are excluded, so a name colliding only
    // with one of them is not reported here.
    expect([...dupes.keys()]).toContain("бяла");
    expect([...dupes.keys()]).not.toContain("искър");
    expect([...dupes.keys()]).not.toContain("средец");
    for (const [, claimants] of dupes)
      expect(claimants.length).toBeGreaterThan(1);
  });

  it("every reported collision is refused by the bare-name rule", () => {
    // The two must agree: a name this says is ambiguous must be one the resolver will not
    // guess at. Reported-but-resolvable would mean the CLI diagnoses a refusal that never
    // happens; resolvable-but-unreported would mean a silent pick.
    for (const [name] of duplicateNames()) expect(resolve(name)).toBeNull();
  });
});

describe("the whole register resolves", () => {
  it("every institution name in index.json maps to an obshtina", () => {
    const index: MunicipalIndexFile = JSON.parse(
      fs.readFileSync(INDEX_PATH, "utf-8"),
    );
    const names = [...new Set(index.entries.map((e) => e.municipality))];
    const unresolved = names.filter((n) => !resolve(n));
    // An unresolved name is an official absent from the shard tree — the failure T1 exists
    // to end — so this is an equality, not a ratio.
    expect(unresolved).toEqual([]);
    expect(names.length).toBeGreaterThan(250);
  });

  it("every non-abroad catalogue name resolves to its OWN code", () => {
    // The converse direction, and the one the shard-relative gates cannot express: a
    // município the resolver cannot name is a município with no roster page.
    const misrouted: string[] = [];
    for (const m of municipalities) {
      if (m.oblast === "32") continue;
      // Sofia районни are reached by their "Район X" spelling, not their bare name.
      const probe = ["S23", "S24", "S25"].includes(m.oblast)
        ? `Район ${m.name}`
        : m.name;
      const got = resolve(probe);
      if (got?.code !== m.obshtina)
        misrouted.push(`${m.obshtina} (${m.name}) → ${got?.code ?? "null"}`);
    }
    // Бяла is the one exception and it is the POINT: neither Бяла is reachable by its bare
    // name, because the register spells both with an oblast. Anything else here is a
    // município that lost its page.
    expect(misrouted.sort()).toEqual([
      "RSE04 (Бяла) → null",
      "VAR05 (Бяла) → null",
    ]);
  });
});
