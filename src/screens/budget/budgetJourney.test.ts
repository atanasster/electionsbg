// Gates for the budget-journey chain (plan T9.11).
//
// The failures this defends against are all orderings that look fine and read
// backwards:
//
//   * PUBLICATION ORDER. An execution report for January is published months
//     after the law it executes, so a date sort puts the reports above the law
//     and the chain reads audit → law.
//   * A COMPLETENESS METER MEASURING OUR OWN CATALOGUE. Fund budgets are
//     catalogued from 2026, so scoring 2018 against the three-law package
//     reports two laws as pending that were passed and simply not collected.
//   * AN UNKNOWN KIND AT THE HEAD. A document type added upstream must not take
//     the top of the chain by defaulting to stage 0.

import { describe, it, expect } from "vitest";
import { orderJourney, packageProgress, stageOf } from "./budgetJourney";

const doc = (
  documentId: string,
  kind: string,
  publishedOn: string | null = null,
) => ({ documentId, kind, titleBg: documentId, publishedOn, url: null });

/** FY2026 with the corpus's own promulgation dates: the full three-law package
 *  plus the two bridging laws the year ran on until the ЗДБРБ passed. Shuffled,
 *  because the ordering is what is under test.
 *
 *  `law-2026` is deliberately UNDATED — that is how `budget_document` holds it
 *  — which is also why the bridging laws must not be sorted into place by date
 *  alone: there is no date to compare them against. */
const FY2026 = [
  doc("interim-law-2026-1", "interim-law", "2026-03-27"),
  doc("law-2026", "law", null),
  doc("fund-law-nzok-2026-0", "fund-law", "2026-07-28"),
  doc("interim-law-2026-0", "interim-law", "2025-12-23"),
  doc("fund-law-doo-2026-0", "fund-law", "2026-07-28"),
];

describe("orderJourney", () => {
  it("reads law → execution → audit, not newest-first", () => {
    const rows = [
      doc("exec-2024-03", "execution-report", "2024-04-30"),
      doc("audit-2024", "audit-report", "2026-02-10"),
      doc("law-2024", "law", "2023-12-22"),
      doc("amendment-2024-1", "amendment", "2024-07-01"),
    ];
    expect(orderJourney(rows).map((d) => d.kind)).toEqual([
      "law",
      "amendment",
      "execution-report",
      "audit-report",
    ]);
  });

  it("opens FY2026 with the laws that actually governed it first", () => {
    // A bridging law runs UNTIL the ЗДБРБ passes, so it precedes it by
    // definition and — here — by seven months. Headed by the budget act, the
    // page read as though the year had a budget and then needed bridging.
    // The fund budgets are one package with the ЗДБРБ and follow it.
    expect(orderJourney(FY2026).map((d) => d.documentId)).toEqual([
      "interim-law-2026-0",
      "interim-law-2026-1",
      "law-2026",
      "fund-law-doo-2026-0",
      "fund-law-nzok-2026-0",
    ]);
  });

  it("still opens with the budget act in a year with no bridging law", () => {
    // Every year but 2026 has none, so the reordering above must not demote the
    // ЗДБРБ everywhere else.
    const ordinary = [
      doc("audit-2024", "audit-report", "2026-02-10"),
      doc("law-2024", "law", "2023-12-22"),
    ];
    expect(orderJourney(ordinary)[0].documentId).toBe("law-2024");
  });

  it("runs forwards inside a stage", () => {
    const rows = [
      doc("exec-b", "execution-report", "2024-06-30"),
      doc("exec-a", "execution-report", "2024-01-31"),
    ];
    expect(orderJourney(rows).map((d) => d.documentId)).toEqual([
      "exec-a",
      "exec-b",
    ]);
  });

  it("sorts an undated row last within its stage, never first", () => {
    // `null` is „we do not know when", and at the head of a stage it asserts
    // the row came before ones we DO have dates for.
    const rows = [
      doc("exec-undated", "execution-report", null),
      doc("exec-jan", "execution-report", "2024-01-31"),
    ];
    expect(orderJourney(rows).map((d) => d.documentId)).toEqual([
      "exec-jan",
      "exec-undated",
    ]);
  });

  it("is a TOTAL order — two same-day rows cannot reshuffle", () => {
    const a = [
      doc("fund-law-nzok-2026-0", "fund-law", "2026-07-28"),
      doc("fund-law-doo-2026-0", "fund-law", "2026-07-28"),
    ];
    const b = [a[1], a[0]];
    expect(orderJourney(a).map((d) => d.documentId)).toEqual(
      orderJourney(b).map((d) => d.documentId),
    );
  });

  it("is a total order for two UNDATED rows in one stage — the antisymmetry case", () => {
    // ⚠️ THE GATE THE FIRST CUT DID NOT HAVE, and its absence made the
    // reverse-input mutation a false negative. With the null branch written as
    // `a == null ? 1 : b == null ? -1 : 0`, cmp(a,b) and cmp(b,a) are BOTH 1 —
    // not opposite — so `documentId` is never reached and the pair's order is
    // whatever the input order was. 12 of the corpus's 33 rows are undated, so
    // one more audit act in a year that already has one reaches this.
    const a = [doc("audit-b", "audit-report"), doc("audit-a", "audit-report")];
    const b = [a[1], a[0]];
    expect(orderJourney(a).map((d) => d.documentId)).toEqual([
      "audit-a",
      "audit-b",
    ]);
    expect(orderJourney(b).map((d) => d.documentId)).toEqual([
      "audit-a",
      "audit-b",
    ]);
  });

  it("keeps a whole undated block stable past the insertion-sort threshold", () => {
    // Under ~22 elements V8 uses insertion sort, which happens to preserve
    // order even for a broken comparator; the merge paths above it do not. So a
    // two-element probe alone can pass on a comparator that flips at scale.
    const many = Array.from({ length: 30 }, (_, i) =>
      doc(`exec-${String(i).padStart(2, "0")}`, "execution-report"),
    );
    const ids = many.map((d) => d.documentId);
    expect(orderJourney(many).map((d) => d.documentId)).toEqual(ids);
    expect(orderJourney([...many].reverse()).map((d) => d.documentId)).toEqual(
      ids,
    );
  });

  it("sorts an unknown kind LAST rather than at the head of the chain", () => {
    // Stage lookup misses default to 0 unless guarded, which silently promotes
    // a new upstream document type above the budget law.
    expect(stageOf("some-new-kind")).toBeGreaterThan(stageOf("kfp-feed"));
    const rows = [doc("mystery", "some-new-kind"), doc("law-2024", "law")];
    expect(orderJourney(rows)[0].documentId).toBe("law-2024");
  });

  it("does not mutate its input", () => {
    const rows = [doc("audit", "audit-report"), doc("law", "law")];
    const before = rows.map((d) => d.documentId);
    orderJourney(rows);
    expect(rows.map((d) => d.documentId)).toEqual(before);
  });
});

describe("packageProgress", () => {
  it("scores a complete three-law package", () => {
    expect(packageProgress(FY2026)).toEqual({
      have: 3,
      total: 3,
      missing: [],
    });
  });

  it("names the half that has not passed", () => {
    // The FY2026 state before 2026-08: the fund budgets promulgated on 28 July
    // while the ЗДБРБ was still pending and the year ran on a bridging law.
    const noState = FY2026.filter((d) => d.kind !== "law");
    expect(packageProgress(noState)).toEqual({
      have: 2,
      total: 3,
      missing: ["ЗДБРБ"],
    });
  });

  it("returns null — never 0 of 3 — for a year with no fund law catalogued", () => {
    // ⚠️ THE GUARD, and the reason it exists. Fund budgets are catalogued from
    // 2026; every earlier year has a state law and no fund laws, which is a gap
    // in this site's collection and not in the state's legislating. Scored, all
    // eight of 2018-2025 reported „1 of 3 — still pending: ЗБДОО, ЗБНЗОК".
    expect(packageProgress([doc("law-2018", "law", "2017-12-19")])).toBeNull();
    // …including a year that also has amendments and reports.
    expect(
      packageProgress([
        doc("law-2024", "law"),
        doc("amendment-2024-1", "amendment"),
        doc("audit-2024", "audit-report"),
      ]),
    ).toBeNull();
  });

  it("tells the two fund halves apart by the id, not by count", () => {
    // Two ЗБДОО rows are not „ЗБДОО and ЗБНЗОК". Counting fund-law documents
    // would score this 3 of 3 and report nothing pending.
    const twoDoo = [
      doc("law-2026", "law"),
      doc("fund-law-doo-2026-0", "fund-law"),
      doc("fund-law-doo-2026-1", "fund-law"),
    ];
    expect(packageProgress(twoDoo)).toEqual({
      have: 2,
      total: 3,
      missing: ["ЗБНЗОК"],
    });
  });
});
