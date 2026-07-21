import { describe, it, expect } from "vitest";
import {
  scoreConfidence,
  bestConfidence,
  classifyMethod,
  isSingleBid,
  annexDelta,
  resolveSeedIds,
  siblingLotPolicy,
  lotNumberOf,
  dedupContracts,
  dedupTenders,
  foldMembers,
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

describe("dedup", () => {
  it("dedups contracts by key, tenders by unp", () => {
    expect(
      dedupContracts([{ key: "x" }, { key: "x" }, { key: "y" }]),
    ).toHaveLength(2);
    expect(dedupTenders([{ unp: "u1" }, { unp: "u1" }])).toHaveLength(1);
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
