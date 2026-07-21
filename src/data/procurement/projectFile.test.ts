import { describe, it, expect } from "vitest";
import {
  scoreConfidence,
  bestConfidence,
  classifyMethod,
  isSingleBid,
  annexDelta,
  roleKeyOf,
  roleLabel,
  foldByContractor,
  rankBroaderCandidates,
  selectBroaderCandidates,
  withThreadTerms,
  withAddedThread,
  withThreadBuyer,
  withoutThread,
  resolveSeedIds,
  siblingLotPolicy,
  lotNumberOf,
  displayLotNumberOf,
  foldContractsByLot,
  matchedContractTotal,
  seeAllContractsHref,
  dedupContracts,
  dedupTenders,
  dedupFunds,
  foldMembers,
  foldByPeriod,
  matchInhouseContractors,
  DEFAULT_THRESHOLD,
  type SearchThread,
  type FoldInput,
} from "./projectFile";

const ringRoad: SearchThread = {
  terms: "околовръстен дъга",
  distinctive: ["дъга"],
  threshold: 0.6,
};

describe("scoreConfidence — the object-vs-landmark call", () => {
  it("auto-includes a row carrying the distinctive token", () => {
    const r = scoreConfidence(
      "Строителство на Западна дъга на Софийски околовръстен път, км 0+780",
      ringRoad,
    );
    expect(r.score).toBeGreaterThanOrEqual(0.6);
    expect(r.reasons.join(" ")).toMatch(/distinctive/);
  });

  it("leaves a landmark-only row below threshold (the Ломско-шосе false positive: has the landmark, not the distinctive token)", () => {
    const r = scoreConfidence(
      "Разширение на Ломско шосе до връзката със Софийски околовръстен път",
      ringRoad,
    );
    expect(r.score).toBeLessThan(0.6);
    expect(r.reasons.join(" ")).toMatch(/landmark-only/);
  });

  it("scores 0 when no query token is present at all", () => {
    expect(scoreConfidence("Доставка на компютри за МОН", ringRoad).score).toBe(
      0,
    );
  });

  it("with no distinctive set, an all-terms match alone reaches the 0.6 threshold", () => {
    const t: SearchThread = { terms: "хемус магистрала" };
    // Both terms present → auto-includes even with no distinctive token set.
    expect(
      scoreConfidence("Магистрала Хемус, участък 1", t).score,
    ).toBeGreaterThanOrEqual(0.6);
    // Only one term (a different motorway) → stays below threshold.
    expect(scoreConfidence("Магистрала Струма", t).score).toBeLessThan(0.6);
  });
});

describe("bestConfidence — multi-thread union (§0f.2)", () => {
  const threads: SearchThread[] = [
    { terms: "бюлетин", distinctive: ["бюлетин"], threshold: 0.6 },
    { terms: "суемг", distinctive: ["суемг"], threshold: 0.5 },
  ];
  it("keeps the best-scoring thread for a row", () => {
    const printing = bestConfidence(
      "Отпечатване на хартиени бюлетини",
      threads,
    );
    expect(printing.score).toBeGreaterThanOrEqual(printing.threshold);
    const machine = bestConfidence("Транспорт на СУЕМГ до секциите", threads);
    expect(machine.score).toBeGreaterThanOrEqual(machine.threshold);
  });
  it("returns a zero default when no thread matches", () => {
    const none = bestConfidence("Ремонт на училище", threads);
    expect(none.score).toBe(0);
    expect(none.threshold).toBe(DEFAULT_THRESHOLD);
  });
});

describe("classifyMethod — the 'как е възложено' strip (§0g.1)", () => {
  it("flags the Shishkov non-competitive methods", () => {
    expect(classifyMethod("Вътрешен конкурентен избор по РС")).toBe(
      "nonCompetitive",
    );
    expect(classifyMethod("Договаряне без предварително обявление")).toBe(
      "nonCompetitive",
    );
  });
  it("keeps open procedures competitive", () => {
    expect(classifyMethod("Открита процедура")).toBe("competitive");
    expect(classifyMethod("Публично състезание")).toBe("competitive");
  });
  it("buckets blank method separately, never as competitive (§11 caveat)", () => {
    expect(classifyMethod("")).toBe("unspecified");
    expect(classifyMethod(null)).toBe("unspecified");
    expect(classifyMethod(undefined)).toBe("unspecified");
  });
});

describe("isSingleBid", () => {
  it("flags ≤1 tenderer, not undisclosed", () => {
    expect(isSingleBid(1)).toBe(true);
    expect(isSingleBid(0)).toBe(true);
    expect(isSingleBid(3)).toBe(false);
    expect(isSingleBid(null)).toBe(false);
    expect(isSingleBid(undefined)).toBe(false);
  });
});

describe("annexDelta — signing→current value change", () => {
  it("returns the delta above the €1 threshold, signed by direction", () => {
    expect(annexDelta(100, 150)).toBe(50);
    expect(annexDelta(150, 100)).toBe(-50);
  });
  it("is null when an operand is missing or the change is sub-€1", () => {
    expect(annexDelta(null, 100)).toBeNull();
    expect(annexDelta(100, null)).toBeNull();
    expect(annexDelta(undefined, undefined)).toBeNull();
    expect(annexDelta(100, 100.4)).toBeNull();
    expect(annexDelta(100, 100)).toBeNull();
  });
});

describe("foldByContractor — contractors table (§4.2.5)", () => {
  it("groups by eik, sums amount, sorts desc, skips amendments", () => {
    const agg = foldByContractor([
      {
        contractorEik: "1",
        contractorName: "A",
        tag: "contract",
        amountEur: 100,
      },
      {
        contractorEik: "1",
        contractorName: "A",
        tag: "contract",
        amountEur: 50,
      },
      {
        contractorEik: "2",
        contractorName: "B",
        tag: "contract",
        amountEur: 200,
      },
      { contractorEik: "1", tag: "contractAmendment", amountEur: 999 }, // skipped
    ]);
    expect(agg.map((a) => [a.eik, a.count, a.eur])).toEqual([
      ["2", 1, 200],
      ["1", 2, 150],
    ]);
  });
  it("falls back to name when eik is missing", () => {
    const agg = foldByContractor([
      { contractorName: "NoEik Ltd", tag: "contract", amountEur: 10 },
    ]);
    expect(agg[0].eik).toBeUndefined();
    expect(agg[0].name).toBe("NoEik Ltd");
  });
});

describe("roleKeyOf / roleLabel — money-by-role grouping (§4.2.4)", () => {
  it("prefers a curated nature label over CPV", () => {
    expect(roleKeyOf("строителство", "71000000")).toBe("строителство");
    expect(roleLabel("строителство", true)).toBe("строителство");
  });
  it("falls back to the CPV division and labels known ones", () => {
    expect(roleKeyOf(undefined, "45233000")).toBe("cpv:45");
    expect(roleLabel("cpv:45", true)).toBe("строителство");
    expect(roleLabel("cpv:71", false)).toBe("design & supervision");
  });
  it("handles blank nature, missing CPV, and unknown divisions", () => {
    expect(roleKeyOf("  ", null)).toBe("cpv:—");
    expect(roleLabel("cpv:—", true)).toBe("без ЦПВ");
    expect(roleLabel("cpv:—", false)).toBe("no CPV");
    expect(roleLabel("cpv:63", true)).toBe("ЦПВ 63");
    expect(roleLabel("cpv:63", false)).toBe("CPV 63");
    expect(roleLabel("cpv:45", false)).toBe("works");
  });
  it("survives a non-string nature from an untrusted ?q= (no throw)", () => {
    expect(roleKeyOf(42, "45000000")).toBe("cpv:45");
    expect(roleKeyOf({}, null)).toBe("cpv:—");
  });
});

describe("rankBroaderCandidates — relevance over amount (§0f.3)", () => {
  const threads: SearchThread[] = [
    { terms: "хемус магистрала", distinctive: ["хемус"], threshold: 0.6 },
  ];
  it("drops below-threshold rows and ranks the on-topic one first despite a smaller amount", () => {
    const ranked = rankBroaderCandidates(
      [
        // large but off-topic (landmark-only, no distinctive token) → dropped
        { key: "big", title: "Магистрала Струма", amountEur: 900 },
        // genuinely on-topic, small → kept, ranked first
        { key: "small", title: "Магистрала Хемус, участък 3", amountEur: 10 },
      ],
      threads,
    );
    expect(ranked.map((r) => r.key)).toEqual(["small"]);
  });
  it("uses amount as the tiebreak when two rows score equally", () => {
    const ranked = rankBroaderCandidates(
      [
        { key: "lo", title: "Магистрала Хемус, лот 1", amountEur: 10 },
        { key: "hi", title: "Магистрала Хемус, лот 2", amountEur: 99 },
      ],
      threads,
    );
    expect(ranked.map((r) => r.key)).toEqual(["hi", "lo"]);
  });
});

describe("selectBroaderCandidates — new-only, capped (§0f.3)", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}` }));
  it("drops members, excludes and already-included, then caps at the limit", () => {
    const out = selectBroaderCandidates(
      [{ key: "member" }, { key: "excl" }, { key: "inc" }, { key: "fresh" }],
      ["member"],
      ["excl"],
      ["inc"],
    );
    expect(out.map((r) => r.key)).toEqual(["fresh"]);
  });
  it("caps the visible list (default 15)", () => {
    expect(selectBroaderCandidates(rows, [], [], [])).toHaveLength(15);
    expect(selectBroaderCandidates(rows, [], [], [], 3)).toHaveLength(3);
  });
});

describe("multi-thread search edits (§0f.2)", () => {
  const threads: SearchThread[] = [
    { terms: "западна дъга", distinctive: ["дъга"], buyerEik: ["000695089"] },
    { terms: "надзор" },
  ];
  it("withThreadTerms replaces terms but keeps the thread's other fields", () => {
    const out = withThreadTerms(threads, 0, "  източна дъга ");
    expect(out[0]).toEqual({
      terms: "източна дъга",
      distinctive: ["дъга"],
      buyerEik: ["000695089"],
    });
    expect(out[1]).toBe(threads[1]); // untouched
  });
  it("withThreadTerms ignores a blank commit (returns an equal array)", () => {
    expect(withThreadTerms(threads, 1, "   ")).toEqual(threads);
  });
  it("withAddedThread appends a terms-only thread, ignoring a blank add", () => {
    expect(withAddedThread(threads, "струма")).toHaveLength(3);
    expect(withAddedThread(threads, "струма")[2]).toEqual({ terms: "струма" });
    expect(withAddedThread(threads, "  ")).toHaveLength(2);
  });
  it("withoutThread drops the target, but never the last remaining thread", () => {
    expect(withoutThread(threads, 0).map((t) => t.terms)).toEqual(["надзор"]);
    const one: SearchThread[] = [{ terms: "само аз" }];
    expect(withoutThread(one, 0)).toEqual(one);
  });
  it("withThreadBuyer sets a thread's buyer scope + display name, keeping terms", () => {
    const out = withThreadBuyer(threads, 1, {
      eik: "000695324",
      name: "Министерство на отбраната",
    });
    expect(out[1]).toEqual({
      terms: "надзор",
      buyerEik: ["000695324"],
      buyerName: "Министерство на отбраната",
    });
    expect(out[0]).toBe(threads[0]); // untouched
  });
  it("withThreadBuyer(null) clears buyerEik + buyerName, keeping other fields", () => {
    const out = withThreadBuyer(threads, 0, null);
    expect(out[0]).toEqual({ terms: "западна дъга", distinctive: ["дъга"] });
    expect(out[0]).not.toHaveProperty("buyerEik");
  });
});

describe("matchInhouseContractors — the blind-spot trigger (§0g.2)", () => {
  const rows = [
    { contractorEik: "831646048", contractorName: "Автомагистрали ЕАД" },
    { contractorEik: "831646048", contractorName: "Автомагистрали ЕАД" }, // dup
    { contractorEik: "111", contractorName: "Частна фирма" },
    { contractorEik: null, contractorName: "без ЕИК" },
  ];
  it("returns one deduped entry per in-house contractor present among members", () => {
    const hit = matchInhouseContractors(rows, ["831646048"]);
    expect(hit).toEqual([{ eik: "831646048", name: "Автомагистрали ЕАД" }]);
  });
  it("is empty when no member is contracted to an in-house EIK, or the set is empty", () => {
    expect(matchInhouseContractors(rows, ["999"])).toEqual([]);
    expect(matchInhouseContractors(rows, [])).toEqual([]);
  });
  it("falls back to the EIK when the contractor name is missing", () => {
    const hit = matchInhouseContractors(
      [{ contractorEik: "222", contractorName: null }],
      ["222"],
    );
    expect(hit).toEqual([{ eik: "222", name: "222" }]);
  });
});

describe("resolveSeedIds — (autoIn ∪ includes) − excludes", () => {
  const scored = [
    { id: "a", score: 0.9, threshold: 0.6 }, // auto-in
    { id: "b", score: 0.3, threshold: 0.6 }, // below threshold
    { id: "c", score: 0.8, threshold: 0.6 }, // auto-in
  ];
  it("includes above-threshold, force-adds includes, removes excludes", () => {
    const seed = resolveSeedIds(scored, ["b"], ["c"]);
    expect(new Set(seed)).toEqual(new Set(["a", "b"]));
  });
  it("exclude wins even over an include", () => {
    expect(resolveSeedIds(scored, ["a"], ["a"])).not.toContain("a");
  });
  it("empty everything → empty (the fetch layer must guard this)", () => {
    expect(resolveSeedIds([], [], [])).toEqual([]);
  });
});

describe("siblingLotPolicy — the over-expansion guard (§2)", () => {
  it("auto-includes all siblings for a genuinely split object", () => {
    expect(siblingLotPolicy(2)).toBe("all");
    expect(siblingLotPolicy(1)).toBe("all");
    expect(siblingLotPolicy(null)).toBe("all"); // single-lot default
  });
  it("only the matched lot for a framework (many lots)", () => {
    expect(siblingLotPolicy(28)).toBe("matched-only");
  });
  it("respects a custom guard", () => {
    expect(siblingLotPolicy(5, 10)).toBe("all");
  });
});

describe("lotNumberOf", () => {
  it("parses the lot number from the title prefix", () => {
    expect(lotNumberOf("Строителство …, Обособена позиция 2: участък Б")).toBe(
      "2",
    );
    expect(lotNumberOf("Обособена позиция 11: надзор")).toBe("11");
  });
  it("returns null when there is no lot marker", () => {
    expect(lotNumberOf("Строителство на Западна дъга")).toBeNull();
    expect(lotNumberOf(null)).toBeNull();
  });
});

describe("displayLotNumberOf — wider display parser (ОП N shorthand)", () => {
  it("matches both 'Обособена позиция N' and 'ОП N' (with optional №)", () => {
    expect(displayLotNumberOf("Обособена позиция 4: кв. Макак")).toBe("4");
    expect(displayLotNumberOf("ОП 2: в.з. Зелин, АМ „Хемус“")).toBe("2");
    expect(displayLotNumberOf("ОП № 3: с. Мало Бучино")).toBe("3");
  });
  it("returns null with no lot marker (the framework head contract)", () => {
    expect(
      displayLotNumberOf(
        "Определяне на изпълнител за проектиране и строителство",
      ),
    ).toBeNull();
    expect(displayLotNumberOf(null)).toBeNull();
  });
});

describe("matchedContractTotal — the 'search too broad' count (§4.1)", () => {
  const seed = (rowCount: number, total: number | null, totalExact = true) => ({
    rowCount,
    total,
    totalExact,
  });
  it("sums exact contract totals across threads when the contract side hit the cap", () => {
    expect(matchedContractTotal([seed(60, 40), seed(60, 72)], 60)).toBe(112);
  });
  it("is null when the contract side did NOT hit the cap (tender-only truncation)", () => {
    // Neither thread's contract page filled → nothing was trimmed on the contract
    // side, so the count-led banner must not fire (FINDING-001).
    expect(matchedContractTotal([seed(12, 12)], 60)).toBeNull();
  });
  it("is null when any thread's total is unavailable", () => {
    expect(matchedContractTotal([seed(60, 40), seed(60, null)], 60)).toBeNull();
  });
  it("is null when any thread's total is an estimate, never summing reltuples", () => {
    expect(
      matchedContractTotal([seed(60, 40), seed(60, 9999, false)], 60),
    ).toBeNull();
  });
});

describe("seeAllContractsHref — the 'view all' escape hatch (§4.1)", () => {
  it("links terms + full corpus scope, URL-encoding the Cyrillic query", () => {
    expect(seeAllContractsHref({ terms: "хемус" })).toBe(
      "/procurement/contracts?q=%D1%85%D0%B5%D0%BC%D1%83%D1%81&pscope=all",
    );
  });
  it("carries the thread's buyerEik through as ?awarder= so the buyer scope matches", () => {
    expect(
      seeAllContractsHref({ terms: "хемус", buyerEik: ["000695089"] }),
    ).toBe(
      "/procurement/contracts?q=%D1%85%D0%B5%D0%BC%D1%83%D1%81&pscope=all&awarder=000695089",
    );
  });
  it("joins a multi-EIK buyer scope with a comma", () => {
    const href = seeAllContractsHref({ terms: "x", buyerEik: ["1", "2"] });
    expect(href).toContain("&awarder=1%2C2");
  });
  it("returns null when there is nothing to link (missing/blank terms)", () => {
    expect(seeAllContractsHref(undefined)).toBeNull();
    expect(seeAllContractsHref({ terms: "  " })).toBeNull();
  });
});

describe("foldContractsByLot — procedure→lot→contract tree (§4.2)", () => {
  it("groups by title lot number even when lot_name is absent, ordered numerically", () => {
    const contracts = [
      { title: "ОП 2: в.з. Зелин", lotName: null }, // no DB lot_name
      { title: "Обособена позиция 4: кв. Макак", lotName: "кв. Макак" },
      { title: "Обособена позиция 4: кв. Макак", lotName: "кв. Макак" },
      { title: "ОП 10: последен участък", lotName: null }, // numeric, not string, order
      { title: "Рамково: инженеринг (без ОП)", lotName: null }, // no lot → noLot
    ];
    const { lots, noLot } = foldContractsByLot(contracts);
    expect(lots.map((l) => l.lotNo)).toEqual(["2", "4", "10"]); // 10 after 4, not before
    expect(lots.find((l) => l.lotNo === "4")?.contracts).toHaveLength(2);
    // lotName is picked up from the first member that carries one.
    expect(lots.find((l) => l.lotNo === "4")?.lotName).toBe("кв. Макак");
    expect(lots.find((l) => l.lotNo === "2")?.lotName).toBeNull();
    expect(noLot).toHaveLength(1);
  });
});

describe("dedup", () => {
  it("dedups contracts by key, tenders by unp, funds by contractNumber", () => {
    expect(
      dedupContracts([{ key: "x" }, { key: "x" }, { key: "y" }]),
    ).toHaveLength(2);
    expect(dedupTenders([{ unp: "u1" }, { unp: "u1" }])).toHaveLength(1);
    const f = dedupFunds([
      { contractNumber: "BG-1", title: "a" },
      { contractNumber: "BG-1", title: "dup" }, // dropped, first kept
      { contractNumber: "BG-2", title: "b" },
    ]);
    expect(f.map((x) => x.contractNumber)).toEqual(["BG-1", "BG-2"]);
    expect(f[0].title).toBe("a");
  });
});

describe("foldMembers — the money fold (§4.1 step 3)", () => {
  const rows: FoldInput[] = [
    {
      key: "k1",
      tag: "contract",
      amountEur: 461_400_000,
      procurementMethod: "Вътрешен конкурентен избор по РС",
      numberOfTenderers: 1,
      date: "2020-10-02",
      contractorEik: "831646048",
    },
    {
      key: "k2",
      tag: "contract",
      amountEur: 39_500_000,
      procurementMethod: "Открита процедура",
      numberOfTenderers: 4,
      date: "2015-10-23",
      contractorEik: "111",
    },
    {
      key: "k3",
      tag: "contract",
      amountEur: 10_000_000,
      procurementMethod: "",
      numberOfTenderers: null,
      date: "2016-01-01",
      contractorEik: "111",
    },
    // amendment row must be excluded from the spend fold
    {
      key: "k4",
      tag: "contractAmendment",
      amountEur: 999_999,
      date: "2021-01-01",
    },
    // duplicate key must dedup
    { key: "k1", tag: "contract", amountEur: 461_400_000, date: "2020-10-02" },
  ];

  it("sums amountEur over deduped tag='contract' rows only", () => {
    const f = foldMembers(rows);
    expect(f.contractCount).toBe(3);
    expect(f.totalContractedEur).toBe(461_400_000 + 39_500_000 + 10_000_000);
  });
  it("splits the method mix with blanks in their own bucket", () => {
    const f = foldMembers(rows);
    expect(f.methodMix.nonCompetitive).toBe(461_400_000);
    expect(f.methodMix.competitive).toBe(39_500_000);
    expect(f.methodMix.unspecified).toBe(10_000_000);
  });
  it("counts single-bid and distinct contractors, and groups by year", () => {
    const f = foldMembers(rows);
    expect(f.singleBidCount).toBe(1);
    expect(f.contractorCount).toBe(2);
    expect(f.byYear["2020"]).toBe(461_400_000);
    expect(f.byYear["2015"]).toBe(39_500_000);
  });
});

describe("foldByPeriod — recurring-project rollup (§4.2.2b)", () => {
  const rows: FoldInput[] = [
    {
      key: "a",
      tag: "contract",
      amountEur: 100,
      date: "2021-05-01",
      procurementMethod: "Открита процедура",
      contractorName: "Печатница А",
    },
    {
      key: "b",
      tag: "contract",
      amountEur: 300,
      date: "2021-09-01",
      procurementMethod: "Договаряне без предварително обявление",
      contractorName: "Сиела",
    },
    {
      key: "c",
      tag: "contract",
      amountEur: 50,
      date: "2016-03-01",
      procurementMethod: "Открита процедура",
      contractorName: "Печатница А",
    },
    // amendment + undated rows are excluded
    { key: "d", tag: "contractAmendment", amountEur: 999, date: "2021-01-01" },
    { key: "e", tag: "contract", amountEur: 7, date: null },
  ];
  it("groups spend by year, chronologically, with per-year totals and counts", () => {
    const p = foldByPeriod(rows);
    expect(p.map((x) => x.period)).toEqual(["2016", "2021"]);
    expect(p[1].totalEur).toBe(400);
    expect(p[1].contractCount).toBe(2);
  });
  it("picks the top contractor by Σ amount within the period", () => {
    const p = foldByPeriod(rows);
    expect(p[1].topContractorName).toBe("Сиела");
    expect(p[1].topContractorEur).toBe(300);
  });
  it("splits the method mix per period", () => {
    const p = foldByPeriod(rows);
    expect(p[1].methodMix.competitive).toBe(100);
    expect(p[1].methodMix.nonCompetitive).toBe(300);
  });
  it("falls back to contractorEik when the name is missing", () => {
    const p = foldByPeriod([
      {
        key: "x",
        tag: "contract",
        amountEur: 10,
        date: "2022-01-01",
        contractorEik: "123",
      },
    ]);
    expect(p[0].topContractorName).toBe("123");
  });
  it("dedups member rows by key before bucketing", () => {
    const p = foldByPeriod([
      { key: "dup", tag: "contract", amountEur: 10, date: "2022-01-01" },
      { key: "dup", tag: "contract", amountEur: 10, date: "2022-01-01" },
    ]);
    expect(p[0].contractCount).toBe(1);
    expect(p[0].totalEur).toBe(10);
  });
  it("breaks a top-contractor Σ tie by name, order-independently", () => {
    const mk = (name: string): FoldInput => ({
      key: name,
      tag: "contract",
      amountEur: 10,
      date: "2022-01-01",
      contractorName: name,
    });
    expect(foldByPeriod([mk("Б"), mk("А")])[0].topContractorName).toBe("А");
    expect(foldByPeriod([mk("А"), mk("Б")])[0].topContractorName).toBe("А");
  });
});
