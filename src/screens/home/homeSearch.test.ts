// The home finder's TEN groups: what they promise, where they send a reader, and the three
// properties that make the box affordable on the site's entry page — one shared person
// request, one shared procurement request, and nothing loaded before intent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchIndexType } from "@/data/search/useSearchItems";
import {
  __resetProcurementSearchCache,
  sharedProcurementSearch,
} from "@/screens/components/search/procurementSearchSource";
import { __resetPersonSearchCache } from "@/screens/components/search/personSearchSource";
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
  __resetPersonSearchCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("home finder — groups", () => {
  const sources = () => homeSearchSources(true, null, noOblast, false);

  it("offers the ten groups the plan names, in order", () => {
    // ⚠️ THE ORDER IS READER INTENT, NOT CORPUS TAXONOMY, and the two ends are the point.
    // PRODUCTS IS THIRD: a taxonomy order puts it behind eight money groups — measured on
    // „Варна", 531 px into a 382 px-tall scroll box, i.e. below the fold — and „кисело
    // мляко" is a first-class home query whose rows are exact.
    // COMPANY-PEOPLE IS EIGHTH: it is the box's weakest tier, name-fold identities carrying
    // a „съвпадение по име" caveat on most rows, so it sits below the corpora whose rows are
    // keyed and checkable.
    expect(sources().map((s) => s.id)).toEqual([
      "places",
      "public-people",
      "products",
      "awarders",
      "companies",
      "contracts",
      "tenders",
      "company-people",
      "funds",
      "interreg",
    ]);
  });

  it("labels every group in both languages", () => {
    for (const s of sources()) {
      expect(s.label.bg, s.id).toBeTruthy();
      expect(s.label.en, s.id).toBeTruthy();
      // Interreg is a proper noun and reads the same either way apart from its gloss, so
      // the two must differ but the check is on the whole label, not on a token.
      expect(s.label.bg, s.id).not.toBe(s.label.en);
    }
  });

  it("only the places group is an index; the rest are server-backed", () => {
    // The distinction is the cost model: the index is built from a catalog fetched once,
    // the others are a request per debounced keystroke.
    const byKind = Object.fromEntries(sources().map((s) => [s.id, s.kind]));
    expect(byKind).toEqual({
      places: "index",
      "public-people": "server",
      "company-people": "server",
      products: "server",
      awarders: "server",
      companies: "server",
      contracts: "server",
      tenders: "server",
      funds: "server",
      interreg: "server",
    });
  });

  it("caps each group so no one subject can fill the dropdown", () => {
    const total = sources().reduce((n, s) => n + (s.limit ?? 0), 0);
    for (const s of sources()) expect(s.limit, s.id).toBeGreaterThan(0);
    // 20 rows is the keyboard budget. `HubSearch` scroll-bounds the dropdown anyway; this
    // bounds how far an arrow key has to travel and stops a broad query turning the global
    // finder into a browser.
    expect(total).toBeLessThanOrEqual(20);
  });

  it("every see-all destination reads the parameter it is handed", () => {
    // A link advertising a filtered destination that delivers an unfiltered one is worse
    // than no link.
    //
    // FOUR groups have one. The six that do not, and why:
    //   public-people  /persons reproduces a correctly-spelled name but NOT a typo — it is
    //                  substring where this endpoint is trigram-fuzzy
    //   company-people /persons browses P and V, never the 445,804-row N tier
    //   products       ⚠️ the preview and /consumption/products run DIFFERENT shliokavitsa
    //                  engines (shlyoCandidates vs shlyo_query_fold) — measured, „mliako",
    //                  „biala", „rakiia" and „iogurt" each preview 20 real products and the
    //                  destination returns ZERO. There is no altQuery to carry: price-search
    //                  returns a bare array and supplies no rewrite.
    //   awarders       no awarders browser reads ?q
    //   funds          /procurement/contracts is the ЗОП corpus and holds none of these rows
    //   interreg       same, and no Interreg browser reads ?q either
    //   places         a place IS its destination
    const withSeeAll = sources().filter((s) => s.seeAll);
    expect(withSeeAll.map((s) => s.id)).toEqual([
      "companies",
      "contracts",
      "tenders",
    ]);
    for (const s of withSeeAll) {
      // `seeAll` may return undefined by contract, so the link is asserted to EXIST before
      // it is asserted to be right — otherwise a source that quietly stopped offering one
      // would pass.
      const link = s.seeAll!("Сливен");
      expect(link, s.id).toBeTruthy();
      expect(link!.to, s.id).toContain("q=");
      expect(link!.to, s.id).toMatch(/^\//);
    }
  });

  it("offers NO see-all below the destination's own three-character floor", () => {
    // ⚠️ `HubSearch` opens at TWO characters and every destination is a DbDataTable flooring
    // at three, whose server refuses a shorter term with a 400. Without this a two-character
    // query shows a preview with rows and four links to „въведете поне 3 знака".
    for (const q of ["АД", "x", ""])
      for (const s of sources())
        expect(s.seeAll?.(q), `${s.id} @ ${JSON.stringify(q)}`).toBeUndefined();
    // …and three characters is enough.
    expect(
      sources().find((s) => s.id === "companies")!.seeAll!("АДФ"),
    ).toBeTruthy();
  });

  it("measures the floor on the TRIMMED term the destination will run", () => {
    // „аб " is three characters here and two at the destination, which trims. The floor has
    // to be measured on what the destination runs, not on what reached this callback.
    const companies = sources().find((s) => s.id === "companies")!;
    expect(companies.seeAll!("аб ")).toBeUndefined();
    expect(companies.seeAll!(" абв ")).toBeTruthy();
  });

  it("derives the floor from the SHARED rule rather than a private copy", async () => {
    // ⚠️ A private `const SEE_ALL_MIN_CHARS = 3` would not move when the engine's floor moves.
    // `searchTerm.test.ts` reads SEARCH_MIN_CHARS back out of functions/db_table.js, so a
    // bump to 4 fails THERE — and a hand-rolled copy here would silently keep offering a
    // 3-character link to a destination that had started refusing it, while this file's own
    // „three is enough" assertion carried on passing.
    const { SEARCH_MIN_CHARS } = await import("@/ux/data_table/searchTerm");
    const companies = sources().find((s) => s.id === "companies")!;
    expect(companies.seeAll!("х".repeat(SEARCH_MIN_CHARS - 1))).toBeUndefined();
    expect(companies.seeAll!("х".repeat(SEARCH_MIN_CHARS))).toBeTruthy();
  });

  it("counts the floor in CHARACTERS, not UTF-16 code units", () => {
    // `[..."👍👍"].length` is 2 while `.length` is 4, and `show_trgm('👍👍')` is the EMPTY
    // set — so a code-unit count lets exactly the worst case through.
    const companies = sources().find((s) => s.id === "companies")!;
    expect(companies.seeAll!("👍👍")).toBeUndefined();
  });

  it("the three procurement see-alls force the all-time scope", () => {
    // Those tables default to the selected parliament's window, so a match that predates it
    // would land on zero rows — a search that found something and then showed nothing.
    for (const id of ["companies", "contracts", "tenders"]) {
      const link = sources().find((s) => s.id === id)!.seeAll!("Сливен");
      expect(link!.to, id).toContain("pscope=all");
    }
    // …and only those three. A fourth would mean a non-procurement destination was handed a
    // procurement param it does not read.
    expect(
      sources().filter((s) => s.seeAll?.("Сливен")?.to.includes("pscope"))
        .length,
    ).toBe(3);
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
    // The synthetic Пловдив and Варна city rows carry one — NOT София, whose derived route
    // does not exist.
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

// ── THREE REQUESTS FOR TEN GROUPS ──────────────────────────────────────────────────────
//
// The whole cost argument for the expansion. `HubSearch` fires every server source in ONE
// pass on one AbortController per debounced query, so the two person groups must collapse
// onto one request and the six procurement groups onto another — otherwise the box would
// cost eight requests per keystroke on the site's entry page.

const armedSources = () => homeSearchSources(true, null, noOblast, true);
const serverFetch = (id: string) =>
  armedSources().find((s) => s.id === id) as {
    fetch: (q: string, s: AbortSignal) => Promise<unknown[]>;
  };

const mockRoutes = (body: Record<string, unknown>) => {
  const f = vi.fn(async (url: string) => ({
    ok: true,
    url,
    json: async () => (String(url).includes("price-search") ? [] : body),
  }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("home finder — three requests for ten groups", () => {
  it("issues ONE person request for both people groups", async () => {
    const f = mockRoutes({ power: [], money: [], others: [], altQuery: null });
    const ctrl = new AbortController();
    await Promise.all([
      serverFetch("public-people").fetch("терзиев", ctrl.signal),
      serverFetch("company-people").fetch("терзиев", ctrl.signal),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("person-search");
  });

  it("issues ONE procurement request for all SIX procurement groups", async () => {
    // ⚠️ The route already runs all six searches on every call. Six independent sources
    // would issue it six times per keystroke for the same needle.
    const f = mockRoutes({
      companies: [],
      awarders: [],
      contracts: [],
      tenders: [],
      funds: [],
      interreg: [],
    });
    const ctrl = new AbortController();
    await Promise.all(
      [
        "awarders",
        "companies",
        "contracts",
        "tenders",
        "funds",
        "interreg",
      ].map((id) => serverFetch(id).fetch("ремонт", ctrl.signal)),
    );
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("procurement-search");
  });

  it("costs exactly three requests for one query across every group", async () => {
    const f = mockRoutes({
      power: [],
      money: [],
      others: [],
      companies: [],
      awarders: [],
      contracts: [],
      tenders: [],
      funds: [],
      interreg: [],
      altQuery: null,
    });
    const ctrl = new AbortController();
    await Promise.all(
      armedSources()
        .filter((s) => s.kind === "server")
        .map((s) =>
          (
            s as { fetch: (q: string, sg: AbortSignal) => Promise<unknown[]> }
          ).fetch("сливен", ctrl.signal),
        ),
    );
    expect(f).toHaveBeenCalledTimes(3);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("person-search"))).toBe(true);
    expect(urls.some((u) => u.includes("procurement-search"))).toBe(true);
    expect(urls.some((u) => u.includes("price-search"))).toBe(true);
  });
});

describe("home finder — the see-all needle", () => {
  it("carries the shliokavitsa REWRITE, not what the reader typed", async () => {
    // The browse tables these links land on run their own search and do NOT carry the
    // route's rewrite, so a link built from the typed query advertises rows the destination
    // cannot find — „6umen" previews six contracts and /procurement/contracts?q=6umen
    // returns one.
    mockRoutes({
      companies: [],
      awarders: [],
      contracts: [],
      tenders: [],
      funds: [],
      interreg: [],
      altQuery: "шумен",
      contractsTotal: 42,
      tendersTotal: 0,
    });
    await sharedProcurementSearch("6umen", new AbortController().signal);
    // Every group that HAS a see-all, so a new one cannot be added without the needle.
    for (const id of ["companies", "contracts", "tenders"]) {
      const to = armedSources().find((s) => s.id === id)!.seeAll!("6umen")!.to;
      expect(to, id).toContain(encodeURIComponent("шумен"));
      expect(to, id).not.toContain("6umen");
    }
  });

  it("shows the bounded remainder on a capped preview, and nothing otherwise", async () => {
    mockRoutes({
      companies: [],
      awarders: [],
      contracts: [],
      tenders: [],
      funds: [],
      interreg: [],
      altQuery: null,
      contractsTotal: 42,
      tendersTotal: 1,
    });
    await sharedProcurementSearch("ремонт", new AbortController().signal);
    const label = (id: string) =>
      armedSources().find((s) => s.id === id)!.seeAll!("ремонт")!.label;
    expect(label("contracts")).toContain("(42)");
    // One match under a cap of one: nothing more to see, so no count.
    expect(label("tenders")).not.toContain("(");
  });

  it("falls back to the typed needle for a query nothing answered", () => {
    // Never another query's rewrite: the store is keyed, and an unknown key returns the
    // query itself, which is the safe direction.
    const to = armedSources().find((s) => s.id === "companies")!.seeAll!(
      "никога",
    )!.to;
    expect(to).toContain(encodeURIComponent("никога"));
  });
});

// ── Each group is wired to ITS OWN corpus ──────────────────────────────────────────────
//
// ⚠️ THE ONE THING THE ORDER/CAP/LABEL ASSERTIONS ABOVE CANNOT SEE. Every procurement group
// awaits the same shared promise and differs only in which array it maps, so swapping two
// `fetch` references — `contracts: fetchProcurementTenders` — changes nothing about the
// source list's shape and would ship a „Договори по ЗОП" heading over tender rows.

describe("home finder — a group serves its own corpus", () => {
  const CORPUS = {
    awarders: { key: "awarders", to: "/awarder/" },
    companies: { key: "companies", to: "/company/" },
    contracts: { key: "contracts", to: "/procurement/contract/" },
    tenders: { key: "tenders", to: "/tenders/" },
    funds: { key: "funds", to: "/funds/contract/" },
    interreg: { key: "interreg", to: "/funds/interreg/" },
  } as const;

  const ROW: Record<string, unknown> = {
    awarders: { eik: "000695089", name: "АПИ" },
    companies: { eik: "104055066", name: "Фирма" },
    contracts: {
      key: "k1",
      title: "Договор",
      date: "2024-01-01",
      awarderName: "А",
      contractorName: "Б",
      amountEur: 1,
    },
    tenders: {
      unp: "u1",
      subject: "Процедура",
      publicationDate: "2024-01-01",
      buyerName: "А",
      estimatedValueEur: 1,
    },
    funds: {
      contractNumber: "BG-1",
      title: "Проект",
      beneficiaryEik: null,
      beneficiaryName: null,
      programName: null,
      totalEur: 1,
    },
    interreg: {
      keepId: 1,
      title: "Op",
      programmeBg: null,
      period: "2014-2020",
      bgBudgetEur: 1,
    },
  };

  it("maps each procurement group to the array its heading names", async () => {
    for (const [id, { key, to }] of Object.entries(CORPUS)) {
      __resetProcurementSearchCache();
      // ONLY this group's array is populated, so a source reading any other returns nothing.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ [key]: [ROW[id]] }),
        })),
      );
      const rows = await (
        armedSources().find((s) => s.id === id) as {
          fetch: (q: string, s: AbortSignal) => Promise<{ to: string }[]>;
        }
      ).fetch("x", new AbortController().signal);
      expect(rows, id).toHaveLength(1);
      expect(rows[0].to, id).toContain(to);
    }
  });

  it("asks the person route for BOTH tiers, and the private group for its own cap", async () => {
    // The V/N quota: the group displays `limit` rows, so it must ASK for that many — a cap
    // above the limit wastes the balance, one below leaves the group short of its own budget.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          power: [],
          money: Array.from({ length: 6 }, (_, i) => ({
            key: `slug:v${i}`,
            name: `V${i}`,
            tier: "V",
            position_type: "private_sector",
            place_label: null,
            href: `/person/v${i}`,
            firms_count: 1,
          })),
          others: Array.from({ length: 6 }, (_, i) => ({
            key: `fold:n${i}`,
            name: `N${i}`,
            tier: "N",
            position_type: "private_sector",
            place_label: null,
            href: `/person/N${i}`,
            firms_count: 1,
          })),
          altQuery: null,
        }),
      })),
    );
    const group = armedSources().find((s) => s.id === "company-people")!;
    const rows = await (
      group as { fetch: (q: string, s: AbortSignal) => Promise<unknown[]> }
    ).fetch("x", new AbortController().signal);
    // `limit` is optional on the source type; a group that lost it would silently fall back
    // to DEFAULT_LIMIT (8) in HubSearch, so assert it is declared before comparing.
    expect(group.limit).toBeDefined();
    expect(rows).toHaveLength(group.limit!);
  });

  it("passes the role labeler through, so a public row shows its OFFICE", async () => {
    // The change's stated purpose: „Кмет · Столична община" rather than „Политик · Столична
    // община", which is true of Sofia's mayor and of 46,158 other people. Dropping the
    // argument silently falls back to the broad facet.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          power: [
            {
              key: "slug:m",
              name: "Васил Терзиев",
              tier: "P",
              position_type: "politician",
              primary_role: "mayor",
              place_label: "Столична община",
              href: "/person/m",
            },
          ],
          money: [],
          others: [],
          altQuery: null,
        }),
      })),
    );
    const withLabeler = homeSearchSources(true, null, noOblast, true, (r) =>
      r === "mayor" ? "Кмет" : "",
    ).find((s) => s.id === "public-people") as {
      fetch: (q: string, s: AbortSignal) => Promise<{ secondary?: string }[]>;
    };
    const rows = await withLabeler.fetch("x", new AbortController().signal);
    expect(rows[0].secondary).toBe("Кмет · Столична община");

    // …and without one it degrades to the broad facet rather than to a raw code.
    __resetPersonSearchCache();
    const plain = armedSources().find((s) => s.id === "public-people") as {
      fetch: (q: string, s: AbortSignal) => Promise<{ secondary?: string }[]>;
    };
    expect(
      (await plain.fetch("x", new AbortController().signal))[0].secondary,
    ).toBe("Политик · Столична община");
  });
});
