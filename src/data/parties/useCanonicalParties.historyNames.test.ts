// Historical BALLOT names → canonical id, the index behind `colorFor`'s last resort.
//
// canonical_parties.json records `КП "Коалиция за България"` under `bsp` in the party's
// `history`, but `byNickName` only carries the nicknames a party goes by TODAY (`БСП`,
// `БСП-ОЛ`). So an MP elected under an old ballot name resolved to nothing and got a grey
// pill, even though the fold knew the lineage all along.
//
// The LABEL deliberately still shows the ballot's own words — resolving it to the current
// nickname would tell someone elected in 2005 that they stood for a coalition formed twenty
// years later — so this index feeds colour only. That split is what these tests pin.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildHistoryNameIndex } from "./useCanonicalParties";

type Party = Parameters<typeof buildHistoryNameIndex>[0] extends
  | readonly (infer P)[]
  | undefined
  ? P
  : never;

const party = (id: string, names: string[]): Party =>
  ({
    id,
    displayName: id.toUpperCase(),
    color: "#e11",
    history: names.map((name, i) => ({
      election: `20${10 + i}_01_01`,
      partyNum: i + 1,
      nickName: id.toUpperCase(),
      name,
    })),
  }) as unknown as Party;

describe("buildHistoryNameIndex", () => {
  // THE regression: the 2013 ballot name of the BSP-led coalition.
  it("maps an old ballot name to the lineage that used it", () => {
    const idx = buildHistoryNameIndex([
      party("bsp", ['КП "Коалиция за България"', "БСП за БЪЛГАРИЯ"]),
    ]);
    expect(idx.get('кп "коалиция за българия"')).toBe("bsp");
    expect(idx.get("бсп за българия")).toBe("bsp");
  });

  it("folds case, so an all-caps register label still resolves", () => {
    const idx = buildHistoryNameIndex([party("bsp", ["КОАЛИЦИЯ ЗА БЪЛГАРИЯ"])]);
    expect(idx.get("коалиция за българия")).toBe("bsp");
  });

  // A name used by two lineages resolves to NOTHING rather than to a guess. Colouring one
  // party's chip with another's is worse than leaving it grey — 5 of the 240 names in the
  // real file collide (ВОЛЯ, ПП Глас Народен, …).
  it("refuses a name used by more than one lineage", () => {
    const idx = buildHistoryNameIndex([
      party("p_76", ["ВОЛЯ"]),
      party("p_99", ["ВОЛЯ"]),
    ]);
    expect(idx.get("воля")).toBeNull();
  });

  it("keeps a name repeated within ONE lineage", () => {
    const idx = buildHistoryNameIndex([party("bsp", ["БСП", "БСП"])]);
    expect(idx.get("бсп")).toBe("bsp");
  });

  it("ignores entries with no name and tolerates no input", () => {
    const idx = buildHistoryNameIndex([party("x", ["", "  "])]);
    expect(idx.size).toBe(0);
    expect(buildHistoryNameIndex(undefined).size).toBe(0);
  });
});

// Against the REAL file, not a fixture — the point of the change is that a name already
// recorded in canonical_parties.json becomes reachable, so a fixture-only test could pass
// while the shipped data still resolved to nothing.
describe("buildHistoryNameIndex over data/canonical_parties.json", () => {
  // Read and built ONCE — the result is immutable and the file is 84 KB.
  const parsed = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data/canonical_parties.json"),
      "utf-8",
    ),
  ) as { parties: Parameters<typeof buildHistoryNameIndex>[0] };
  const idx = buildHistoryNameIndex(parsed.parties);
  const index = () => ({ idx, parsed });

  // Йотова's chip: elected under the 2013 ballot name, which byNickName does not carry.
  it("resolves the BSP-led coalition's old ballot names to bsp", () => {
    const { idx } = index();
    for (const name of [
      'КП "Коалиция за България"',
      "КОАЛИЦИЯ ЗА БЪЛГАРИЯ",
      "БСП лява България",
    ]) {
      expect(idx.get(name.toLocaleLowerCase("bg"))).toBe("bsp");
    }
  });

  // …and that id must carry a colour, which is the whole point of the lookup. The file
  // stores them as `rgb(r, g, b)`, not hex.
  it("gives those names a real colour", () => {
    const { idx, parsed } = index();
    const id = idx.get('кп "коалиция за българия"');
    const party = (parsed.parties ?? []).find((p) => p.id === id);
    expect(party?.color).toMatch(/^(#|rgb)/);
  });

  // Asserted as a PROPERTY over whatever the file happens to contain. Naming ВОЛЯ
  // specifically would pin a data accident: the day the generator merges those two
  // lineages this would go red for a data change with the code untouched, and the
  // cheapest response would be to delete the assertion.
  it("still refuses every name two lineages share", () => {
    const { idx, parsed } = index();
    const byName = new Map<string, Set<string>>();
    for (const p of parsed.parties ?? [])
      for (const h of p.history ?? []) {
        const k = (h.name ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase("bg");
        if (!k) continue;
        const set = byName.get(k) ?? new Set<string>();
        set.add(p.id);
        byName.set(k, set);
      }
    const shared = [...byName]
      .filter(([, ids]) => ids.size > 1)
      .map(([k]) => k);
    expect(shared.length).toBeGreaterThan(0); // the rule must not go vacuous
    for (const k of shared) expect(idx.get(k)).toBeNull();
  });

  // FINDING-001's payload: the fold partyGroupShortColor applies must also hit.
  it("indexes names under the group-short fold as well as the raw one", () => {
    const { idx } = index();
    // stripGroupPrefix removes the trailing quote; both spellings must resolve.
    expect(idx.get('кп "коалиция за българия"')).toBe("bsp");
    expect(idx.get('кп "коалиция за българия')).toBe("bsp");
  });
});
