// Unit coverage for buildPersonGroups — the three ranked people tiers of the combined-search
// dropdown (S2). Pins the encoding split (P uses the route href, V/N re-encode the raw name), the
// name-match label for name_fold identities, the position-type label fallback, and the empty-tier
// guard (no stray header).

import { describe, it, expect } from "vitest";
import {
  buildPersonGroups,
  EMPTY_PEOPLE,
  type PersonHit,
  type PersonSearchResult,
} from "./personSearchGroups";

const hit = (over: Partial<PersonHit> = {}): PersonHit => ({
  key: "k1",
  name: "Иван Петров Иванов",
  tier: "P",
  position_type: "politician",
  primary_role: "mp",
  party: "p_97",
  place_label: "Ямбол",
  firms_count: 3,
  public_money_eur: 1000,
  identity_confidence: "resolved",
  href: "/person/ivan-petrov-ivanov-ab12",
  ...over,
});

const seeAll = { pathname: "/persons", search: "?q=x&sector=all" };
const result = (
  over: Partial<PersonSearchResult> = {},
): PersonSearchResult => ({
  ...EMPTY_PEOPLE,
  ...over,
});

describe("buildPersonGroups", () => {
  it("returns no groups (no stray headers) for empty tiers", () => {
    expect(buildPersonGroups(EMPTY_PEOPLE, true, seeAll)).toEqual([]);
  });

  it("P tier: uses the route href verbatim and shows position label · place", () => {
    const [g] = buildPersonGroups(result({ power: [hit()] }), true, seeAll);
    expect(g.key).toBe("power");
    expect(g.label).toBe("Хора във властта");
    expect(g.items[0].to).toBe("/person/ivan-petrov-ivanov-ab12");
    expect(g.items[0].secondary).toBe("Политик · Ямбол");
    // party (an internal canonicalId) is never shown
    expect(g.items[0].secondary).not.toContain("p_97");
    expect(g.items[0].amountEur).toBe(1000);
  });

  it("V/N tier: re-encodes the raw name and flags a name-match identity", () => {
    const owner = hit({
      key: "k2",
      tier: "V",
      name: "Огнян Иванов Донев",
      href: "/person/Огнян Иванов Донев",
      identity_confidence: "name_fold",
      firms_count: 7,
      public_money_eur: 5_000_000,
    });
    const [g] = buildPersonGroups(result({ money: [owner] }), true, seeAll);
    expect(g.key).toBe("money");
    expect(g.items[0].to).toBe(
      `/person/${encodeURIComponent("Огнян Иванов Донев")}`,
    );
    expect(g.items[0].to).not.toContain(" ");
    expect(g.items[0].secondary).toBe("7 фирми · съвпадение по име");
  });

  it("others tier carries the 'see all people' link", () => {
    const [g] = buildPersonGroups(
      result({
        others: [hit({ tier: "N", identity_confidence: "name_fold" })],
      }),
      true,
      seeAll,
    );
    expect(g.key).toBe("others");
    expect(g.seeAll?.to).toEqual(seeAll);
    expect(g.seeAll?.label).toBe("Виж всички хора");
  });

  it("falls back to the raw code for an unmapped position_type, and localises EN", () => {
    const [bgG] = buildPersonGroups(
      result({ power: [hit({ position_type: "wizard" })] }),
      true,
      seeAll,
    );
    expect(bgG.items[0].secondary).toBe("wizard · Ямбол");
    const [enG] = buildPersonGroups(
      result({
        power: [hit({ position_type: "magistrate", place_label: "Sofia" })],
      }),
      false,
      seeAll,
    );
    expect(enG.items[0].secondary).toBe("Magistrate · Sofia");
  });

  it("emits the three tiers in power → money → others order", () => {
    const gs = buildPersonGroups(
      result({
        power: [hit({ key: "a" })],
        money: [hit({ key: "b", tier: "V" })],
        others: [hit({ key: "c", tier: "N" })],
      }),
      true,
      seeAll,
    );
    expect(gs.map((g) => g.key)).toEqual(["power", "money", "others"]);
  });
});
