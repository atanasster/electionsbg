// The declarations hub's search sources.
//
// What matters here is not that a fetch happens but WHAT IT ASKS FOR: two ranked calls,
// filers and non-filers, so the hub can show one above the other. A single call the client
// splits would empty the narrower group.

import { describe, it, expect, vi, afterEach } from "vitest";
import { declarationsSearchSources } from "./declarationsSearch";
import type { ServerSource } from "@/ux/search/hubSearchSources";

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
