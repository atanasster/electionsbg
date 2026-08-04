import { describe, expect, it } from "vitest";
import { buildEntityIndex, searchIndex } from "./entitySearchIndex";
import { skeletonCacheSize } from "./translitSearch";

type Hospital = {
  eik: string;
  name: string;
  place: string;
  spend: number;
};

const HOSPITALS: Hospital[] = [
  { eik: "115576405", name: "УМБАЛ Свети Георги", place: "Пловдив", spend: 40 },
  { eik: "831605806", name: "УМБАЛ Александровска", place: "София", spend: 30 },
  { eik: "000090697", name: "МБАЛ Шумен", place: "Шумен", spend: 20 },
  { eik: "813154075", name: "УМБАЛ Света Марина", place: "Варна", spend: 10 },
  { eik: "107507105", name: "МБАЛ Христо Ботев", place: "Враца", spend: 5 },
];

const index = (items: Hospital[] = HOSPITALS) =>
  buildEntityIndex(
    items,
    (h) => ({
      id: h.eik,
      label: h.name,
      sub: h.place,
      href: `/company/${h.eik}`,
    }),
    (h) => [h.name, h.place, h.eik],
    (h) => h.spend,
  );

describe("buildEntityIndex", () => {
  it("keeps rows and folds parallel", () => {
    const idx = index();
    expect(idx.rows).toHaveLength(HOSPITALS.length);
    expect(idx.folds).toHaveLength(HOSPITALS.length);
  });

  it("sorts by rank descending so scan-and-stop returns the largest", () => {
    expect(index().rows.map((r) => r.label)).toEqual([
      "УМБАЛ Свети Георги",
      "УМБАЛ Александровска",
      "МБАЛ Шумен",
      "УМБАЛ Света Марина",
      "МБАЛ Христо Ботев",
    ]);
  });

  it("preserves input order when no rank is given", () => {
    const idx = buildEntityIndex(
      HOSPITALS,
      (h) => ({ id: h.eik, label: h.name, href: `/company/${h.eik}` }),
      (h) => [h.name],
    );
    expect(idx.rows.map((r) => r.label)).toEqual(HOSPITALS.map((h) => h.name));
  });

  it("does not mutate the caller's array", () => {
    const items = [...HOSPITALS];
    index(items);
    expect(items).toEqual(HOSPITALS);
  });

  it("drops nullish keys instead of folding them", () => {
    const idx = buildEntityIndex(
      [{ name: "Тест", place: null as string | null }],
      (x) => ({ id: "1", label: x.name, href: "/x/1" }),
      (x) => [x.name, x.place, undefined],
    );
    expect(idx.folds).toEqual(["test"]);
  });

  it("drops a row no query could ever reach, and counts the drop", () => {
    // All-punctuation keys fold to "", so the row is unreachable — carrying it
    // would cost an includes() on every later scan for nothing. The count is
    // what keeps `rows.length` from being read as a population figure.
    const idx = buildEntityIndex(
      [{ name: "—" }, { name: "Пловдив" }],
      (x) => ({ id: x.name, label: x.name, href: "/x" }),
      (x) => [x.name],
    );
    expect(idx.rows.map((r) => r.label)).toEqual(["Пловдив"]);
    expect(idx.dropped).toBe(1);
    expect(idx.rows.length + idx.dropped).toBe(2);
  });

  it("keeps rows and folds aligned across a drop", () => {
    // The parallel-array invariant: searchIndex returns rows[i] for a hit at
    // folds[i], so a drop that advanced one array and not the other would
    // return a plausible WRONG entity rather than crashing.
    const idx = buildEntityIndex(
      [
        { n: "Първи", r: 3 },
        { n: "—", r: 2 },
        { n: "Трети", r: 1 },
      ],
      (x) => ({ id: x.n, label: x.n, href: `/x/${x.n}` }),
      (x) => [x.n],
      (x) => x.r,
    );
    expect(idx.rows).toHaveLength(idx.folds.length);
    expect(searchIndex(idx, "treti")[0].label).toBe("Трети");
    expect(searchIndex(idx, "parvi")[0].label).toBe("Първи");
  });

  it("keeps input order for equal ranks (stable sort)", () => {
    // Contract 2's "largest first" leans on this whenever ranks tie — a sector
    // where several entities have zero spend is the common case.
    const items = ["А", "Б", "В", "Г"].map((n) => ({ n, r: 0 }));
    const idx = buildEntityIndex(
      items,
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
      (x) => x.r,
    );
    expect(idx.rows.map((r) => r.label)).toEqual(["А", "Б", "В", "Г"]);
  });

  it("calls rank once per item, not once per comparison", () => {
    // A comparator calling rank directly evaluates it ~22x per row. Harmless
    // for a stored field, 5.6ms -> 3.4ms for a rank the caller derives.
    let calls = 0;
    const items = Array.from({ length: 50 }, (_, i) => ({ n: `Ред ${i}` }));
    buildEntityIndex(
      items,
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
      () => {
        calls++;
        return 1;
      },
    );
    expect(calls).toBe(items.length);
  });

  it("does NOT touch the shared fold memo", () => {
    // THE PERF CONTRACT. The memo's 50k cap with half-eviction is sized for the
    // DataTable's distinct-cell working set; an index pushing its own thousands
    // of strings through it would evict that set and re-introduce the
    // 50ms-per-pass regression the memo exists to prevent. buildEntityIndex
    // keeps its own copy, so it must use latinSkeleton, not the cached variant.
    const before = skeletonCacheSize();
    buildEntityIndex(
      HOSPITALS,
      (h) => ({ id: h.eik, label: h.name, href: `/company/${h.eik}` }),
      (h) => [h.name, h.place, h.eik],
    );
    expect(skeletonCacheSize()).toBe(before);
  });
});

describe("searchIndex", () => {
  it("finds by name, place and code alike", () => {
    expect(searchIndex(index(), "sveti georgi")[0].label).toBe(
      "УМБАЛ Свети Георги",
    );
    expect(searchIndex(index(), "варна")[0].label).toBe("УМБАЛ Света Марина");
    expect(searchIndex(index(), "115576405")[0].label).toBe(
      "УМБАЛ Свети Георги",
    );
  });

  it("accepts shliokavitsa", () => {
    // "6umen" is the whole point: the fold alone cannot reach Шумен from Latin.
    expect(searchIndex(index(), "6umen")[0].label).toBe("МБАЛ Шумен");
    expect(searchIndex(index(), "plowdiw")[0].label).toBe("УМБАЛ Свети Георги");
  });

  it("puts a shliokavitsa hit in the PREFIX tier, not just the contains tier", () => {
    // The alternate needle has to be tried against prefixHit as well as
    // includes, or a shlyo query silently loses its ranking: "6umen" would
    // rank МБАЛ Шумен below a higher-ranked mid-key match.
    const idx = buildEntityIndex(
      [
        { n: "Клиника Пришуменска", r: 100 },
        { n: "Шумен Мед", r: 1 },
      ],
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
      (x) => x.r,
    );
    expect(searchIndex(idx, "6umen")[0].label).toBe("Шумен Мед");
  });

  it("matches a query that spans two keys", () => {
    // The natural query for a row rendering `label` over `sub`. The folds carry
    // SEP between keys while latinSkeleton strips whitespace, so a single
    // folded needle can never span them — the query has to be split per term.
    expect(searchIndex(index(), "света марина варна")[0].label).toBe(
      "УМБАЛ Света Марина",
    );
    expect(searchIndex(index(), "sveta marina varna")[0].label).toBe(
      "УМБАЛ Света Марина",
    );
    expect(searchIndex(index(), "шумен 000090697")[0].label).toBe("МБАЛ Шумен");
  });

  it("requires EVERY term, not any", () => {
    // AND, not OR: a name from one hospital plus a place from another must not
    // match either. OR semantics would make a two-word query broader than a
    // one-word one, which reads as noise.
    expect(searchIndex(index(), "марина пловдив")).toEqual([]);
  });

  it("tolerates leading, trailing and repeated whitespace", () => {
    expect(searchIndex(index(), "  света   марина  ")[0].label).toBe(
      "УМБАЛ Света Марина",
    );
  });

  it("does not touch the shared fold memo on the SEARCH path either", () => {
    // The hot path. Build-time folding is already fenced above; a search folds
    // only the query, which must not enter the memo sized for DataTable cells.
    const idx = index();
    const before = skeletonCacheSize();
    searchIndex(idx, "света марина варна");
    searchIndex(idx, "6umen");
    expect(skeletonCacheSize()).toBe(before);
  });

  it("ranks a key-prefix hit above a mid-key hit", () => {
    const idx = buildEntityIndex(
      [
        { n: "Пловдивско шосе", rank: 100 },
        { n: "Пловдив", rank: 1 },
      ],
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
      (x) => x.rank,
    );
    // "shose" appears in both folds, but only starts a key in the first — while
    // rank puts that row first anyway. The discriminating case is the reverse:
    expect(searchIndex(idx, "plovdiv").map((r) => r.label)).toEqual([
      "Пловдивско шосе",
      "Пловдив",
    ]);
    // The discriminating case: a mid-key match must LOSE to a key-prefix match
    // even though it outranks it 100:1.
    const idx2 = buildEntityIndex(
      [
        { n: "Клиника Загорска", rank: 100 },
        { n: "Загора Мед", rank: 1 },
      ],
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
      (x) => x.rank,
    );
    expect(searchIndex(idx2, "zagor")[0].label).toBe("Загора Мед");
  });

  it("treats a multi-word name as ONE token — only KEYS make boundaries", () => {
    // latinSkeleton strips whitespace, so "Стара Загора" folds to
    // "starazagora": a query for "zagora" matches INSIDE it, not at a boundary.
    // Pass the parts as separate keys when each should be prefix-matchable.
    const oneKey = buildEntityIndex(
      [{ n: "Стара Загора" }],
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
    );
    const twoKeys = buildEntityIndex(
      [{ a: "Стара", b: "Загора" }],
      (x) => ({ id: x.a, label: `${x.a} ${x.b}`, href: "/x" }),
      (x) => [x.a, x.b],
    );
    expect(oneKey.folds).toEqual(["starazagora"]);
    expect(twoKeys.folds).toEqual(["stara zagora"]);
    // Both still MATCH; they differ only in which tier they land in.
    expect(searchIndex(oneKey, "zagora")).toHaveLength(1);
    expect(searchIndex(twoKeys, "zagora")).toHaveLength(1);
  });

  it("matches the start of ANY key, not just the first", () => {
    // The fold is "umbalsvetamarina varna 813154075" — "varna" starts the
    // SECOND key. Without the separator-aware prefix test this would be
    // demoted to a contains hit.
    const idx = buildEntityIndex(
      [
        { n: "Клиника Варненска", place: "София", rank: 1 },
        { n: "УМБАЛ Света Марина", place: "Варна", rank: 100 },
      ],
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n, x.place],
      (x) => x.rank,
    );
    expect(searchIndex(idx, "varna")[0].label).toBe("УМБАЛ Света Марина");
  });

  it("caps at the limit, largest first", () => {
    const got = searchIndex(index(), "бал", 2);
    expect(got).toHaveLength(2);
    expect(got.map((r) => r.label)).toEqual([
      "УМБАЛ Свети Георги",
      "УМБАЛ Александровска",
    ]);
  });

  it("returns [] for an empty, all-punctuation or absent input", () => {
    expect(searchIndex(index(), "")).toEqual([]);
    expect(searchIndex(index(), "!!")).toEqual([]);
    expect(searchIndex(null, "бал")).toEqual([]);
    expect(searchIndex(undefined, "бал")).toEqual([]);
    expect(searchIndex(index(), "бал", 0)).toEqual([]);
  });

  it("returns [] rather than everything when nothing matches", () => {
    expect(searchIndex(index(), "zzzz")).toEqual([]);
  });

  it("does not let the contains tier starve a later prefix hit", () => {
    // 20 mid-key matches ranked above one key-prefix match. A scan that stopped
    // as soon as it had `limit` rows of ANY tier would return only the
    // contains hits and never see the better one.
    const items = [
      ...Array.from({ length: 20 }, (_, i) => ({
        n: `Клиника Софийска ${i}`,
        rank: 100 - i,
      })),
      { n: "София Мед", rank: 1 },
    ];
    const idx = buildEntityIndex(
      items,
      (x) => ({ id: x.n, label: x.n, href: "/x" }),
      (x) => [x.n],
      (x) => x.rank,
    );
    expect(searchIndex(idx, "sofiya", 3)[0].label).toBe("София Мед");
  });
});
