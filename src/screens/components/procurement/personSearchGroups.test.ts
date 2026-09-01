// Unit coverage for buildPersonGroups — the three ranked people tiers of the combined-search
// dropdown (S2). Pins the routing split, the identity caveats, the position-type label
// fallback, and the empty-tier guard (no stray header).
//
// ⚠️ THE ROUTING SPLIT IS ON THE KEY NAMESPACE, NOT THE TIER, and this file's fixtures used
// to encode the older (wrong) rule: a `key` of "k1"/"k2" is not a shape the route can return,
// and under a tier test it happened to give the right answer for P. It is `slug:` → use the
// href, `fold:` → encode the name; a V row with a real slug — 69,367 of 84,557 of them — must
// keep its slug page. See personSearchSource.ts.

import { describe, it, expect } from "vitest";
import {
  buildPersonGroups,
  EMPTY_PEOPLE,
  type PersonHit,
  type PersonSearchResult,
} from "./personSearchGroups";

const hit = (over: Partial<PersonHit> = {}): PersonHit => ({
  key: "slug:ivan-petrov-ivanov-ab12",
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

  it("P tier: prefers the SPECIFIC office over the broad facet when a labeler is given", () => {
    // „Политик · Столична община" is true of Sofia's mayor and of 46,158 other people; the
    // subtitle exists to tell namesakes apart, so the specific office wins where it has a label.
    const roleLabel = (r: string | null | undefined) =>
      r === "mayor" ? "Кмет" : "";
    const [g] = buildPersonGroups(
      result({
        power: [hit({ primary_role: "mayor", place_label: "Столична община" })],
      }),
      true,
      seeAll,
      roleLabel,
    );
    expect(g.items[0].secondary).toBe("Кмет · Столична община");
  });

  it("P tier: falls back to the broad facet for a role code with no label yet", () => {
    // The resolver mints role codes from source data, so a new one appears in the corpus
    // before anyone writes its `pp_role_*` key. A raw code is worse than the broad facet.
    const [g] = buildPersonGroups(
      result({ power: [hit({ primary_role: "eu_funds_controller" })] }),
      true,
      seeAll,
      () => "",
    );
    expect(g.items[0].secondary).toBe("Политик · Ямбол");
  });

  it("a V row with a REAL SLUG keeps its slug page — the tier is not the routing key", () => {
    // 69,367 of 84,557 V rows are `slug:`-keyed verified people with a real /person/<slug>.
    // Routing them by tier sent every one to the name-keyed page instead, undoing exactly
    // what load_person_search_pg's V-real arm exists to do.
    const verified = hit({
      key: "slug:ognyan-ivanov-donev-7fe1",
      tier: "V",
      name: "Огнян Иванов Донев",
      href: "/person/ognyan-ivanov-donev-7fe1",
      identity_confidence: "verified",
      firms_count: 7,
      public_money_eur: 5_000_000,
    });
    const [g] = buildPersonGroups(result({ money: [verified] }), true, seeAll);
    expect(g.items[0].to).toBe("/person/ognyan-ivanov-donev-7fe1");
    // …and a verified identity carries NO caveat: it is a resolved person, not a name match.
    expect(g.items[0].secondary).toBe("7 фирми");
  });

  it("a shared_name row carries the STRONGER several-people caveat", () => {
    // 4,376 rows, and they had no caveat at all until 2026-09-02 — the one confidence that
    // most needs one, since the registry positively says the fold is several humans.
    const shared = hit({
      key: "slug:ivan-ivanov-ivanov-0001",
      tier: "V",
      identity_confidence: "shared_name",
      firms_count: 2,
    });
    const [g] = buildPersonGroups(result({ money: [shared] }), true, seeAll);
    expect(g.items[0].secondary).toBe("2 фирми · няколко лица");
    const [en] = buildPersonGroups(result({ money: [shared] }), false, seeAll);
    expect(en.items[0].secondary).toBe("2 companies · several people");
  });

  it("V/N tier: re-encodes the raw name and flags a name-match identity", () => {
    const owner = hit({
      key: "fold:ognyan ivanov donev",
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
        power: [hit({ key: "slug:a" })],
        money: [hit({ key: "slug:b", tier: "V" })],
        others: [hit({ key: "fold:c", tier: "N" })],
      }),
      true,
      seeAll,
    );
    expect(gs.map((g) => g.key)).toEqual(["power", "money", "others"]);
  });
});
