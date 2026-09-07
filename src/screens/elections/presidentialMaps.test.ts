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
import fs from "node:fs";
import path from "node:path";
import { MAP_ADAPTERS } from "./electionMapSlots";
import {
  descriptorFor,
  ELECTION_SURFACE_DESCRIPTORS,
} from "./electionSurfaceDescriptors";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import type { ElectionPlaceLevel } from "@/data/elections/surfaceTypes";

const ROOT = path.resolve(import.meta.dirname, "../../..");

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

describe("the presidential map registry", () => {
  it("serves the two levels whose roll-up is small enough, and refuses the rest", () => {
    // ⚠ THIS CASE USED TO ASSERT THAT NOTHING WAS REGISTERED, and the argument it carried was
    // about RAW bytes: „every presidential level below the country would have to fetch a
    // whole-country roll-up". The fetch is still whole-country — the tree has no per-place
    // shards — but the sizes were re-measured against what a reader actually pays, which is the
    // GZIPPED object, and two of them are servable: 0.96 MB → 47 KB at region, 14.63 MB →
    // 346 KB at município. `settlement` and `abroad` stay refused for reasons that are NOT
    // size (a marker map at section grain, and a missing country→continent crosswalk).
    //
    // Pinned as an exact set rather than „at least these": a third entry appearing here is
    // either the section level, which needs a different component, or `abroad`, which needs a
    // join nobody has built — both worth failing on.
    expect(
      Object.keys(MAP_ADAPTERS)
        .filter((k) => k.startsWith("presidential/"))
        .sort(),
    ).toEqual([
      "presidential/municipality/winner",
      "presidential/region/winner",
    ]);
    // The control: the registry is not simply empty.
    expect(
      Object.keys(MAP_ADAPTERS).filter((k) => k.startsWith("parliamentary/"))
        .length,
    ).toBeGreaterThan(3);
  });

  it("keeps every registered level's roll-up on the gzip hot list", () => {
    // ⚠⚠ THE REGISTRATION AND THE GZIP LIST ARE ONE DECISION, AND NOTHING ELSE COUPLES THEM.
    // The bucket stores objects UNCOMPRESSED unless `scripts/bucket_gzip.ts` re-uploads them
    // with `Content-Encoding: gzip` — verified live, GCS answers
    // `x-goog-stored-content-encoding: identity` for a data object that is not on that list.
    // So dropping `settlement_votes.json` from it does not fail a build, break a page or move a
    // row count: it silently turns every presidential município page into a 14.6 MB download.
    //
    // Read off the SOURCE rather than imported: `bucket_gzip.ts` is a node script with
    // `process.argv` at module scope, and pulling it into this project to check a string list
    // would be worse than reading the string list.
    const gz = fs.readFileSync(
      path.join(ROOT, "scripts/bucket_gzip.ts"),
      "utf8",
    );
    const block = gz.slice(
      gz.indexOf("const PER_ROUND_FILES"),
      gz.indexOf("]", gz.indexOf("const PER_ROUND_FILES")),
    );
    // The file each registered level's adapter fetches, by the grain its descriptor declares.
    const NEEDED: Record<string, string> = {
      "presidential/region/winner": "municipality_votes.json",
      "presidential/municipality/winner": "settlement_votes.json",
    };
    for (const key of Object.keys(MAP_ADAPTERS).filter((k) =>
      k.startsWith("presidential/"),
    )) {
      const file = NEEDED[key];
      expect(
        file,
        `${key} is registered but this gate does not know which roll-up it fetches — add it to NEEDED`,
      ).toBeTruthy();
      expect(
        block,
        `${key} is registered while ${file} is NOT gzip-uploaded — that page ships the raw file`,
      ).toContain(file);
    }
    // Anti-vacuity: the block really is the list, not an empty slice.
    expect(block).toContain("region_votes.json");
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
