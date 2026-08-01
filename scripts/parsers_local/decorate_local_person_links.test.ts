// Unit test for the personSlug bake's pure stamping core (stampBundle / applySlug), over an
// injected ref→slug map and hand-built bundles. No DB, no fs.

import { describe, it, expect } from "vitest";
import { stampBundle, applySlug } from "./decorate_local_person_links";
import type { LocalMunicipalityBundle } from "./types";

const noStats = () => ({ stamped: 0, cleared: 0, considered: 0 });

// Minimal bundle satisfying the fields stampBundle reads.
const bundle = (
  over: Partial<LocalMunicipalityBundle>,
): LocalMunicipalityBundle =>
  ({
    cycle: "2023_10_29_mi",
    obshtinaCode: "BGS01",
    council: [],
    kmetstva: [],
    districts: [],
    ...over,
  }) as unknown as LocalMunicipalityBundle;

const mayor = (
  candidateName: string,
  localPartyNum: number,
  isElected = false,
  votes = 0,
): Record<string, unknown> => ({
  candidateName,
  localPartyNum,
  isElected,
  votes,
  personSlug: undefined,
});

describe("applySlug", () => {
  it("sets, then is idempotent, then clears a stale slug", () => {
    const row: { personSlug?: string } = {};
    expect(applySlug(row, "ivan-1", noStats())).toBe(true);
    expect(row.personSlug).toBe("ivan-1");
    expect(applySlug(row, "ivan-1", noStats())).toBe(false); // unchanged
    expect(applySlug(row, undefined, noStats())).toBe(true); // cleared
    expect(row.personSlug).toBeUndefined();
  });
});

describe("stampBundle mayor", () => {
  it("stamps the winner + matching round rows, NOT a same-named loser of another party", () => {
    const elected = mayor("Иван Петров", 5, true, 60);
    const loser = mayor("Иван Петров", 9, false, 40); // same name, different party
    const b = bundle({
      mayor: {
        round1: [elected, loser],
        elected,
      } as unknown as LocalMunicipalityBundle["mayor"],
    });
    const changed = stampBundle(
      b,
      new Map([["2023_10_29_mi:BGS01:mayor", "ivan-petrov-ab12cd"]]),
      noStats(),
    );
    expect(changed).toBe(true);
    expect((elected as { personSlug?: string }).personSlug).toBe(
      "ivan-petrov-ab12cd",
    );
    // The same-named loser of a DIFFERENT party must not inherit the winner's link.
    expect((loser as { personSlug?: string }).personSlug).toBeUndefined();
  });
});

describe("stampBundle village mayors", () => {
  it("stamps the runoff winner (higher-vote finalist), not the loser", () => {
    const a = mayor("A", 1, true, 45);
    const b_ = mayor("B", 2, true, 55); // winner
    const b = bundle({
      kmetstva: [
        { kmetstvoName: "Село", ekatte: "", candidates: [a, b_] },
      ] as unknown as LocalMunicipalityBundle["kmetstva"],
    });
    stampBundle(
      b,
      new Map([["2023_10_29_mi:BGS01:kmetstvo:0", "b-vil-99"]]),
      noStats(),
    );
    expect((b_ as { personSlug?: string }).personSlug).toBe("b-vil-99");
    expect((a as { personSlug?: string }).personSlug).toBeUndefined();
  });

  it("stamps a DISTINCT `elected` object (severed from candidates by JSON round-trip)", () => {
    // build_chmi_history reads k.elected.personSlug off the persisted (re-parsed) bundle, where
    // `elected` is no longer the same object as its candidates row — so the bake must stamp it too.
    const winnerCand = mayor("B", 2, true, 55);
    const electedCopy = mayor("B", 2, true, 55); // separate object, same contestant
    const b = bundle({
      kmetstva: [
        {
          kmetstvoName: "Село",
          ekatte: "",
          candidates: [mayor("A", 1, true, 45), winnerCand],
          elected: electedCopy,
        },
      ] as unknown as LocalMunicipalityBundle["kmetstva"],
    });
    stampBundle(
      b,
      new Map([["2023_10_29_mi:BGS01:kmetstvo:0", "b-vil-99"]]),
      noStats(),
    );
    expect((electedCopy as { personSlug?: string }).personSlug).toBe(
      "b-vil-99",
    );
  });
});

describe("stampBundle Sofia guards", () => {
  it("does not stamp a Sofia район council replica (S2*** shard)", () => {
    const c = {
      name: "Съветник",
      localPartyNum: 1,
      isElected: true,
      listPos: 1,
    };
    const b = bundle({
      obshtinaCode: "S2519",
      council: [
        { localPartyNum: 1, candidates: [c] },
      ] as unknown as LocalMunicipalityBundle["council"],
    });
    // Even if a stray ref were in the map, the S2*** council must be skipped.
    stampBundle(
      b,
      new Map([["2023_10_29_mi:S2519:1:1", "should-not-apply"]]),
      noStats(),
    );
    expect((c as { personSlug?: string }).personSlug).toBeUndefined();
  });

  it("skips the SOF parent bundle's districts[]", () => {
    const w = mayor("Районен", 3, true, 100);
    const b = bundle({
      obshtinaCode: "SOF",
      districts: [
        { districtCode: "S23", candidates: [w] },
      ] as unknown as LocalMunicipalityBundle["districts"],
    });
    stampBundle(
      b,
      new Map([["2023_10_29_mi:SOF:district:0", "rayon-x"]]),
      noStats(),
    );
    expect((w as { personSlug?: string }).personSlug).toBeUndefined();
  });
});
