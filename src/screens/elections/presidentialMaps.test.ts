// Two claims this family makes that no other gate can see, and that a passing suite would hide.
//
// ⚠ BOTH ARE ABOUT COMMENTS BECOMING CODE. `electionMapSlots.ts` records a MEASURED refusal —
// no `presidential/*` adapter, because a region-page map would fetch a 974.6 KB whole-country
// file and a municipality-page map 14.4 MB, the exact downloads the per-place artifacts exist
// to avoid. And `electionSurfaceDescriptors.ts` repointed five map questions off the shared
// `election_map_q_who_led_*` keys, all of which read „Коя ПАРТИЯ води…" — false on a ballot of
// named pairs. Neither is enforceable by reading: registering an adapter, or reverting the
// keys, leaves every existing gate green.

import { describe, expect, it } from "vitest";
import { MAP_ADAPTERS } from "./electionMapSlots";
import {
  descriptorFor,
  ELECTION_SURFACE_DESCRIPTORS,
} from "./electionSurfaceDescriptors";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import type { ElectionPlaceLevel } from "@/data/elections/surfaceTypes";

/** ⚠ A DESCRIPTOR MAY BE `ElectionLevelUnavailable`, which has no `maps` at all — the union is
 *  „this level exists" vs „this kind does not serve it", and that is a real state (a
 *  presidential ballot has no seats to map, a local one no abroad). Reading `.maps` off the
 *  union is a type error; this narrows instead of casting, so a level that becomes
 *  unavailable drops out of the loops rather than crashing them. */
const mapsOf = (
  d: ReturnType<typeof descriptorFor>,
): readonly { questionKey: string }[] => ("maps" in d ? d.maps : []);

const LEVELS = Object.keys(
  ELECTION_SURFACE_DESCRIPTORS.presidential,
) as ElectionPlaceLevel[];

describe("the presidential map refusal", () => {
  it("registers no presidential adapter, which is the measured decision", () => {
    // ⚠ REGISTERING ONE IS THE DEFECT, not the fix. Every presidential level below the country
    // would have to fetch a whole-country roll-up to colour its children, and the corpus is at
    // 58,915 objects against a 60,000 bound — so sharding those children instead is a coverage
    // decision with its own arithmetic. The country map is served OUTSIDE this registry, by
    // `PresidentialRegionsMap` on the cycle page, from the 113.9 KB region roll-up it needs in
    // full anyway.
    const presidential = Object.keys(MAP_ADAPTERS).filter((k) =>
      k.startsWith("presidential/"),
    );
    expect(
      presidential,
      "an adapter was registered — see electionMapSlots.ts for the measured sizes it would fetch",
    ).toEqual([]);
    // The control: the registry is not simply empty.
    expect(
      Object.keys(MAP_ADAPTERS).filter((k) => k.startsWith("parliamentary/"))
        .length,
    ).toBeGreaterThan(3);
  });
});

describe("the presidential map questions", () => {
  it("never names a shared `election_map_q_*` key", () => {
    // ⚠ THE SHARED KEYS ALL SAY „ПАРТИЯ", and a ticket is a PAIR of named people whose
    // nominator may be a party, a coalition or an инициативен комитет — the same reason a
    // ranked row here carries `partyId: null`. The shell renders `questionKey` as a heading
    // whether or not an adapter exists, so the wrong wording prints above „картата не е
    // налична" on every presidential place page. Both spellings resolve in both corpora, so
    // a revert is invisible to every copy-coverage gate.
    for (const level of LEVELS)
      for (const m of mapsOf(descriptorFor("presidential", level)))
        expect(m.questionKey, `presidential/${level}`).toMatch(
          /^presidential_map_q_/,
        );
  });

  it("names a key BOTH corpora carry, and at least one level declares a map", () => {
    let declared = 0;
    for (const level of LEVELS)
      for (const m of mapsOf(descriptorFor("presidential", level))) {
        declared += 1;
        expect(bgCorpus[m.questionKey], `bg ${m.questionKey}`).toBeTruthy();
        expect(enCorpus[m.questionKey], `en ${m.questionKey}`).toBeTruthy();
      }
    // Non-vacuity: a descriptor set that declared no maps at all would satisfy both loops.
    expect(declared).toBeGreaterThanOrEqual(5);
  });

  it("keeps the shared keys for the OTHER kinds, so the split is real", () => {
    // If every kind had been repointed, the first assertion would be about nothing.
    // ⚠ Driven from EACH kind's own level set — the three descriptor records are keyed by
    // `ElectionPlaceLevel` but a kind may legitimately declare a level as unavailable with no
    // `maps` array at all, and indexing one kind's levels into another is a `TypeError`.
    const shared = (["parliamentary", "local"] as const).flatMap((kind) =>
      (
        Object.keys(ELECTION_SURFACE_DESCRIPTORS[kind]) as ElectionPlaceLevel[]
      ).flatMap((level) =>
        mapsOf(descriptorFor(kind, level)).map((m) => m.questionKey),
      ),
    );
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((k) => k.startsWith("election_map_q_"))).toBe(true);
  });
});
