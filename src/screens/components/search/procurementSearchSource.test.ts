// The shared /api/db/procurement-search adapter — one request, six groups.
//
// The route already runs all six searches on every call and pays for both bounded totals and
// the shliokavitsa rewrite, so a consumer rendering two of them is discarding four it has
// been billed for. These pin the normalization of the other four, the two synthetic-key
// guards, and the per-query metadata a synchronous `seeAll` has to read.
//
//   npm run test:unit -- src/screens/components/search/procurementSearchSource.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/../scripts/lib/strip_comments";
import { SCOPE_ALL, SCOPE_PARAM } from "@/data/scope/constants";
import { resolveScope, type Scope } from "@/data/scope/useScope";
import {
  __resetProcurementSearchCache,
  contractItems,
  fetchProcurementAwarders,
  fetchProcurementCompanies,
  fetchFundProjects,
  fetchInterregOperations,
  fetchProcurementContracts,
  fetchProcurementTenders,
  fundItems,
  awarderAllTimeHref,
  awarderItems,
  companyAllTimeHref,
  companyItems,
  fundProjectHref,
  interregHref,
  interregItems,
  procurementAltQuery,
  moreCountLabel,
  procurementMoreCount,
  sharedProcurementSearch,
  tenderItems,
  type ProcurementSearchResponse,
} from "./procurementSearchSource";

const body = (
  over: Partial<ProcurementSearchResponse> = {},
): ProcurementSearchResponse => ({
  companies: [],
  awarders: [],
  contracts: [],
  tenders: [],
  funds: [],
  interreg: [],
  contractsTotal: 0,
  tendersTotal: 0,
  altQuery: null,
  ...over,
});

const ok = (b: ProcurementSearchResponse) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(b) } as Response);

const contract = {
  key: "a1b2c3",
  title: "Ремонт на път",
  date: "2024-03-01",
  awarderName: "Община Сливен",
  contractorName: "Пътстрой ЕООД",
  amountEur: 1_000_000,
};
const tender = {
  unp: "00123-2024-0001",
  subject: "Доставка на храни",
  publicationDate: "2024-02-01",
  buyerName: "Община Ямбол",
  estimatedValueEur: 500_000,
};
const fund = {
  contractNumber: "BG16RFOP002-2.089-3686-C01",
  title: "Саниране на сграда",
  beneficiaryEik: "104055066",
  beneficiaryName: "Фирма АД",
  programName: "Околна среда",
  totalEur: 250_000,
};
const interreg = {
  keepId: 33607,
  title: "Cross-Border Cooperation",
  programmeBg: "Черноморски басейн",
  period: "2014-2020",
  bgBudgetEur: 120_000,
  partnerHit: "Община Бургас",
};

describe("contracts", () => {
  it("routes to the contract's own page, encoded", () => {
    const [i] = contractItems(body({ contracts: [contract] }));
    expect(i.to).toBe("/procurement/contract/a1b2c3");
    expect(i.amountEur).toBe(1_000_000);
  });

  it("names the CONTRACTOR, falling back to the buyer", () => {
    // Which end of the deal a row names is what tells two identically-titled
    // „Доставка на хранителни продукти" apart.
    expect(contractItems(body({ contracts: [contract] }))[0].secondary).toBe(
      "2024-03-01 · Пътстрой ЕООД",
    );
    expect(
      contractItems(
        body({ contracts: [{ ...contract, contractorName: "" }] }),
      )[0].secondary,
    ).toBe("2024-03-01 · Община Сливен");
  });

  it("encodes a key carrying a path separator", () => {
    const [i] = contractItems(
      body({ contracts: [{ ...contract, key: "a/b" }] }),
    );
    expect(i.to).toBe("/procurement/contract/a%2Fb");
  });
});

describe("tenders", () => {
  it("routes to /tenders/:unp with the buyer and date beneath", () => {
    const [i] = tenderItems(body({ tenders: [tender] }));
    expect(i.to).toBe("/tenders/00123-2024-0001");
    expect(i.secondary).toBe("2024-02-01 · Община Ямбол");
    expect(i.amountEur).toBe(500_000);
  });

  it("encodes a УНП carrying a path separator", () => {
    // Asserting against `encodeURIComponent(unp)` is a tautology on a УНП that needs no
    // encoding — it passes with the call removed. A separator is what discriminates.
    const [i] = tenderItems(
      body({ tenders: [{ ...tender, unp: "00123/2024" }] }),
    );
    expect(i.to).toBe("/tenders/00123%2F2024");
  });
});

describe("ИСУН projects", () => {
  it("routes to the PROJECT, not to its beneficiary company", () => {
    const [i] = fundItems(body({ funds: [fund] }));
    expect(i.to).toBe(fundProjectHref(fund.contractNumber));
    expect(i.to).not.toContain("/company/");
  });

  it("keeps a project whose beneficiary EIK the corpus cannot key", () => {
    // Filtering these out hid real projects the search had already found — an absence a
    // reader cannot tell from "no such project".
    expect(
      fundItems(body({ funds: [{ ...fund, beneficiaryEik: null }] })),
    ).toHaveLength(1);
  });

  it("renders an untitled project as its contract number, never as a blank row", () => {
    const [i] = fundItems(body({ funds: [{ ...fund, title: "  " }] }));
    expect(i.primary).toBe(fund.contractNumber);
  });

  it("drops a row with no contract number — it has no page to go to", () => {
    expect(
      fundItems(body({ funds: [{ ...fund, contractNumber: "" }] })),
    ).toEqual([]);
  });

  it("omits an absent programme or beneficiary rather than leaving a separator", () => {
    expect(
      fundItems(body({ funds: [{ ...fund, beneficiaryName: null }] }))[0]
        .secondary,
    ).toBe("Околна среда");
    expect(
      fundItems(body({ funds: [{ ...fund, programName: null }] }))[0].secondary,
    ).toBe("Фирма АД");
    // Neither present: no subtitle at all, not an empty one — `SearchItem.secondary` is
    // optional and an empty string renders as a blank second line.
    expect(
      fundItems(
        body({
          funds: [{ ...fund, programName: null, beneficiaryName: null }],
        }),
      )[0].secondary,
    ).toBeUndefined();
  });
});

describe("Interreg", () => {
  it("routes by keep.eu id and shows the BULGARIAN partners' share", () => {
    // Never the operation total: that includes the foreign partners and overstates the
    // Bulgarian side several-fold.
    const [i] = interregItems(body({ interreg: [interreg] }));
    expect(i.to).toBe(interregHref(interreg.keepId));
    expect(i.amountEur).toBe(120_000);
    expect(i.secondary).toBe("Черноморски басейн · 2014-2020 · Община Бургас");
  });

  it("renders an untitled operation as its keep.eu id, never as a blank row", () => {
    const [i] = interregItems(
      body({ interreg: [{ ...interreg, title: "  " }] }),
    );
    expect(i.primary).toBe("33607");
  });

  it("keeps the href to ONE path segment for a string id", () => {
    // `keepId` is a number, so no test can discriminate the encode on the row type — the
    // helper also takes a string (the funds finder passes one), and that is the arm where
    // dropping the encode is observable.
    expect(interregHref("33607/2")).toBe("/funds/interreg/33607%2F2");
  });

  it("drops an absent programme rather than leaving a separator", () => {
    const [i] = interregItems(
      body({
        interreg: [
          { ...interreg, keepId: 33607, programmeBg: null, partnerHit: null },
        ],
      }),
    );
    expect(i.to).toBe("/funds/interreg/33607");
    expect(i.secondary).toBe("2014-2020");
  });

  it("keeps its own id namespace, so it cannot collide with an ИСУН row", () => {
    const ids = [
      ...fundItems(body({ funds: [{ ...fund, contractNumber: "33607" }] })),
      ...interregItems(body({ interreg: [interreg] })),
    ].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("id namespaces across ALL six groups", () => {
  // ⚠️ LOAD-BEARING IN `EntitySearchTile`, WHICH DOES NOT RE-NAMESPACE. `HubSearch` prefixes
  // every item id with its source id; the procurement tile's shell does not, so two groups
  // emitting the same id mark BOTH options aria-selected while arrow keys land on one.
  //
  // The pair that collides on ORDINARY data is company/awarder: a public body that both buys
  // and supplies carries one EIK in both groups, and there are real ones.
  beforeEach(() => __resetProcurementSearchCache());
  afterEach(() => vi.restoreAllMocks());

  it("gives one EIK appearing as both a buyer and a supplier two distinct ids", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(
        body({
          companies: [{ eik: "104055066", name: "Двойна роля" }],
          awarders: [{ eik: "104055066", name: "Двойна роля" }],
        }),
      ),
    );
    const signal = new AbortController().signal;
    const ids = [
      ...(await fetchProcurementCompanies("x", signal)),
      ...(await fetchProcurementAwarders("x", signal)),
    ].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(["company-104055066", "awarder-104055066"]);
  });

  it("namespaces contract and tender ids too", () => {
    // A contract key and a УНП are drawn from different spaces and could coincide.
    const shared = "a1b2c3";
    const ids = [
      ...contractItems(body({ contracts: [{ ...contract, key: shared }] })),
      ...tenderItems(body({ tenders: [{ ...tender, unp: shared }] })),
    ].map((i) => i.id);
    expect(ids).toEqual([`contract-${shared}`, `tender-${shared}`]);
  });
});

describe("synthetic contractor keys", () => {
  beforeEach(() => {
    __resetProcurementSearchCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetProcurementSearchCache();
    vi.restoreAllMocks();
  });

  // A link promises somewhere to go. `ph-` (a made-up registration number) and `np-` (a
  // natural person keyed by name) name nothing checkable against a register; the EMPTY
  // string produces `/company/?pscope=all`, which matches no route at all; `obed-` is a
  // consortium carrier whose page is the only route from a joint bid to the member firms.
  const MIXED = [
    { eik: "104055066", name: "Реална фирма" },
    { eik: "obed-abc", name: "Обединение" },
    { eik: "ph-1", name: "Филър" },
    { eik: "np-2", name: "Физическо лице" },
    { eik: "", name: "Празен ключ" },
  ];

  it("de-links a filler, a natural person and the empty key; keeps a carrier", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(body({ companies: MIXED })),
    );
    const items = await fetchProcurementCompanies(
      "x",
      new AbortController().signal,
    );
    expect(items.map((i) => i.to)).toEqual([
      "/company/104055066?pscope=all",
      "/company/obed-abc?pscope=all",
    ]);
  });

  it("the PURE builder applies the same rule — it is the one every caller shares", () => {
    // `ProcurementSearchTile` and `cultureSearch` run their own request, so they reach the
    // filter only through this builder. The tile hand-rolled the mapping and was therefore
    // the one surface still linking synthetic keys; pinning the pure half is what stops a
    // future private `.map` from looking equivalent.
    expect(companyItems(body({ companies: MIXED })).map((i) => i.to)).toEqual([
      "/company/104055066?pscope=all",
      "/company/obed-abc?pscope=all",
    ]);
  });

  it("does not filter AWARDER keys — two live buyers sit outside 9/13 digits", () => {
    // ЕСО (1752013040) and АДФИ (175076479999) both resolve, so routing an awarder through
    // the contractor predicate would de-link working pages.
    const rows = [
      { eik: "1752013040", name: "ЕСО" },
      { eik: "175076479999", name: "АДФИ" },
    ];
    expect(awarderItems(body({ awarders: rows }))).toHaveLength(2);
  });
});

describe("the shared request and its metadata", () => {
  beforeEach(() => {
    __resetProcurementSearchCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetProcurementSearchCache();
  });

  const signal = new AbortController().signal;

  it("issues ONE fetch for all six groups on one needle", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(
        body({
          companies: [{ eik: "104055066", name: "c" }],
          awarders: [{ eik: "000695089", name: "a" }],
          contracts: [contract],
          tenders: [tender],
          funds: [fund],
          interreg: [interreg],
        }),
      ),
    );
    const groups = await Promise.all([
      fetchProcurementCompanies("ремонт", signal),
      fetchProcurementAwarders("ремонт", signal),
      fetchProcurementContracts("ремонт", signal),
      fetchProcurementTenders("ремонт", signal),
      fetchFundProjects("ремонт", signal),
      fetchInterregOperations("ремонт", signal),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });

  it("carries the rewritten needle for the query it answered, and no other", async () => {
    // `seeAll` is a SYNCHRONOUS render-time callback and cannot await the promise, so the
    // needle has to be readable by key. The browse tables these links land on run their own
    // search WITHOUT the rewrite: on „6umen" the preview shows 6 contracts and
    // /procurement/contracts?q=6umen returns 1.
    vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
      ok(body({ altQuery: String(url).includes("6umen") ? "шумен" : null })),
    );
    await sharedProcurementSearch("6umen", signal);
    expect(procurementAltQuery("6umen")).toBe("шумен");
    expect(procurementAltQuery("ремонт")).toBe("ремонт");
  });

  it("reports a capped preview's remainder, and nothing when it is not capped", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(body({ contractsTotal: 42, tendersTotal: 6 })),
    );
    await sharedProcurementSearch("ремонт", signal);
    expect(procurementMoreCount("ремонт", "contracts", 6)).toBe(" (42)");
    // Nothing to add when the preview was not capped, and nothing at all for a needle we
    // never asked about — never a borrowed count from another query.
    expect(procurementMoreCount("ремонт", "tenders", 6)).toBe("");
    expect(procurementMoreCount("никога", "contracts", 6)).toBe("");
  });

  it("shares ONE formatter with the procurement tile, which has its own request", () => {
    // The tile fills no metadata store, so it calls the pure half. Two copies of this rule
    // would let a change to the route's `LIMIT 100` reach one surface and not the other.
    expect(moreCountLabel(42, 6)).toBe(" (42)");
    expect(moreCountLabel(6, 6)).toBe("");
    expect(moreCountLabel(100, 6)).toBe(" (99+)");
    expect(moreCountLabel(undefined, 6)).toBe("");
    expect(moreCountLabel(0, 0)).toBe("");
  });

  it("renders a bounded total as 99+ rather than as an exact 100", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(body({ contractsTotal: 100 })),
    );
    await sharedProcurementSearch("ремонт", signal);
    expect(procurementMoreCount("ремонт", "contracts", 6)).toBe(" (99+)");
  });

  it("records the rewrite even when a LATER request has displaced this entry", async () => {
    // ⚠️ THE REGRESSION GUARD FOR A BUG THAT REACHED PRODUCTION IN THE SIBLING MODULE.
    // Gating the metadata write on „am I still the in-flight entry" looks symmetric with the
    // eviction and is not: a second source in the same tick displaces the first entry before
    // it resolves, so the first response writes nothing and its „виж всички" ships the
    // un-rewritten needle for ever. Nothing displaces the entry on THIS endpoint today —
    // which is exactly why the guard would look harmless right up until something did.
    let settle: ((v: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
      String(url).includes("6umen")
        ? new Promise<Response>((res) => {
            settle = res;
          })
        : ok(body()),
    );
    const first = sharedProcurementSearch("6umen", signal);
    // A different needle displaces the in-flight entry BEFORE the first resolves.
    await sharedProcurementSearch("ремонт", signal);
    settle?.({
      ok: true,
      json: () => Promise.resolve(body({ altQuery: "шумен" })),
    } as Response);
    await first;
    expect(procurementAltQuery("6umen")).toBe("шумен");
  });

  it("throws on a non-ok response instead of degrading to an empty corpus", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    await expect(fetchProcurementContracts("ремонт", signal)).rejects.toThrow(
      /procurement-search: 500/,
    );
  });

  it("evicts a REJECTED entry so a re-typed needle is retried, not poisoned", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("aborted")) : ok(body());
    });
    await expect(sharedProcurementSearch("ремонт", signal)).rejects.toThrow();
    await expect(
      sharedProcurementSearch("ремонт", signal),
    ).resolves.toBeTruthy();
    expect(calls).toBe(2);
  });

  it("treats a response missing a group as empty, not as a crash", async () => {
    // A database predating migration 086 or 138 degrades those groups to [] server-side, and
    // an older deploy can omit the field entirely.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok({} as ProcurementSearchResponse),
    );
    const r = await sharedProcurementSearch("ремонт", signal);
    expect(fundItems(r)).toEqual([]);
    expect(interregItems(r)).toEqual([]);
    expect(contractItems(r)).toEqual([]);
    expect(tenderItems(r)).toEqual([]);
  });
});

describe("entity destinations carry the window the row's figure was measured over", () => {
  beforeEach(() => {
    __resetProcurementSearchCache();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetProcurementSearchCache();
    vi.restoreAllMocks();
  });

  it("builds /company and /awarder on the all-time scope", () => {
    expect(companyAllTimeHref("130878827")).toBe(
      "/company/130878827?pscope=all",
    );
    expect(awarderAllTimeHref("000689061")).toBe(
      "/awarder/000689061?pscope=all",
    );
  });

  it("emits a scope the shared parser actually resolves to the full corpus", () => {
    // ⚠️ NOT a second copy of the literal. Both the param name and the value are owned by
    // `@/data/scope/constants`; asserting the string on both sides would stay green after a
    // rename on the scope side, with this module emitting a param nothing reads.
    const p = new URLSearchParams(
      companyAllTimeHref("130878827").split("?")[1],
    );
    expect(p.get(SCOPE_PARAM)).toBe(SCOPE_ALL);
    expect(resolveScope(p.get(SCOPE_PARAM) as Scope)).toBe("all");
  });

  it("encodes a synthetic key rather than splicing it into the path", () => {
    // `obed-` carriers are keyed by a hash today, but the column also holds `ph-`/`np-`
    // keys derived from NAMES, so the encode is not decorative.
    expect(companyAllTimeHref("obed-a/b")).toBe(
      "/company/obed-a%2Fb?pscope=all",
    );
  });

  it("the COMPANY ROW carries pscope=all, not only the see-all below it", async () => {
    // ⚠️ THE ROW, NOT THE GROUP FOOTER. `homeSearch`'s „Виж всички фирми" has carried
    // `pscope=all` since it was written, so a test that only checks the see-all passes on
    // the very code this exists to prevent: a row advertising an all-time euro figure and
    // linking to a page that defaults to the selected parliament's window. Measured
    // 2026-09-02 on 130878827 — €22,424,885 previewed, €3,969,914 served.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(
        body({
          companies: [{ eik: "130878827", name: "Клет България ООД" }],
          awarders: [{ eik: "000689061", name: "Пета МБАЛ" }],
        }),
      ),
    );
    const signal = new AbortController().signal;
    const [company] = await fetchProcurementCompanies("клет", signal);
    const [awarder] = await fetchProcurementAwarders("клет", signal);
    expect(company.to).toBe("/company/130878827?pscope=all");
    expect(awarder.to).toBe("/awarder/000689061?pscope=all");
  });

  it("both shared adapters emit a scope beside their euro figure", async () => {
    // The two adapters, pinned together. This does NOT close the class — a third adapter
    // added to this module contributes no rows here and would pass unchanged — which is
    // what the source sweep at the foot of this file is for.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      ok(
        body({
          companies: [
            {
              eik: "130878827",
              name: "Клет България ООД",
              contractsEur: 22_424_885,
            },
          ],
          awarders: [
            { eik: "000689061", name: "Пета МБАЛ", contractsEur: 62_620_984 },
          ],
        }),
      ),
    );
    const signal = new AbortController().signal;
    const rows = [
      ...(await fetchProcurementCompanies("клет", signal)),
      ...(await fetchProcurementAwarders("клет", signal)),
    ];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.amountEur).toBeGreaterThan(0);
      expect(String(r.to)).toContain("pscope=all");
    }
  });
});

// ── TEST-003 / FINDING-005: the rule, not two examples of it ───────────────────────────
//
// The per-adapter assertions above prove the two builders in THIS module. They cannot see a
// third entity destination built somewhere else in the search layer — and two such
// destinations existed when this gate was written (`ProcurementSearchTile`'s hand-rolled
// company/awarder rows and `cultureSearch`'s register index), both landing on the `ns`
// default while sitting beside an all-time figure. A bare `/company/${…}` or `/awarder/${…}`
// navigates with an EMPTY query string, so "no scope" is not neutral: it is the parliament
// window, which holds 3.8% of the corpus's contract money.
//
// Comments are stripped first because prose that MENTIONS the pattern is not an occurrence
// of it — this file and both fixed modules discuss `/company/${eik}` in their headers.
describe("no search surface emits a scope-free entity destination", () => {
  const SRC = path.resolve(import.meta.dirname, "../../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  /** Files that build a search DROPDOWN's rows. Not every file naming these paths. */
  const SEARCH_LAYER = /(search|Search)[^/]*\.tsx?$/;

  /**
   * A declared exception carries its reason, so a stale one fails too.
   *
   * ⚠️ WHAT EARNS ONE: a row that carries NO figure — a pure roster entry, where nothing is
   * contradicted by the destination's window. Those still reset the reader's scope, and the
   * honest fix for them is to CARRY it rather than force all-time (they sit on pages with
   * their own ScopeControl, so forcing `all` would override a choice the page just made).
   * That is not expressible today: `EntityIndex.href` is a `string` while `useScopedHref()`
   * returns a `To`. Open work, tracked here rather than silently passing.
   *
   * ⚠️ WHAT DOES NOT: a row ranked by, or displaying, an all-time figure. That is the defect
   * this gate exists for — `NzokSearchBox`'s hospital rows were exactly that (ordered by
   * `cumulativeEur`, landing on the parliament window) and were fixed, not listed.
   */
  const ALLOWED: Record<string, string> = {
    "screens/components/procurement/nzok/NzokSearchBox.tsx":
      "the МЗ second-level roster rows carry no figure — navigational, see above",
    "screens/water/WaterSearchBox.tsx":
      "the ВиК operator roster carries no figure — navigational, see above",
  };

  it("builds every /company and /awarder href with a scope", () => {
    const offenders = walk(SRC)
      .filter(
        (f) =>
          SEARCH_LAYER.test(f) &&
          !f.endsWith(".test.ts") &&
          !f.endsWith(".test.tsx"),
      )
      .filter((f) => {
        const src = stripComments(readFileSync(f, "utf8"));
        // A template href whose interpolation is followed by anything other than `?` or a
        // further path segment — i.e. the bare `/company/${eik}` form.
        return /["'`]\/(?:company|awarder)\/\$\{[^}]+\}(?![?/]|\$\{)/.test(src);
      })
      .map((f) => path.relative(SRC, f))
      .filter((f) => !(f in ALLOWED));
    expect(
      offenders,
      "these build a bare /company or /awarder href — use companyAllTimeHref / " +
        "awarderAllTimeHref (all-time, for a search row) or CompanyLink / useAwarderHref " +
        "(the reader's current scope, for a scoped tile)",
    ).toEqual([]);
  });

  it("the sweep still discriminates", () => {
    // Without this, a regex that stopped matching anything would pass the assertion above
    // for ever. Feed it the exact shape it exists to reject.
    const bad = "const to = `/company/${row.eik}`;";
    expect(
      /["'`]\/(?:company|awarder)\/\$\{[^}]+\}(?![?/]|\$\{)/.test(bad),
    ).toBe(true);
    const good =
      "const to = `/company/${encodeURIComponent(eik)}${allTimeScope}`;";
    expect(
      /["'`]\/(?:company|awarder)\/\$\{[^}]+\}(?![?/]|\$\{)/.test(good),
    ).toBe(false);
  });
});
