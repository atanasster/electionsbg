// Unit gate for the cross-source duplicate analysis (cross_source.ts) — the module BOTH the
// read-only harness and the reconciliation pass run on.
//
// Hermetic: synthetic rows only, no shards and no database. That is deliberate. The corpus gates
// (single_source_per_contract.data.test.ts) prove the analysis reaches the right answer on the
// data we have; this file proves it reaches the right answer on the cases the data does not
// currently contain — the ones that destroyed rows in earlier attempts and would destroy them
// again the day a feed changes shape.
//
// Every negative case below corresponds to a specific failed design recorded in
// docs/plans/procurement-foreign-consortium-members-v1.md §9 / §10.1.

import { describe, expect, test } from "vitest";
import { feedOf, feedRank } from "./content_key";
import {
  analyzeCrossSource,
  identityE,
  isSyntheticCarrier,
  sideKey,
  signingDay,
} from "./cross_source";
import type { Contract } from "./types";

let seq = 0;

/** A minimally-populated Contract. `releaseId` drives the feed, so callers pass its prefix. */
const row = (o: {
  feed: "ocds" | "aop" | "eop" | "rop";
  unp?: string;
  contractId?: string;
  eik?: string;
  eur?: number;
  signed?: string;
  tag?: Contract["tag"];
}): Contract => {
  const feedPrefix = {
    ocds: "ocds-e",
    aop: "aop-legacy-",
    eop: "eop-",
    rop: "rop-",
  }[o.feed];
  seq += 1;
  return {
    key: `k${seq}`,
    ocid: `ocid-${seq}`,
    releaseId: `${feedPrefix}${seq}`,
    contractId: o.contractId ?? "C1",
    tag: o.tag ?? "contract",
    date: "2020-01-01",
    dateSigned: o.signed === undefined ? "2020-01-01" : o.signed,
    awarderEik: "000000001",
    awarderName: "buyer",
    contractorEik: o.eik ?? "111111111",
    contractorName: "supplier",
    amountEur: o.eur === undefined ? 1000 : o.eur,
    unp: o.unp ?? "00001-2020-0001",
    title: "t",
    bundleUuid: "b",
    sourceUrl: "u",
  } as Contract;
};

// `feedOf` / `feedRank` are covered where they live, in content_key.test.ts — this file only
// relies on them, and a second near-verbatim copy of those assertions would drift.

describe("identity E", () => {
  test("is null whenever any component is missing", () => {
    expect(identityE(row({ feed: "aop" }))).toBeTruthy();
    expect(identityE({ ...row({ feed: "aop" }), unp: undefined })).toBeNull();
    expect(
      identityE({ ...row({ feed: "aop" }), contractorEik: "" }),
    ).toBeNull();
    expect(
      identityE({ ...row({ feed: "aop" }), amountEur: undefined }),
    ).toBeNull();
    expect(
      identityE({ ...row({ feed: "aop" }), dateSigned: undefined }),
    ).toBeNull();
  });

  test("a zero amount is a real amount, not a missing one", () => {
    // €0 rows are consortium members after 087. They must still be matchable — treating 0 as
    // absent would make every member row unmatchable on the Postgres side.
    expect(identityE({ ...row({ feed: "aop" }), amountEur: 0 })).toBeTruthy();
  });

  test("does NOT carry contract_id — that is the whole point", () => {
    const a = row({ feed: "aop", contractId: "32038" });
    const b = row({ feed: "eop", contractId: "СОА21-ДГ55-32" });
    expect(identityE(a)).toBe(identityE(b));
    expect(sideKey(a)).not.toBe(sideKey(b));
  });

  test("rounds the amount, and truncates a timestamped signing date to the day", () => {
    expect(identityE(row({ feed: "aop", eur: 1000.4 }))).toBe(
      identityE(row({ feed: "eop", eur: 1000.49 })),
    );
    expect(
      signingDay({
        ...row({ feed: "aop" }),
        dateSigned: "2020-01-01T09:30:00Z",
      }),
    ).toBe("2020-01-01");
  });
});

describe("the negative cases that killed earlier designs", () => {
  test("same procedure + supplier + amount on DIFFERENT days does not match", () => {
    // The >3-month tail: 97 groups / €85.8m under identity C, only 22% carrying a framework
    // signal. A date-free key swallows all of it.
    const r = analyzeCrossSource([
      row({ feed: "aop", signed: "2020-01-01" }),
      row({ feed: "eop", signed: "2020-06-01" }),
    ]);
    expect(r.groups).toHaveLength(0);
    expect(r.evictions).toHaveLength(0);
  });

  test("two lots, same day and amount, DIFFERENT suppliers do not match", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", eik: "111111111" }),
      row({ feed: "eop", eik: "222222222" }),
    ]);
    expect(r.groups).toHaveLength(0);
  });

  test("different procedures sharing a contract number do not match", () => {
    // The key that destroyed 46 legitimate rows / €5.15m: buyer 000133634 alone had six
    // distinct procedures numbered "1".
    const r = analyzeCrossSource([
      row({ feed: "aop", unp: "00001-2020-0001", contractId: "1" }),
      row({ feed: "rop", unp: "00002-2020-0002", contractId: "1" }),
    ]);
    expect(r.groups).toHaveLength(0);
  });

  test("rows of the SAME feed never pair with each other", () => {
    const r = analyzeCrossSource([
      row({ feed: "eop", contractId: "A" }),
      row({ feed: "eop", contractId: "B" }),
    ]);
    expect(r.groups).toHaveLength(0);
    expect(r.evictions).toHaveLength(0);
  });

  test("a contract and its amendment are different tags and never pair", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", tag: "contract" }),
      row({ feed: "eop", tag: "contractAmendment" }),
    ]);
    expect(r.groups).toHaveLength(0);
  });

  test("synthetic obed- carriers are excluded, never evicted", () => {
    const carrier = { ...row({ feed: "eop" }), contractorEik: "obed-abc123" };
    expect(isSyntheticCarrier(carrier)).toBe(true);
    const r = analyzeCrossSource([
      { ...row({ feed: "aop" }), contractorEik: "obed-abc123" },
      carrier,
    ]);
    expect(r.evictions).toHaveLength(0);
  });
});

describe("all six feed pairs are detected", () => {
  const FEEDS = ["ocds", "aop", "eop", "rop"] as const;
  const pairs = FEEDS.flatMap((a, i) =>
    FEEDS.slice(i + 1).map((b) => [a, b] as const),
  );

  test("there are six of them", () => {
    expect(pairs).toHaveLength(6);
  });

  test.each(pairs)(
    "%s + %s pairs and evicts the lower-precedence side",
    (a, b) => {
      const ra = row({ feed: a, contractId: `${a}-num` });
      const rb = row({ feed: b, contractId: `${b}-num` });
      const r = analyzeCrossSource([ra, rb]);
      expect(r.groups).toHaveLength(1);
      expect(r.evictions).toHaveLength(1);
      // The survivor is the higher-precedence feed, and it is NAMED — never inferred.
      const [ev] = r.evictions;
      const winner = feedRank(ra) < feedRank(rb) ? ra : rb;
      const loser = winner === ra ? rb : ra;
      expect(ev.row).toBe(loser);
      expect(ev.survivor).toBe(winner);
    },
  );
});

describe("side-pair preconditions", () => {
  test("blocks when the two sides' supplier sets differ", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A", eik: "111111111" }),
      row({ feed: "aop", contractId: "A", eik: "999999999", eur: 5 }),
      row({ feed: "eop", contractId: "B", eik: "111111111" }),
    ]);
    expect(r.evictions).toHaveLength(0);
    expect(r.blocked).toHaveLength(1);
    expect(r.blocked[0].blockedReason).toMatch(/supplier sets differ/);
  });

  test("blocks when only some of the LOSER's rows have a twin", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A", eik: "111111111" }),
      row({ feed: "eop", contractId: "B", eik: "111111111" }),
      // second eop row, same side, no aop twin (different amount)
      row({ feed: "eop", contractId: "B", eik: "111111111", eur: 7777 }),
    ]);
    expect(r.evictions).toHaveLength(0);
    expect(r.blocked[0].blockedReason).toMatch(/of the loser's/);
  });

  test("blocks when only some of the WINNER's rows are matched", () => {
    // 00303-2020-0018 in the live corpus: identical supplier sets, totals agreeing to €1.19,
    // and still blocked — because evicting a side on a partial match is the shape that
    // orphaned rows in v1.
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A", eik: "111111111" }),
      row({ feed: "aop", contractId: "A", eik: "111111111", eur: 4242 }),
      row({ feed: "eop", contractId: "B", eik: "111111111" }),
    ]);
    expect(r.evictions).toHaveLength(0);
    expect(r.blocked[0].blockedReason).toMatch(/of the winner's/);
  });

  test("evicts a whole side when both sides are fully paired", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A", eik: "111111111", eur: 100 }),
      row({ feed: "aop", contractId: "A", eik: "222222222", eur: 200 }),
      row({ feed: "eop", contractId: "B", eik: "111111111", eur: 100 }),
      row({ feed: "eop", contractId: "B", eik: "222222222", eur: 200 }),
    ]);
    expect(r.blocked).toHaveLength(0);
    expect(r.evictions).toHaveLength(2);
    expect(r.evictions.every((e) => feedOf(e.row) === "eop")).toBe(true);
    expect(r.evictions.every((e) => feedOf(e.survivor) === "aop")).toBe(true);
  });
});

describe("ambiguous groups — no 1:1 twin correspondence", () => {
  test("a feed contributing two rows to one group blocks the whole group", () => {
    // 01071-2020-0009 in the live corpus: ЦАИС published four call-offs ("Договор № 878..881")
    // at the same procedure, supplier, amount and date against two aop rows. Nothing says which
    // corresponds to which, and with 4 against 2, two of them correspond to nothing.
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A1" }),
      row({ feed: "eop", contractId: "E1" }),
      row({ feed: "eop", contractId: "E2" }),
    ]);
    expect(r.groups).toHaveLength(1);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.evictions).toHaveLength(0);
    expect(r.sidePairs).toHaveLength(0);
  });

  test("an N:N fan is still ambiguous — equal counts are not a correspondence", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A1" }),
      row({ feed: "aop", contractId: "A2" }),
      row({ feed: "eop", contractId: "E1" }),
      row({ feed: "eop", contractId: "E2" }),
    ]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.evictions).toHaveLength(0);
  });

  test("one row per feed is unambiguous and IS acted on", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", contractId: "A1" }),
      row({ feed: "eop", contractId: "E1" }),
    ]);
    expect(r.ambiguous).toHaveLength(0);
    expect(r.evictions).toHaveLength(1);
  });
});

describe("evictions are one per distinct row", () => {
  test("a losing side eligible against two winners is listed once, not twice", () => {
    // The defect this pins: iterating side-pairs and pushing each loser row emitted a row once
    // PER PAIR. Measured on the corpus, 94 entries for 90 rows — a €1.24m over-statement inside
    // the verification that is supposed to make the eviction trustworthy.
    const shared = row({ feed: "eop", contractId: "E1", eur: 100 });
    const other = row({ feed: "eop", contractId: "E2", eur: 200 });
    const r = analyzeCrossSource([
      row({ feed: "ocds", contractId: "O1", eur: 100 }),
      row({ feed: "ocds", contractId: "O2", eur: 200 }),
      shared,
      other,
    ]);
    const seen = r.evictions.map((e) => e.row);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("the eviction total equals the sum over DISTINCT rows", () => {
    const corpus = [
      row({ feed: "ocds", contractId: "O1", eur: 100 }),
      row({ feed: "eop", contractId: "E1", eur: 100 }),
      row({ feed: "ocds", contractId: "O2", eur: 250 }),
      row({ feed: "eop", contractId: "E2", eur: 250 }),
    ];
    const r = analyzeCrossSource(corpus);
    const distinct = new Set(r.evictions.map((e) => e.row));
    const overList = r.evictions.reduce(
      (s, e) => s + (e.row.amountEur ?? 0),
      0,
    );
    const overSet = [...distinct].reduce((s, x) => s + (x.amountEur ?? 0), 0);
    expect(overList).toBe(overSet);
  });
});

describe("the transitivity guard", () => {
  test("a side that both wins and loses blocks its chain instead of orphaning a survivor", () => {
    // ocds > aop > eop over one contract. Resolving both pairs would delete the aop row that
    // the eop eviction names as its survivor — an assertion that passes against a row on its
    // way out. The guard refuses the chain rather than ordering the collapse.
    const r = analyzeCrossSource([
      row({ feed: "ocds", contractId: "O" }),
      row({ feed: "aop", contractId: "A" }),
      row({ feed: "eop", contractId: "E" }),
    ]);
    expect(r.groups).toHaveLength(1);
    const chained = r.blocked.filter((p) =>
      /transitive chain/.test(p.blockedReason ?? ""),
    );
    expect(chained.length).toBeGreaterThan(0);
    // Whatever survives, no eviction may name a survivor that is itself evicted.
    const gone = new Set(r.evictions.map((e) => e.row));
    expect(r.evictions.every((e) => !gone.has(e.survivor))).toBe(true);
  });
});

describe("global invariants over every analysis", () => {
  const corpus = [
    row({
      feed: "aop",
      unp: "A-1",
      contractId: "1",
      eik: "111111111",
      eur: 100,
    }),
    row({
      feed: "eop",
      unp: "A-1",
      contractId: "X",
      eik: "111111111",
      eur: 100,
    }),
    row({
      feed: "ocds",
      unp: "B-1",
      contractId: "9",
      eik: "222222222",
      eur: 50,
    }),
    row({
      feed: "rop",
      unp: "B-1",
      contractId: "9",
      eik: "222222222",
      eur: 50,
    }),
    row({
      feed: "aop",
      unp: "C-1",
      contractId: "5",
      eik: "333333333",
      eur: 70,
    }),
  ];

  test("every eviction names a survivor that is NOT itself evicted", () => {
    const r = analyzeCrossSource(corpus);
    const gone = new Set(r.evictions.map((e) => e.row));
    expect(r.evictions.length).toBeGreaterThan(0);
    for (const e of r.evictions) {
      expect(gone.has(e.survivor)).toBe(false);
      expect(identityE(e.survivor)).toBe(identityE(e.row));
    }
  });

  test("no procedure loses its last row", () => {
    const r = analyzeCrossSource(corpus);
    const gone = new Set(r.evictions.map((e) => e.row));
    const left = corpus.filter((x) => !gone.has(x));
    for (const x of corpus)
      expect(left.some((y) => y.unp === x.unp && y.tag === x.tag)).toBe(true);
  });

  test("a corpus with no cross-feed duplicates is left completely alone", () => {
    const r = analyzeCrossSource([
      row({ feed: "aop", unp: "A-1" }),
      row({ feed: "aop", unp: "B-1" }),
    ]);
    expect(r.groups).toHaveLength(0);
    expect(r.sidePairs).toHaveLength(0);
    expect(r.evictions).toHaveLength(0);
    expect(r.blocked).toHaveLength(0);
  });
});
