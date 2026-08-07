import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import {
  assertFloors,
  assertCacheComplete,
  assertNoShrink,
  buildCorpus,
  MIN_OPERATIONS,
  MIN_BG_PARTNERS,
  type IngestResult,
} from "./ingest";
import { INTERREG_PROGRAMMES, programmeByCode } from "./programmes";
import type { Manifest } from "./crawl";
import {
  isBulgarianPartner,
  BUDGET_BASES,
  INTERREG_PERIODS,
  type InterregIndex,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(__dirname, "../../../data/funds/interreg");

const readCorpus = () => ({
  index: JSON.parse(
    fs.readFileSync(path.join(CORPUS, "index.json"), "utf8"),
  ) as InterregIndex,
  operations: JSON.parse(
    fs.readFileSync(path.join(CORPUS, "operations.json"), "utf8"),
  ),
  partners: JSON.parse(
    fs.readFileSync(path.join(CORPUS, "partners.json"), "utf8"),
  ),
});

const result = (over: Partial<IngestResult> = {}): IngestResult =>
  ({
    operations: Array.from({ length: MIN_OPERATIONS }, (_, i) => ({
      keepId: i,
    })),
    partners: [],
    bgPartners: [],
    index: { bgPartnerCount: MIN_BG_PARTNERS },
    unreadable: 0,
    notAdmitted: 0,
    ...over,
  }) as unknown as IngestResult;

describe("assertFloors — nothing is written below them", () => {
  it("passes at exactly the floor", () => {
    expect(() => assertFloors(result())).not.toThrow();
  });

  // The failure this exists for: a half-filled cache overwriting a good corpus
  // with a smaller one, at exit 0.
  it("refuses a short operation count and names the remedy", () => {
    const r = result({ operations: [{ keepId: 1 }] as never });
    expect(() => assertFloors(r)).toThrow(/below the floor/);
    expect(() => assertFloors(r)).toThrow(/funds:crawl-interreg/);
    expect(() => assertFloors(r)).toThrow(/nothing was written/);
  });

  it("refuses a short Bulgarian partner count even when operations look fine", () => {
    const r = result({
      index: { bgPartnerCount: 10 } as unknown as InterregIndex,
    });
    expect(() => assertFloors(r)).toThrow(/Bulgarian partner rows/);
  });

  it("keeps the floors below the measured corpus, with headroom", () => {
    // 1,954 operations and 1,493 BG rows on 2026-08-07. A floor above either
    // would make an ordinary upstream dip abort the ingest.
    expect(MIN_OPERATIONS).toBeLessThan(1954);
    expect(MIN_BG_PARTNERS).toBeLessThan(1493);
    expect(MIN_OPERATIONS).toBeGreaterThan(1954 * 0.5);
    expect(MIN_BG_PARTNERS).toBeGreaterThan(1493 * 0.5);
  });
});

describe("the committed corpus", () => {
  const { index, operations, partners } = readCorpus();

  it("matches its own index", () => {
    expect(operations.length).toBe(index.operationCount);
    expect(partners.length).toBe(index.partnerCount);
    expect(partners.filter(isBulgarianPartner).length).toBe(
      index.bgPartnerCount,
    );
  });

  it("clears the floors it was written under", () => {
    expect(index.operationCount).toBeGreaterThanOrEqual(MIN_OPERATIONS);
    expect(index.bgPartnerCount).toBeGreaterThanOrEqual(MIN_BG_PARTNERS);
  });

  // Deterministic order is what makes `git diff` on a 4.6 MB file readable.
  it("is sorted deterministically", () => {
    const ops = operations.map((o: { keepId: number }) => o.keepId);
    expect(ops).toEqual([...ops].sort((a, b) => a - b));
    // Tuples, not keepId*1000+seq — that proxy is only a valid ordering while
    // partnerSeq < 1000 (max observed: 22), so it could silently stop testing
    // what it claims.
    const keys: [number, number][] = partners.map(
      (p: { keepId: number; partnerSeq: number }) => [p.keepId, p.partnerSeq],
    );
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  // A per-row stamp made every re-ingest a 4.6 MB diff with nothing changed.
  it("carries the fetch timestamp once, on the index only", () => {
    expect(index.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const o of operations.slice(0, 50))
      expect(o).not.toHaveProperty("sourceFetchedAt");
  });

  it("carries no ekatte — place resolution is loader-side", () => {
    for (const p of partners.slice(0, 200)) {
      expect(p).not.toHaveProperty("ekatte");
      expect(p).not.toHaveProperty("placeBasis");
    }
  });

  // A missing row and a zero row mean opposite things: "we never asked" versus
  // "we asked and keep.eu holds nothing".
  it("has one index row per admitted programme, including the empty ones", () => {
    expect(index.programmes.length).toBe(INTERREG_PROGRAMMES.length);
    const empty = index.programmes.filter((p) => p.operationCount === 0);
    expect(empty.map((p) => p.code).sort()).toEqual([
      "INTERREG-BGRS-2127",
      "INTERREG-ESPON-2127",
    ]);
  });

  it("reconciles every programme's rollup against the rows", () => {
    for (const p of index.programmes) {
      const keys = new Set(
        operations
          .filter((o: { programmeCode: string }) => o.programmeCode === p.code)
          .map((o: { keepId: number }) => o.keepId),
      );
      expect(keys.size, p.code).toBe(p.operationCount);
      const rows = partners.filter((q: { keepId: number }) =>
        keys.has(q.keepId),
      );
      expect(rows.length, p.code).toBe(p.partnerCount);
      const bg = rows.filter(isBulgarianPartner);
      expect(bg.length, p.code).toBe(p.bgPartnerCount);
      expect(
        bg.reduce(
          (a: number, q: { budgetEur: number | null }) =>
            a + (q.budgetEur ?? 0),
          0,
        ),
        p.code,
      ).toBeCloseTo(p.bgBudgetEur, 2);
    }
  });

  // The plan's headline figures, pinned against the artifact rather than a
  // throwaway script (plan §5.1).
  it("reproduces the T0 gate's measured totals", () => {
    expect(index.operationCount).toBe(1954);
    expect(index.partnerCount).toBe(12141);
    expect(index.bgPartnerCount).toBe(1493);
    const bgMoney = partners
      .filter(isBulgarianPartner)
      .reduce(
        (a: number, p: { budgetEur: number | null }) => a + (p.budgetEur ?? 0),
        0,
      );
    expect(bgMoney / 1e6).toBeCloseTo(396.39, 1);
  });

  it("splits the money the way §5.1 records — Tier P is the larger half", () => {
    const bg = partners.filter(isBulgarianPartner);
    const linked = bg.filter((p: { eik: string | null }) => p.eik);
    const money = (rows: { budgetEur: number | null }[]) =>
      rows.reduce((a, p) => a + (p.budgetEur ?? 0), 0);
    // §5.1 measures 71.1%. A band, not a floor: a one-sided bound would not
    // notice Tier P growing to 95% because the EIK arm broke.
    const tierPShare = 1 - money(linked) / money(bg);
    expect(tierPShare).toBeGreaterThan(0.65);
    expect(tierPShare).toBeLessThan(0.78);
  });

  it("has no Bulgarian EIK on a 2014-2020 row", () => {
    const byId = new Map(
      operations.map((o: { keepId: number; period: string }) => [
        o.keepId,
        o.period,
      ]),
    );
    const older = partners.filter(
      (p: { keepId: number }) => byId.get(p.keepId) === "2014-2020",
    );
    expect(older.length).toBeGreaterThan(0);
    expect(older.filter((p: { eik: string | null }) => p.eik).length).toBe(0);
  });
});

describe("buildCorpus, against a fixture cache", () => {
  const FIXTURES = path.join(__dirname, "fixtures");

  it("parses the fixture cache and rolls up every admitted programme", () => {
    const r = buildCorpus({ fetchedAt: "T", dir: FIXTURES });
    expect(r.operations.length).toBe(6);
    expect(r.index.operationCount).toBe(r.operations.length);
    // The roster is the register's, not the corpus's — a programme with no rows
    // still gets a row, because "we asked and got nothing" is a fact.
    expect(r.index.programmes.length).toBe(INTERREG_PROGRAMMES.length);
    expect(r.unreadable).toBe(0);
    expect(r.notAdmitted).toBe(0);
  });

  // These two mean opposite things and must never share a counter: an
  // unadmitted programme is the gate working, an unreadable file is a defect.
  it("counts an unreadable cache file apart from an unadmitted programme", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "interreg-ing-"));
    try {
      fs.copyFileSync(
        path.join(FIXTURES, "33607.json"),
        path.join(tmp, "33607.json"),
      );
      fs.writeFileSync(path.join(tmp, "99999.json"), "{ truncated");
      const r = buildCorpus({ fetchedAt: "T", dir: tmp });
      expect(r.operations.length).toBe(1);
      expect(r.unreadable).toBe(1);
      expect(r.notAdmitted).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("filters rows by --programme without shrinking the programme roster", () => {
    const r = buildCorpus({
      fetchedAt: "T",
      dir: FIXTURES,
      programme: "INTERREG-ROBG-1420",
    });
    expect(new Set(r.operations.map((o) => o.programmeCode))).toEqual(
      new Set(["INTERREG-ROBG-1420"]),
    );
    expect(r.index.programmes.length).toBe(INTERREG_PROGRAMMES.length);
  });

  it("computes the Bulgarian subset once, and the index agrees with it", () => {
    const r = buildCorpus({ fetchedAt: "T", dir: FIXTURES });
    expect(r.bgPartners.length).toBe(r.index.bgPartnerCount);
    expect(r.bgPartners).toEqual(r.partners.filter(isBulgarianPartner));
  });
});

describe("assertCacheComplete — the guard the floors cannot be", () => {
  const manifest = (over: Partial<Manifest> = {}): Manifest =>
    ({
      version: 1,
      walkedAt: "T",
      lastFullWalkAt: "T",
      complete: true,
      indexTotal: 100,
      pagesFetched: 10,
      rows: [1, 2, 3].map((keepId) => ({
        keepId,
        keepProgrammeId: 342,
        programmeCode: "INTERREG-ROBG-2127",
      })),
      ...over,
    }) as Manifest;

  const built = (keepIds: number[]): IngestResult =>
    ({ operations: keepIds.map((keepId) => ({ keepId })) }) as IngestResult;

  it("passes when the corpus holds every manifest row", () => {
    expect(() =>
      assertCacheComplete(built([1, 2, 3]), manifest()),
    ).not.toThrow();
  });

  // Truncating 400 of 1,954 real cache files lost 20.5% of operations and
  // €95.18m — and BOTH absolute floors passed. This is what catches it.
  it("refuses when manifest rows did not parse, and names the ids to re-fetch", () => {
    const r = built([1]);
    expect(() => assertCacheComplete(r, manifest())).toThrow(/did not parse/);
    expect(() => assertCacheComplete(r, manifest())).toThrow(/details-only/);
    expect(() => assertCacheComplete(r, manifest())).toThrow(/2, 3/);
  });

  it("refuses an incomplete manifest outright", () => {
    expect(() =>
      assertCacheComplete(built([1, 2, 3]), manifest({ complete: false })),
    ).toThrow(/incomplete/);
  });

  it("refuses a missing manifest when the cache has content", () => {
    expect(() => assertCacheComplete(built([1, 2, 3]), null)).toThrow(
      /manifest is missing/,
    );
  });
});

describe("assertNoShrink — plan §9 gate 1, applied where it is free", () => {
  let dir: string;
  const write = (index: Partial<InterregIndex>) =>
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  const built = (ops: number, parts: number, bg: number): IngestResult =>
    ({
      operations: Array.from({ length: ops }, (_, i) => ({ keepId: i })),
      partners: Array.from({ length: parts }, () => ({})),
      index: { bgPartnerCount: bg },
    }) as IngestResult;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "interreg-shrink-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("skips on a first run, when there is nothing to compare against", () => {
    expect(() => assertNoShrink(built(10, 20, 5), dir)).not.toThrow();
  });

  it("allows growth and a shrink inside the tolerance", () => {
    write({ operationCount: 100, partnerCount: 200, bgPartnerCount: 50 });
    expect(() => assertNoShrink(built(120, 240, 60), dir)).not.toThrow();
    expect(() => assertNoShrink(built(96, 192, 48), dir)).not.toThrow();
  });

  it.each([
    [80, 200, 50, /operations/],
    [100, 150, 50, /partnerships/],
    [100, 200, 30, /Bulgarian partner rows/],
  ])("refuses a >5%% shrink in any of the three counts", (o, p, b, re) => {
    write({ operationCount: 100, partnerCount: 200, bgPartnerCount: 50 });
    expect(() => assertNoShrink(built(o, p, b), dir)).toThrow(re);
    expect(() => assertNoShrink(built(o, p, b), dir)).toThrow(/--allow-shrink/);
  });

  it("yields to an explicit --allow-shrink", () => {
    write({ operationCount: 100, partnerCount: 200, bgPartnerCount: 50 });
    expect(() => assertNoShrink(built(1, 1, 1), dir, true)).not.toThrow();
  });
});

describe("the committed artifact, against plan §9's checkable gates", () => {
  const { operations, partners } = readCorpus();

  it("gate 10 — every operation is inside the period fence", () => {
    for (const o of operations) expect(INTERREG_PERIODS).toContain(o.period);
  });

  it("gate 11 — every programme code resolves in the curated register", () => {
    const codes = new Set(
      operations.map((o: { programmeCode: string }) => o.programmeCode),
    );
    for (const c of codes)
      expect(programmeByCode(c as string), c as string).toBeDefined();
  });

  it("gate 3 — budget basis is exhaustive, exclusive and agrees with the money", () => {
    const seen = new Set<string>();
    for (const p of partners) {
      expect(BUDGET_BASES).toContain(p.budgetBasis);
      seen.add(p.budgetBasis);
      if (p.budgetBasis === "unpublished") expect(p.budgetEur).toBeNull();
      else if (p.budgetBasis === "published_zero") expect(p.budgetEur).toBe(0);
      else expect(p.budgetEur).toBeGreaterThan(0);
    }
    // All three states are actually present, so the gate is not vacuous.
    expect([...seen].sort()).toEqual([
      "published",
      "published_zero",
      "unpublished",
    ]);
  });

  it("gate 7 — every stored EIK is exactly 9 digits (the ЕГН guard)", () => {
    for (const p of partners) if (p.eik) expect(p.eik).toMatch(/^\d{9}$/);
  });

  it("gate 2 — no partner carries its operation's whole total beside a funded sibling", () => {
    const totals = new Map<number, number | null>(
      operations.map((o: { keepId: number; totalBudgetEur: number | null }) => [
        o.keepId,
        o.totalBudgetEur,
      ]),
    );
    const byOp = new Map<number, { budgetEur: number | null }[]>();
    for (const p of partners) {
      const list = byOp.get(p.keepId) ?? [];
      list.push(p);
      byOp.set(p.keepId, list);
    }
    for (const [keepId, rows] of byOp) {
      const total = totals.get(keepId);
      if (!total || rows.length < 2) continue;
      const carrier = rows.findIndex((p) => p.budgetEur === total);
      if (carrier < 0) continue;
      const others = rows.filter((_, i) => i !== carrier);
      expect(
        others.some((p) => (p.budgetEur ?? 0) > 0),
        `operation ${keepId}`,
      ).toBe(false);
    }
  });

  it("every operation has partner rows, and its partnerCount is honest", () => {
    const counted = new Map<number, number>();
    for (const p of partners)
      counted.set(p.keepId, (counted.get(p.keepId) ?? 0) + 1);
    for (const o of operations) {
      expect(counted.get(o.keepId), `operation ${o.keepId}`).toBe(
        o.partnerCount,
      );
      expect(o.partnerCount, `operation ${o.keepId}`).toBeGreaterThan(0);
    }
  });

  it("is written one row per line, so a one-row change is a one-line diff", () => {
    const lines = fs
      .readFileSync(path.join(CORPUS, "operations.json"), "utf8")
      .trimEnd()
      .split("\n");
    // "[", one line per row, "]"
    expect(lines.length).toBe(operations.length + 2);
    expect(lines[0]).toBe("[");
    expect(lines.at(-1)).toBe("]");
  });
});
