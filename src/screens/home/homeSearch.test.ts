// The home finder's five groups: what they promise, where they send a reader, and the two
// properties that make the box affordable on the site's entry page — one shared procurement
// request, and nothing loaded before intent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchIndexType } from "@/data/search/useSearchItems";
import {
  __resetProcurementSearchCache,
  sharedProcurementSearch,
} from "@/screens/components/search/procurementSearchSource";
import { homePlaceIndex, homeSearchSources } from "./homeSearch";

/** No diaspora lookup available — every row is kept, which is the fallback's own rule. */
const noOblast = () => undefined;

const place = (over: Partial<SearchIndexType> = {}): SearchIndexType =>
  ({
    type: "s",
    key: "67338",
    name: "Сливен",
    name_en: "Sliven",
    parentName: "общ. Сливен",
    ...over,
  }) as SearchIndexType;

beforeEach(() => {
  __resetProcurementSearchCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("home finder — groups", () => {
  const sources = () => homeSearchSources(true, null, noOblast, false);

  it("offers the five groups the plan names, in order", () => {
    expect(sources().map((s) => s.id)).toEqual([
      "places",
      "people",
      "awarders",
      "companies",
      "products",
    ]);
  });

  it("labels every group in both languages", () => {
    for (const s of homeSearchSources(true, null, noOblast, false)) {
      expect(s.label.bg, s.id).toBeTruthy();
      expect(s.label.en, s.id).toBeTruthy();
      expect(s.label.bg, s.id).not.toBe(s.label.en);
    }
  });

  it("only the places group is an index; the rest are server-backed", () => {
    // The distinction is the cost model: the index is built from a catalog fetched once,
    // the others are a request per debounced keystroke.
    const byKind = Object.fromEntries(sources().map((s) => [s.id, s.kind]));
    expect(byKind).toEqual({
      places: "index",
      people: "server",
      awarders: "server",
      companies: "server",
      products: "server",
    });
  });

  it("caps each group so no one subject can fill the dropdown", () => {
    const total = sources().reduce((n, s) => n + (s.limit ?? 0), 0);
    for (const s of sources()) expect(s.limit, s.id).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(20);
  });

  it("every see-all destination reads the parameter it is handed", () => {
    // A link advertising a filtered destination that delivers an unfiltered one is worse
    // than no link. Only three groups have a browse page that reads `?q`; awarders
    // deliberately has none.
    const withSeeAll = sources().filter((s) => s.seeAll);
    expect(withSeeAll.map((s) => s.id)).toEqual([
      "people",
      "companies",
      "products",
    ]);
    for (const s of withSeeAll) {
      // `seeAll` may return undefined by contract (a source can decline for a given
      // query), so the link is asserted to EXIST before it is asserted to be right —
      // otherwise a source that quietly stopped offering one would pass.
      const link = s.seeAll!("Сливен");
      expect(link, s.id).toBeTruthy();
      expect(link!.to, s.id).toContain("q=");
      expect(link!.to, s.id).toMatch(/^\//);
    }
  });

  it("the companies see-all forces the all-time scope", () => {
    // The contractors table defaults to the selected parliament's window, so a company
    // whose contracts predate it would land on zero rows — a search that found something
    // and then showed nothing.
    const link = sources().find((s) => s.id === "companies")!.seeAll!("Х");
    expect(link).toBeTruthy();
    expect(link!.to).toContain("pscope=all");
  });
});

describe("home finder — the place index", () => {
  it("is null until the catalog arrives, so the box shows loading rather than empty", () => {
    // „Not built yet" and „nothing to build from" are different answers and only the first
    // is a state. `HubSearch` reads null as the former.
    expect(homePlaceIndex(null)).toBeNull();
    const unarmed = homeSearchSources(true, null, noOblast, false);
    const armed = homeSearchSources(true, null, noOblast, true);
    // Unarmed: nothing is loading, because nobody has asked for anything.
    expect((unarmed[0] as { loading?: boolean }).loading).toBe(false);
    // Armed with no catalog yet: genuinely loading.
    expect((armed[0] as { loading?: boolean }).loading).toBe(true);
  });

  it("sends a place to its governance dashboard, not to an election result", () => {
    // ⚠️ The destination decision. `/sections/<ekatte>` would answer „what is happening in
    // Сливен" with one election's polling-section table — the narrow reading the root
    // cutover exists to end. The My-Area autocomplete and the header crosshair, which use
    // this same catalog, both navigate to `/governance/<id>`.
    const index = homePlaceIndex([place()])!;
    expect(index.rows[0].href).toBe("/governance/67338");
  });

  it("honours an explicit path where the row carries one", () => {
    // The synthetic София rows do; deriving over them would mint a route that does not exist.
    const index = homePlaceIndex([place({ path: "/governance/SOF" })])!;
    expect(index.rows[0].href).toBe("/governance/SOF");
  });

  it("keeps the parent so namesakes are distinguishable", () => {
    // Fourteen Bulgarian settlements share a name; the parent is the only thing in the row
    // that tells them apart.
    expect(homePlaceIndex([place()])!.rows[0].sub).toBe("общ. Сливен");
  });

  it("indexes both spellings, so a Latin keyboard finds a Cyrillic place", () => {
    const index = homePlaceIndex([place()])!;
    expect(index.folds.some((f) => f.includes("sliven"))).toBe(true);
  });

  it("drops the diaspora bucket — 88 countries are not Bulgarian settlements", () => {
    // ⚠️ Unfiltered, „Германия" returns one confident result whose destination is
    // `/governance/DE`, which the area resolver renders as a real place dashboard for a
    // country. The other two consumers of this catalog both carry the filter.
    const index = homePlaceIndex(
      [place({ key: "67338" }), place({ key: "DE", name: "Германия" })],
      (k) => (k === "DE" ? "32" : "20"),
    )!;
    expect(index.rows.map((r) => r.label)).toEqual(["Сливен"]);
  });

  it("keeps every row when the lookup cannot answer", () => {
    // A filter that silently drops real places because its lookup is missing is worse than
    // the thing it guards against.
    const index = homePlaceIndex([
      place(),
      place({ key: "DE", name: "Германия" }),
    ])!;
    expect(index.rows).toHaveLength(2);
  });

  it("ranks coarser grains first, so a município is not buried by its settlements", () => {
    // Measured before the rank landed: 11 of 294 municípios were unreachable by typing
    // their own exact name, because `buildEntityIndex` returns the first `limit` matches in
    // INPUT order and the settlements outnumber them ~17:1.
    const index = homePlaceIndex([
      place({ type: "s", key: "1", name: "Бяла черква" }),
      place({ type: "s", key: "2", name: "Бяла река" }),
      place({ type: "m", key: "BYA", name: "Бяла" }),
    ])!;
    expect(index.rows[0].label).toBe("Бяла");
  });

  it("gives rows a type-qualified id, so two grains cannot collide", () => {
    // A settlement and a município can share a key; an unqualified id would make React
    // reuse the wrong row.
    const index = homePlaceIndex([
      place({ type: "s", key: "1" }),
      place({ type: "m", key: "1", name: "Друго" }),
    ])!;
    expect(new Set(index.rows.map((r) => r.id)).size).toBe(2);
  });
});

describe("home finder — one procurement request for two groups", () => {
  it("issues ONE fetch when both groups ask for the same needle", async () => {
    // ⚠️ THE REASON THE REQUEST IS SHARED AT ALL. `/api/db/procurement-search` answers
    // institutions AND companies from a single call, so two independent sources would issue
    // it twice per keystroke for the same needle.
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ awarders: [], companies: [] }),
    }));
    vi.stubGlobal("fetch", f);
    const ctrl = new AbortController();
    const [a, b] = homeSearchSources(true, null, noOblast, true).filter(
      (s) => s.id === "awarders" || s.id === "companies",
    ) as { fetch: (q: string, s: AbortSignal) => Promise<unknown> }[];
    await Promise.all([
      a.fetch("апи", ctrl.signal),
      b.fetch("апи", ctrl.signal),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("does NOT answer one needle with another's rows", async () => {
    // The cache is keyed by query and replaced as soon as the needle changes; a plain
    // memo would serve the previous query's rows under the new one.
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ awarders: [], companies: [] }),
    }));
    vi.stubGlobal("fetch", f);
    const ctrl = new AbortController();
    await sharedProcurementSearch("апи", ctrl.signal);
    await sharedProcurementSearch("нои", ctrl.signal);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("RE-ISSUES after a failure instead of poisoning the needle for ever", async () => {
    // ⚠️ THE ONE THE MODULE-LEVEL CACHE MADE WORSE. A rejection — a 500, or the abort
    // `HubSearch` fires on EVERY keystroke — used to stay cached under its query, so
    // backspacing to a just-aborted needle returned the rejected promise and never
    // re-fetched. Both groups then vanished AND their names vanished from „Няма съвпадения
    // в: …", which reports an outage as an absence.
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, status: 500 }
          : { ok: true, json: async () => ({ awarders: [], companies: [] }) };
      }),
    );
    const ctrl = new AbortController();
    await expect(sharedProcurementSearch("апи", ctrl.signal)).rejects.toThrow();
    // The SAME needle again: it must reach the network a second time.
    await expect(
      sharedProcurementSearch("апи", ctrl.signal),
    ).resolves.toBeTruthy();
    expect(calls).toBe(2);
  });

  it("throws on a failed response rather than reporting an outage as an absence", async () => {
    // HubSearch tells a failed group from an empty one and drops it from its „searched
    // in: …" line. Swallowing would tell the reader we looked and found nothing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    await expect(
      sharedProcurementSearch("x", new AbortController().signal),
    ).rejects.toThrow(/procurement-search/);
  });
});

describe("home finder — products", () => {
  it("reads the route's BARE ARRAY response", async () => {
    // ⚠️ `/api/db/price-search` returns rows directly, not `{ products: [...] }`. Reading a
    // envelope that does not exist would leave this group permanently, silently empty.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            slug: "kiselo-mlyako",
            title: "Кисело мляко",
            brand: "Верея",
            net_qty: 400,
            net_unit: "g",
          },
        ],
      })),
    );
    const products = homeSearchSources(true, null, noOblast, true).find(
      (s) => s.id === "products",
    ) as { fetch: (q: string, s: AbortSignal) => Promise<{ to: string }[]> };
    const rows = await products.fetch("мляко", new AbortController().signal);
    expect(rows).toHaveLength(1);
    expect(rows[0].to).toBe("/product/kiselo-mlyako");
  });

  it("survives a non-array body instead of throwing into the box", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const products = homeSearchSources(true, null, noOblast, true).find(
      (s) => s.id === "products",
    ) as { fetch: (q: string, s: AbortSignal) => Promise<unknown[]> };
    await expect(
      products.fetch("x", new AbortController().signal),
    ).resolves.toEqual([]);
  });
});
