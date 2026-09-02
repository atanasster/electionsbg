// The shared /api/db/person-search adapter — request sharing, destinations, caveats, quota.
//
// Every assertion here pins something that was WRONG or MISSING before this module existed,
// and each of those was invisible from a green test suite:
//   - a V row with a real slug routed to the name-keyed page (69,367 of 84,557 rows);
//   - `shared_name` carried no identity caveat at all (4,376 rows);
//   - the broad facet was shown where a specific office existed;
//   - a single mutable `altQuery` slot answered one query with another's needle.
//
//   npm run test:unit -- src/screens/components/search/personSearchSource.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  __resetPersonSearchCache,
  balancedPrivate,
  companyPeopleItems,
  fetchCompanyPeople,
  fetchPublicPeople,
  firmsSubtitle,
  identityCaveat,
  personAltQuery,
  personHref,
  publicPeopleItems,
  roleSubtitle,
  sharedPersonSearch,
  type PersonHit,
  type PersonSearchResponse,
} from "./personSearchSource";

const hit = (over: Partial<PersonHit> = {}): PersonHit => ({
  key: "slug:ivan-petrov-ivanov-ab12",
  name: "Иван Петров Иванов",
  tier: "P",
  position_type: "politician",
  primary_role: "mp",
  place_label: "Ямбол",
  firms_count: 3,
  public_money_eur: 1000,
  identity_confidence: "resolved",
  href: "/person/ivan-petrov-ivanov-ab12",
  ...over,
});

const body = (
  over: Partial<PersonSearchResponse> = {},
): PersonSearchResponse => ({
  power: [],
  money: [],
  others: [],
  altQuery: null,
  ...over,
});

const ok = (b: PersonSearchResponse) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(b) } as Response);

describe("personHref", () => {
  it("uses the route href for a slug-keyed row, whatever the tier", () => {
    // ⚠️ The KEY NAMESPACE decides, never the tier. A tier test routes 69,367 verified V
    // people to /person/<raw name> — undoing load_person_search_pg's V-real arm, which
    // exists precisely so they keep their slug page.
    for (const tier of ["P", "V"] as const)
      expect(
        personHref(hit({ tier, key: "slug:x-1", href: "/person/x-1" })),
      ).toBe("/person/x-1");
  });

  it("encodes the raw name for a fold-keyed row", () => {
    expect(
      personHref(
        hit({
          tier: "N",
          key: "fold:ognyan ivanov donev",
          name: "Огнян Иванов Донев",
          href: "/person/Огнян Иванов Донев",
        }),
      ),
    ).toBe(`/person/${encodeURIComponent("Огнян Иванов Донев")}`);
  });

  it("encodes a name carrying a path separator, so it cannot escape its segment", () => {
    const h = hit({
      tier: "N",
      key: "fold:a b",
      name: "А / Б",
      href: "/person/А / Б",
    });
    expect(personHref(h)).not.toContain("/person/А /");
    expect(personHref(h)).toBe(`/person/${encodeURIComponent("А / Б")}`);
  });
});

describe("identityCaveat", () => {
  it("gives shared_name the STRONGER several-people warning", () => {
    const h = hit({ identity_confidence: "shared_name" });
    expect(identityCaveat(h, true)).toBe("няколко лица");
    expect(identityCaveat(h, false)).toBe("several people");
  });

  it("gives name_fold the weaker name-match warning", () => {
    const h = hit({ identity_confidence: "name_fold" });
    expect(identityCaveat(h, true)).toBe("съвпадение по име");
    expect(identityCaveat(h, false)).toBe("name match");
  });

  it("gives a verified or resolved identity none", () => {
    for (const c of ["verified", "resolved"])
      expect(identityCaveat(hit({ identity_confidence: c }), true)).toBeNull();
  });

  it("says NOTHING rather than something wrong when the field is absent", () => {
    // An older cloud deploy can omit the column. A caveat asserted from a missing field
    // would be a claim about a named person that no data supports.
    expect(
      identityCaveat(hit({ identity_confidence: undefined }), true),
    ).toBeNull();
  });

  it("appends the caveat to the firms count, not instead of it", () => {
    expect(
      firmsSubtitle(
        hit({ firms_count: 7, identity_confidence: "name_fold" }),
        true,
      ),
    ).toBe("7 фирми · съвпадение по име");
    // ⚠️ Singular at one. „1 фирми" is wrong Bulgarian and it is the commonest case in the
    // long tail — most private owners hold exactly one company.
    expect(
      firmsSubtitle(
        hit({ firms_count: 1, identity_confidence: "name_fold" }),
        true,
      ),
    ).toBe("1 фирма · съвпадение по име");
    expect(
      firmsSubtitle(
        hit({ firms_count: 1, identity_confidence: "verified" }),
        false,
      ),
    ).toBe("1 company");
  });
});

describe("roleSubtitle", () => {
  const roleLabel = (r: string | null | undefined) =>
    r === "mayor" ? "Кмет" : "";

  it("prefers the specific office over the broad facet", () => {
    expect(
      roleSubtitle(
        hit({ primary_role: "mayor", place_label: "Столична община" }),
        true,
        roleLabel,
      ),
    ).toBe("Кмет · Столична община");
  });

  it("falls back to the broad facet, never to a raw code", () => {
    expect(
      roleSubtitle(hit({ primary_role: "brand_new_code" }), true, roleLabel),
    ).toBe("Политик · Ямбол");
  });

  it("omits an absent place rather than rendering a dangling separator", () => {
    expect(roleSubtitle(hit({ place_label: null }), true, roleLabel)).toBe(
      "Политик",
    );
  });
});

describe("balancedPrivate", () => {
  const v = (n: number) =>
    Array.from({ length: n }, (_, i) => hit({ tier: "V", key: `v${i}` }));
  const o = (n: number) =>
    Array.from({ length: n }, (_, i) => hit({ tier: "N", key: `n${i}` }));

  it("takes one from each tier before a second from either", () => {
    // ⚠️ V outranks N by construction (rank_static stratifies P ≫ V ≫ N), so a naive
    // concatenation fills the whole cap with V and the 445,804-row N tier is unreachable.
    expect(balancedPrivate(v(5), o(5), 2).map((h) => h.tier)).toEqual([
      "V",
      "N",
    ]);
    expect(balancedPrivate(v(5), o(5), 4).map((h) => h.tier)).toEqual([
      "V",
      "N",
      "V",
      "N",
    ]);
  });

  it("lets one tier fill the cap when the other is empty", () => {
    expect(balancedPrivate(v(5), [], 2).map((h) => h.tier)).toEqual(["V", "V"]);
    expect(balancedPrivate([], o(5), 2).map((h) => h.tier)).toEqual(["N", "N"]);
  });

  it("never exceeds the cap, and is empty for an empty response", () => {
    expect(balancedPrivate(v(9), o(9), 3)).toHaveLength(3);
    expect(balancedPrivate([], [], 3)).toEqual([]);
  });
});

describe("item builders", () => {
  it("shows money for V and withholds it for N", () => {
    // N's public_money_eur is 0 by construction — that tier is "every other owner" — and a 0
    // beside a name reads as a measured zero rather than as "not in this basis".
    const items = companyPeopleItems(
      body({
        money: [hit({ tier: "V", key: "v", public_money_eur: 5_000_000 })],
        others: [hit({ tier: "N", key: "n", public_money_eur: 0 })],
      }),
      true,
      2,
    );
    expect(items[0].amountEur).toBe(5_000_000);
    expect(items[1].amountEur).toBeUndefined();
  });

  it("namespaces ids per tier so one person cannot emit two options with one id", () => {
    const items = companyPeopleItems(
      body({
        money: [hit({ tier: "V", key: "k" })],
        others: [hit({ tier: "N", key: "k" })],
      }),
      true,
      2,
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it("decodes HTML entities in the displayed name", () => {
    const [item] = publicPeopleItems(
      body({ power: [hit({ name: "Иван &amp; Ко" })] }),
      true,
    );
    expect(item.primary).toBe("Иван & Ко");
  });
});

describe("the shared request", () => {
  beforeEach(() => {
    __resetPersonSearchCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetPersonSearchCache();
  });

  const signal = new AbortController().signal;

  it("issues ONE fetch when both people sources ask for the same needle", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        ok(body({ power: [hit()], money: [hit({ tier: "V" })] })),
      );
    const [pub, priv] = await Promise.all([
      fetchPublicPeople("терзиев", signal, true),
      fetchCompanyPeople("терзиев", signal, true, 2),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(pub).toHaveLength(1);
    expect(priv).toHaveLength(1);
  });

  it("keys on decl too, so the two declarations groups are not one request", async () => {
    // The hub asks for decl=1 and decl=0 as two calls BECAUSE scope ranks and never filters.
    // A query-only key would answer the „has filed" group with the „has not" group's rows.
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => ok(body()));
    await Promise.all([
      sharedPersonSearch("иван", signal, "1"),
      sharedPersonSearch("иван", signal, "0"),
    ]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("re-issues for a new needle rather than answering with the old rows", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => ok(body()));
    await sharedPersonSearch("иван", signal);
    await sharedPersonSearch("петър", signal);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("evicts a REJECTED entry so a re-typed needle is retried, not poisoned", async () => {
    // HubSearch aborts on every keystroke, so backspacing to a just-aborted needle must not
    // return the rejected promise for ever — both groups would vanish AND their names would
    // vanish from „Няма съвпадения в: …", reporting our outage as an absence.
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("aborted"))
        : ok(body({ power: [hit()] }));
    });
    await expect(sharedPersonSearch("иван", signal)).rejects.toThrow();
    await expect(sharedPersonSearch("иван", signal)).resolves.toBeTruthy();
    expect(calls).toBe(2);
  });

  it("throws on a non-ok response instead of degrading to an empty corpus", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    await expect(fetchPublicPeople("иван", signal, true)).rejects.toThrow(
      /person-search: 500/,
    );
  });

  it("carries altQuery for the query it answered, and never for another", async () => {
    // `seeAll` is a SYNCHRONOUS render-time callback and cannot await the promise, so the
    // needle has to be readable by key. A single mutable slot answered one query with
    // another's rewrite the moment two sources shared one promise.
    vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
      ok(
        body({
          altQuery: String(url).includes("6umen") ? "шумен" : null,
        }),
      ),
    );
    await sharedPersonSearch("6umen", signal);
    expect(personAltQuery("6umen")).toBe("шумен");
    // A needle we never asked about falls back to itself rather than borrowing the rewrite.
    expect(personAltQuery("желязков")).toBe("желязков");
    await sharedPersonSearch("желязков", signal);
    expect(personAltQuery("желязков")).toBe("желязков");
  });
});
