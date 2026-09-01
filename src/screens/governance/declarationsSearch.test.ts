// The declarations hub's search sources.
//
// What matters here is not that a fetch happens but WHAT IT ASKS FOR: two ranked calls,
// filers and non-filers, so the hub can show one above the other. A single call the client
// splits would empty the narrower group.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { FileText, Users } from "lucide-react";
import { __resetPersonSearchCache } from "@/screens/components/search/personSearchSource";
import { declarationsSearchSources } from "./declarationsSearch";
import type { ServerSource } from "@/ux/search/hubSearchSources";

// The person adapter holds ONE in-flight promise keyed by (query, decl), so a resolved
// entry from an earlier case would answer a later one — and a case that mocks a FAILURE
// would never reach its mock. Reset per test, as homeSearch.test.ts does for the
// procurement cache.
beforeEach(() => {
  __resetPersonSearchCache();
});

const okBody = {
  power: [
    {
      key: "slug:a",
      name: "Иван Иванов",
      position_type: "executive",
      place_label: "Бургас",
      href: "/person/a",
      has_declaration: true,
    },
  ],
};

// The url parameter is DECLARED even though the body ignores it: `vi.fn(async () => …)`
// types its call record as a zero-length tuple, so `fn.mock.calls[0][0]` — the assertion
// that the right URL was requested, which is the whole point of the first test — does not
// typecheck.
const mockFetch = (body: unknown = okBody, ok = true) => {
  const fn = vi.fn(async (url: string) => ({
    ok,
    status: ok ? 200 : 500,
    url,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

// `as ServerSource[]` rather than the union: every source on this hub is server-backed
// (62,050 public figures is not a client index), and the tests destructure by position.
const sources = (): ServerSource[] =>
  declarationsSearchSources(true) as ServerSource[];

describe("the two people groups are two RANKED CALLS", () => {
  it("asks for decl=1 and decl=0 separately", async () => {
    const fn = mockFetch();
    const [filed, notFiled] = sources();
    await filed.fetch("иван", new AbortController().signal);
    await notFiled.fetch("иван", new AbortController().signal);
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("decl=1");
    expect(urls[1]).toContain("decl=0");
  });

  it("names the second group for what it is outside, not 'другите'", () => {
    const [, notFiled] = sources();
    expect(notFiled.label.bg).toBe("Без декларация в регистъра");
    expect(notFiled.label.bg).not.toMatch(/^Други/);
  });

  it("gives the see-all only to the filers group", () => {
    // On the other it would mean "see all people with no declaration", which is not a page.
    const [filed, notFiled] = sources();
    expect(filed.seeAll).toBeTypeOf("function");
    expect(notFiled.seeAll).toBeUndefined();
  });

  it("the filers' see-all carries ?decl=1 so the destination shows the same set", () => {
    const [filed] = sources();
    const to = filed.seeAll?.("иван")?.to ?? "";
    expect(to).toContain("/persons?q=");
    expect(to).toContain("decl=1");
  });

  it("the see-all does NOT widen the destination with sector=all", () => {
    // That maps to tier P∪V on /persons, re-admitting the private Commerce-Registry owners
    // this module excludes — so the link would land on a broader set than the group offering
    // it.
    expect(sources()[0].seeAll?.("иван")?.to ?? "").not.toContain("sector=all");
  });

  it("there are exactly TWO groups — no officials group", () => {
    // A third group existed and could not be made honest: its content (anyone who filed),
    // its label and its destination (/officials/assets, is_exec-filtered) were three
    // different sets, and it re-issued the filers' query verbatim.
    const ids = declarationsSearchSources(true).map((s) => s.id);
    expect(ids).toEqual(["people", "people:out"]);
  });
});

describe("the see-all reaches a page that can serve it", () => {
  it("uses the shliokavitsa-rewritten needle when the route rewrote one", async () => {
    // „Jelqzkov" previews Желязков here; /persons runs its own search WITHOUT the rewrite,
    // so a link built from what was typed returns nothing after advertising six rows.
    mockFetch({ ...okBody, altQuery: "zhelyazkov" });
    const [filed] = sources();
    await filed.fetch("Jelqzkov", new AbortController().signal);
    expect(filed.seeAll?.("Jelqzkov")?.to ?? "").toContain("q=zhelyazkov");
  });

  it("uses the typed query when no rewrite fired", async () => {
    mockFetch({ ...okBody, altQuery: null });
    const [filed] = sources();
    await filed.fetch("иван", new AbortController().signal);
    expect(decodeURIComponent(filed.seeAll?.("иван")?.to ?? "")).toContain(
      "q=иван",
    );
  });

  it("does not apply one query's rewrite to a different query", async () => {
    mockFetch({ ...okBody, altQuery: "zhelyazkov" });
    const [filed] = sources();
    await filed.fetch("Jelqzkov", new AbortController().signal);
    expect(decodeURIComponent(filed.seeAll?.("петров")?.to ?? "")).toContain(
      "q=петров",
    );
  });
});

describe("rows never show a raw code", () => {
  it("maps position_type through the shared label table", async () => {
    // The first draft rendered p.primary_role straight, which put „state_enterprise" and
    // „security_service" in front of a Bulgarian reader.
    mockFetch();
    const [filed] = sources();
    const rows = await filed.fetch("иван", new AbortController().signal);
    expect(rows[0].secondary).toBe("Изпълнителна власт · Бургас");
  });

  it("omits the secondary line entirely when there is neither role nor place", async () => {
    mockFetch({
      power: [
        {
          key: "k",
          name: "Н",
          position_type: null,
          place_label: null,
          href: "/person/k",
          has_declaration: false,
        },
      ],
    });
    const [filed] = sources();
    const rows = await filed.fetch("н", new AbortController().signal);
    expect(rows[0].secondary).toBeUndefined();
  });
});

describe("only the P tier is used", () => {
  it("ignores the money and other-owner tiers", async () => {
    // V and N are name-fold private company owners from the Commerce Registry. They are not
    // in the declarations register at all, so listing them on this page would imply they are.
    mockFetch({
      power: okBody.power,
      money: [
        { key: "m", name: "M", href: "/person/M", has_declaration: false },
      ],
      others: [
        { key: "o", name: "O", href: "/person/O", has_declaration: false },
      ],
    });
    const [filed] = sources();
    const rows = await filed.fetch("иван", new AbortController().signal);
    expect(rows).toHaveLength(1);
    expect(rows[0].primary).toBe("Иван Иванов");
  });
});

describe("a failed request throws rather than reporting an empty register", () => {
  it("rejects on a non-ok response", async () => {
    // HubSearch omits a FAILED group from its "searched in: …" sentence. Returning [] here
    // would make it say „Няма съвпадения в: хора с декларация" — our outage, stated as a
    // fact about the register.
    mockFetch({}, false);
    const [filed] = sources();
    await expect(
      filed.fetch("иван", new AbortController().signal),
    ).rejects.toThrow(/person-search/);
  });
});

describe("language", () => {
  it("labels the see-all in the reader's language", () => {
    // Sentence case, matching personSearchGroups' labels — the same shell renders both, so
    // two cases in one dropdown would read as two different kinds of link.
    expect(
      (declarationsSearchSources(true)[0] as ServerSource).seeAll?.("x")?.label,
    ).toBe("Виж всички с декларация");
    expect(
      (declarationsSearchSources(false)[0] as ServerSource).seeAll?.("x")
        ?.label,
    ).toBe("See all who filed");
  });
});

// ── What the shared adapter changed, and what it must NOT change ───────────────────────
//
// The migration to `personSearchSource` moved the row builder out of this file. Two fields it
// renders were silently altered by the first cut and are pinned here so a future consolidation
// cannot alter them again without saying so.

describe("the row's basis and its icon", () => {
  it("shows NO money figure beside a person on a declared-wealth hub", async () => {
    // `public_money_eur` on a public row is money that reached companies LINKED TO the person
    // — 1,232 rows carry one, up to €992M. Rendering it under a heading about DECLARED wealth
    // states a figure on a basis the heading does not carry, and this hub never did.
    mockFetch({
      power: [
        {
          key: "slug:a",
          name: "Иван Иванов",
          position_type: "executive",
          place_label: "София",
          href: "/person/a",
          has_declaration: true,
          public_money_eur: 992_000_000,
        },
      ],
    });
    const [filed] = sources();
    const rows = await filed.fetch("иван", new AbortController().signal);
    expect(rows[0].amountEur).toBeUndefined();
  });

  it("splits the icon on a FILING, not on the tier", async () => {
    for (const has of [true, false]) {
      __resetPersonSearchCache();
      mockFetch({
        power: [
          {
            key: "slug:a",
            name: "Иван Иванов",
            position_type: "executive",
            place_label: "София",
            href: "/person/a",
            has_declaration: has,
          },
        ],
      });
      const [filed] = sources();
      const rows = await filed.fetch("иван", new AbortController().signal);
      expect(rows[0].icon).toBe(has ? FileText : Users);
    }
  });
});

// ⚠️ THE HUB FIRES BOTH SOURCES IN ONE PASS, AND THAT IS WHAT THE SEQUENTIAL TESTS ABOVE
// CANNOT SEE. `HubSearch` maps every server source's `fetch` in a single tick on one
// AbortController, so `decl=1` and `decl=0` are in flight together — which is precisely the
// shape under which the first cut of the shared adapter stopped recording the shliokavitsa
// rewrite for `decl=1`, shipping „Виж всички с декларация" → /persons?q=<what was typed>,
// a page that returns zero rows after the dropdown advertised six.
describe("both sources in flight at once — the hub's real call shape", () => {
  it("keeps the rewritten needle on the declared group's see-all", async () => {
    __resetPersonSearchCache();
    mockFetch({ power: [], altQuery: "желязков" });
    const srcs = sources();
    const ctl = new AbortController();
    // One pass, one controller, in source order — exactly HubSearch's effect.
    await Promise.all(
      srcs.map((s) => (s as ServerSource).fetch("jelqzkov", ctl.signal)),
    );
    const href = (srcs[0] as ServerSource).seeAll?.("jelqzkov")?.to ?? "";
    expect(href).toContain(encodeURIComponent("желязков"));
    expect(href).not.toContain("jelqzkov");
  });

  it("issues one request PER decl — the two groups are not one request", async () => {
    __resetPersonSearchCache();
    const f = mockFetch({ power: [] });
    const ctl = new AbortController();
    await Promise.all(
      sources().map((s) => (s as ServerSource).fetch("иван", ctl.signal)),
    );
    // Scope RANKS and never filters: one request would answer "has filed" with "has not".
    expect(f.mock.calls.length).toBe(2);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("decl=1"))).toBe(true);
    expect(urls.some((u) => u.includes("decl=0"))).toBe(true);
  });
});
