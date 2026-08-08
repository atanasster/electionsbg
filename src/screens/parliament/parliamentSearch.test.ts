// The parliament hub's search sources.
//
// Two subjects with two shapes (a client index of members, a server search over items) and
// one rule: the selected parliament RANKS, it never filters.

import { describe, it, expect, vi, afterEach } from "vitest";
import { parliamentSearchSources } from "./parliamentSearch";
import type { IndexSource, ServerSource } from "@/ux/search/hubSearchSources";
import { searchIndex } from "@/lib/entitySearchIndex";
import type { MpIndexEntry } from "@/data/parliament/useMps";

const mp = (id: number, name: string, folders: string[]): MpIndexEntry =>
  ({
    id,
    name,
    name_en: name,
    normalizedName: name.toUpperCase(),
    normalizedName_en: name.toUpperCase(),
    photoUrl: "",
    currentRegion: null,
    currentPartyGroup: null,
    currentPartyGroupShort: null,
    position: null,
    birthDate: null,
    nsFolders: folders,
    isCurrent: folders.includes("52"),
  }) as MpIndexEntry;

const MPS = [
  mp(1, "Иван Сегашен", ["52"]),
  mp(2, "Петър Бивш", ["47"]),
  mp(3, "Мария И Двете", ["47", "52"]),
];

const build = (ns: string | null) =>
  parliamentSearchSources({ mps: MPS, ns, bg: true });

afterEach(() => vi.unstubAllGlobals());

describe("the selected parliament ranks members, it does not filter them", () => {
  it("puts members of OTHER parliaments in a second, named group", () => {
    const [inMps, outMps] = build("52") as IndexSource[];
    expect(inMps.label.bg).toBe("Депутати · 52. НС");
    expect(outMps.label.bg).toBe("Депутати от други НС");
    // Петър sat only in the 47th; he must still be findable from the 52nd.
    const names = searchIndex(outMps.index, "Петър", 8).map((r) => r.label);
    expect(names).toContain("Петър Бивш");
  });

  it("a member of BOTH parliaments is in-scope, not duplicated", () => {
    const [inMps, outMps] = build("52") as IndexSource[];
    expect(searchIndex(inMps.index, "Мария", 8)).toHaveLength(1);
    expect(searchIndex(outMps.index, "Мария", 8)).toHaveLength(0);
  });

  it("renders ONE members group when no parliament is selected", () => {
    // Nothing is "outside" then, and a second empty heading would be noise.
    const ids = parliamentSearchSources({ mps: MPS, ns: null, bg: true }).map(
      (s) => s.id,
    );
    expect(ids).not.toContain("mps:out");
    expect(ids).toContain("mps");
  });

  it("omits the out group when every member sat in the selected parliament", () => {
    const ids = parliamentSearchSources({
      mps: [mp(1, "Иван", ["52"])],
      ns: "52",
      bg: true,
    }).map((s) => s.id);
    expect(ids).not.toContain("mps:out");
  });
});

describe("the roster's absence is not a loading state", () => {
  it("marks the index loading only while it is genuinely coming", () => {
    const pending = parliamentSearchSources({
      mps: undefined,
      ns: "52",
      bg: true,
    })[0] as IndexSource;
    expect(pending.index).toBeNull();
    expect(pending.loading).toBe(true);

    const ready = build("52")[0] as IndexSource;
    expect(ready.loading).toBe(false);
  });
});

describe("topics", () => {
  const fetchOk = (body: unknown) => {
    const fn = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      url,
      json: async () => body,
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  const topicSources = (ns: string | null) =>
    build(ns).filter((s) => s.id.startsWith("topics")) as ServerSource[];

  it("asks for the selected parliament, and for the OTHERS separately", async () => {
    const fn = fetchOk({ items: [] });
    const [inT, outT] = topicSources("52");
    await inT.fetch("бюджет", new AbortController().signal);
    await outT.fetch("бюджет", new AbortController().signal);
    const urls = fn.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("ns=52");
    expect(urls[0]).not.toContain("scope=out");
    expect(urls[1]).toContain("scope=out");
  });

  it("does not ask for 'other parliaments' when none is selected", async () => {
    // The route answers with nothing in that case; asking is a wasted request whose group
    // could only ever be empty.
    expect(topicSources(null).map((s) => s.id)).toEqual(["topics"]);
  });

  it("links a row to the sitting, using the ISO date the route returned", async () => {
    // No client-side Date is constructed, so there is no timezone to get wrong — the
    // off-by-one that shipped on 613 pages.
    fetchOk({
      items: [
        { itemId: 7, ns: 52, date: "2026-07-24", title: "Бюджет", topic: null },
      ],
    });
    const [inT] = topicSources("52");
    const rows = await inT.fetch("бюджет", new AbortController().signal);
    expect(rows[0].to).toBe("/votes/2026-07-24");
    expect(rows[0].secondary).toBe("52. НС · 2026-07-24");
  });

  it("has NO see-all — no page lists matching items across days", async () => {
    // A first draft linked to /votes?q=…; SessionsIndexScreen reads only ?topic, so the
    // query was silently discarded and the reader landed on every sitting.
    for (const s of topicSources("52")) expect(s.seeAll).toBeUndefined();
  });

  it("throws on a failed request rather than reporting an empty corpus", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: false,
        status: 500,
        url,
        json: async () => ({}),
      })),
    );
    const [inT] = topicSources("52");
    await expect(
      inT.fetch("бюджет", new AbortController().signal),
    ).rejects.toThrow(/vote-item-search/);
  });
});
