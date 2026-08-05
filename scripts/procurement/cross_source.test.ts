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
  sameFeed,
  sideKey,
  signingDay,
  verifyEviction,
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

describe("the validation protocol fires on each defect it exists for", () => {
  // Each case RESTORES a specific defect and asserts the corresponding problem is reported.
  // A protocol whose checks are never seen to fail is indistinguishable from no protocol —
  // which is exactly what shipped: an assertion filtering a provably-empty list, printing
  // "✓ verification passed" over a corpus it never examined.
  const corpus = (): Contract[] => [
    row({ feed: "aop", unp: "A-1", contractId: "1", eur: 100 }),
    row({ feed: "eop", unp: "A-1", contractId: "X", eur: 100 }),
  ];

  test("a correct eviction reports no problems", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    const gone = new Set(a.evictions.map((e) => e.row));
    const after = before.filter((r) => !gone.has(r));
    expect(verifyEviction({ before, after, analysis: a })).toEqual([]);
  });

  test("catches a row-count delta that disagrees with the eviction count", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    // Nothing actually removed, but an eviction claimed.
    const problems = verifyEviction({ before, after: before, analysis: a });
    expect(problems.join(" ")).toMatch(/row count moved by 0, expected -1/);
  });

  test("catches a € delta that disagrees with Σ evicted", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    const gone = new Set(a.evictions.map((e) => e.row));
    // Right number of rows removed — but the wrong one, so the € cannot reconcile.
    const wrong = before.filter((r) => !gone.has(r));
    const after = [{ ...wrong[0], amountEur: 999 } as Contract];
    expect(verifyEviction({ before, after, analysis: a }).join(" ")).toMatch(
      /€ delta .* ≠ Σ evicted/,
    );
  });

  test("catches a survivor that is itself evicted", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    // Remove BOTH — the survivor no longer survives.
    expect(
      verifyEviction({ before, after: [], analysis: a }).join(" "),
    ).toMatch(/name a survivor that is ITSELF evicted/);
  });

  test("catches a procedure that vanished — even one this pass never selected", () => {
    // Over-deletion from a cause OUTSIDE the eviction set: a shard-write bug removing an
    // unrelated procedure. Scoping this check to evicted rows would make it unreachable (an
    // evicted row's survivor carries the same УНП, so the survivor check already covers that
    // case) — which is precisely the dead-assertion defect v1 §10.8 shipped.
    const before = [...corpus(), row({ feed: "aop", unp: "Z-9", eur: 42 })];
    const a = analyzeCrossSource(before);
    const gone = new Set(a.evictions.map((e) => e.row));
    const after = before.filter((r) => !gone.has(r) && r.unp !== "Z-9");
    const problems = verifyEviction({ before, after, analysis: a }).join(" ");
    expect(problems).toMatch(
      /procedure\(s\) present before are GONE after: Z-9/,
    );
  });

  test("catches an eviction whose survivor was also removed", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    const after = before.filter((r) => r !== a.evictions[0].survivor);
    expect(verifyEviction({ before, after, analysis: a }).join(" ")).toMatch(
      /name a survivor that is ITSELF evicted/,
    );
  });

  test("the orphan check keys on the PROCEDURE, not the contract number", () => {
    // The regression that would silently re-blind the pass: a correct eviction always empties
    // the LOSING side's contract number, because the feeds number the same contract differently.
    // Keying the orphan check on the number therefore flags every correct eviction.
    const before = corpus();
    const a = analyzeCrossSource(before);
    const gone = new Set(a.evictions.map((e) => e.row));
    const after = before.filter((r) => !gone.has(r));
    // The evicted row's contract_id ("X") is now absent from the corpus entirely...
    expect(after.some((r) => r.contractId === "X")).toBe(false);
    // ...and that must NOT be reported as an orphan.
    expect(verifyEviction({ before, after, analysis: a })).toEqual([]);
  });

  test("catches eligible side-pairs that produced no evictions", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    expect(a.sidePairs.filter((p) => p.eligible).length).toBeGreaterThan(0);
    // Same analysis, but the eviction set emptied — the two halves disagreeing.
    const empty = { ...a, evictions: [] };
    expect(
      verifyEviction({ before, after: before, analysis: empty }).join(" "),
    ).toMatch(/eligible side-pair\(s\) produced ZERO evictions/);
  });

  // THE STEADY STATE. This pass runs on every ingest and is chained into db:refresh with `&&`,
  // so it must be idempotent: a second run over the corpus the first run wrote must be a clean
  // no-op. A first version of the eligible-work check counted BLOCKED and AMBIGUOUS items as
  // outstanding candidates — they are permanent by design — so run 2 saw 12 standing candidates
  // against 0 evictions and exited 1, which would have halted every subsequent db:refresh at
  // step 3 of ~40.
  test("is idempotent — a second run over its own output is a clean no-op", () => {
    const before = [
      row({ feed: "aop", unp: "A-1", contractId: "1", eur: 100 }),
      row({ feed: "eop", unp: "A-1", contractId: "X", eur: 100 }),
      // permanently blocked (supplier sets differ)
      row({ feed: "aop", unp: "B-1", contractId: "A", eik: "111111111" }),
      row({
        feed: "aop",
        unp: "B-1",
        contractId: "A",
        eik: "999999999",
        eur: 5,
      }),
      row({ feed: "eop", unp: "B-1", contractId: "B", eik: "111111111" }),
      // permanently ambiguous (one feed contributes two rows)
      row({ feed: "aop", unp: "C-1", contractId: "P", eur: 7 }),
      row({ feed: "eop", unp: "C-1", contractId: "Q", eur: 7 }),
      row({ feed: "eop", unp: "C-1", contractId: "R", eur: 7 }),
    ];
    const run1 = analyzeCrossSource(before);
    expect(run1.evictions.length).toBeGreaterThan(0);
    const gone = new Set(run1.evictions.map((e) => e.row));
    const after = before.filter((r) => !gone.has(r));
    expect(verifyEviction({ before, after, analysis: run1 })).toEqual([]);

    const run2 = analyzeCrossSource(after);
    expect(run2.evictions).toHaveLength(0);
    // The permanent items are STILL there — that is the point.
    expect(run2.blocked.length + run2.ambiguous.length).toBeGreaterThan(0);
    expect(
      verifyEviction({ before: after, after, analysis: run2 }),
      "run 2 must be a clean no-op, or db:refresh halts on every subsequent run",
    ).toEqual([]);
  });

  test("an untouched corpus with no candidates is NOT flagged", () => {
    const before = [row({ feed: "aop", unp: "C-1" })];
    const a = analyzeCrossSource(before);
    expect(verifyEviction({ before, after: before, analysis: a })).toEqual([]);
  });

  // The two defence-in-depth checks: unreachable from analyzeCrossSource today, so they are
  // exercised against hand-built analyses. An untested unreachable check is indistinguishable
  // from one that does not work.
  test("catches a row listed for eviction twice", () => {
    const before = corpus();
    const a = analyzeCrossSource(before);
    const dup = { ...a, evictions: [a.evictions[0], a.evictions[0]] };
    const gone = new Set(dup.evictions.map((e) => e.row));
    const after = before.filter((r) => !gone.has(r));
    expect(verifyEviction({ before, after, analysis: dup }).join(" ")).toMatch(
      /entries for 1 distinct rows/,
    );
  });

  test("catches a survivor whose identity E differs from the evicted row's", () => {
    const before = corpus();
    const unrelated = row({ feed: "aop", unp: "Q-9", eur: 55 });
    const a = analyzeCrossSource(before);
    const bogus = {
      ...a,
      evictions: [{ ...a.evictions[0], survivor: unrelated }],
    };
    const after = [
      ...before.filter((r) => r !== a.evictions[0].row),
      unrelated,
    ];
    expect(
      verifyEviction({ before, after, analysis: bogus }).join(" "),
    ).toMatch(/survivor with a DIFFERENT identity E/);
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

// `sameFeed` measures a class every other net here is blind to, so nothing downstream would
// notice it going wrong. It is measurement only — it evicts nothing — but a wrong figure is what
// this whole plan family exists to prevent, so its grouping is pinned here rather than verified
// by running the harness against a populated database.
describe("sameFeed", () => {
  test("groups two identical same-feed rows and reports n-1 surplus rows", () => {
    const [r] = sameFeed([row({ feed: "aop" }), row({ feed: "aop" })]);
    expect({
      feed: r.feed,
      tag: r.tag,
      groups: r.groups,
      surplusRows: r.surplusRows,
    }).toEqual({ feed: "aop", tag: "contract", groups: 1, surplusRows: 1 });
    // total 2000 − 2000/2: the € beyond one row's share of the group.
    expect(r.surplusEur).toBe(1000);
  });

  test("never groups rows from DIFFERENT feeds — that is the cross-source class", () => {
    expect(sameFeed([row({ feed: "aop" }), row({ feed: "eop" })])).toEqual([]);
  });

  test("keeps the tags apart — a tag-blind fold would pair a contract with its own amendment", () => {
    expect(
      sameFeed([
        row({ feed: "ocds" }),
        row({ feed: "ocds", tag: "contractAmendment" }),
      ]),
    ).toEqual([]);
  });

  test("splits one feed's arms by tag rather than totalling them", () => {
    const out = sameFeed([
      row({ feed: "ocds", tag: "contractAmendment", eur: 500 }),
      row({ feed: "ocds", tag: "contractAmendment", eur: 500 }),
      row({ feed: "ocds", contractId: "C2", eur: 100 }),
      row({ feed: "ocds", contractId: "C2", eur: 100 }),
    ]);
    expect(out.map((r) => [r.tag, r.groups, r.surplusEur])).toEqual([
      ["contractAmendment", 1, 500],
      ["contract", 1, 100],
    ]);
  });

  test("does not merge distinct (contract_id, unp) pairs whose concatenation coincides", () => {
    // The separator case. Without SEP the two keys are both "…C1100073-2020-0012…" and these
    // unrelated rows fold into one "duplicate" group, silently inflating every figure §6 prints.
    expect(
      sameFeed([
        row({ feed: "aop", contractId: "", unp: "C1100073-2020-0012" }),
        row({ feed: "aop", contractId: "C1", unp: "100073-2020-0012" }),
      ]),
    ).toEqual([]);
  });

  test("drops rows identity E cannot key, rather than grouping them on a shared blank", () => {
    // Postgres GROUP BY treats NULLs as equal — the bug that made an earlier draft over-count.
    // identityE returns null instead, so two amount-less rows are never each other's duplicate.
    const noAmount = (): Contract => ({
      ...row({ feed: "aop" }),
      amountEur: undefined,
    });
    expect(sameFeed([noAmount(), noAmount()])).toEqual([]);
    expect(
      sameFeed([
        row({ feed: "aop", signed: "" }),
        row({ feed: "aop", signed: "" }),
      ]),
    ).toEqual([]);
  });
});
