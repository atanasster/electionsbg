// `plannedLaw` is the WRITER half of the two-scope rule that
// src/data/budget/ministrySeries.ts reads. Getting it wrong is invisible from
// either end: both figures are real appropriations, both render, and the only
// symptom is a step in a multi-year chart that reads as budget growth.
//
// The case that motivated it is МОСВ 2024 — the ЗДБ's section II says
// €60,325,488 while the ministry's own отчет restates the same appropriation at
// a consolidated scope as €104,230,071. The case that nearly broke it is МТСП
// 2023/2024, where the two sides carry the IDENTICAL native BGN figure and land
// €1 apart only after conversion.

import { describe, it, expect } from "vitest";
import { buildAdminReconciliation } from "./reconcile";
import type {
  BudgetFact,
  ClassificationRegistry,
  FactKind,
  Money,
} from "./types";

const NODE = "admin-ministerstvo-na-okolnata-sreda-i-vodite";

const registry: ClassificationRegistry = {
  dimension: "admin",
  generatedAt: "2026-08-13T00:00:00.000Z",
  nodes: [
    {
      id: NODE,
      dimension: "admin",
      nameBg: "Министерство на околната среда и водите",
      nameEn: "Ministry of Environment and Water",
      parentId: null,
      history: [],
    },
  ],
};

const eur = (amountEur: number): Money => ({
  amount: amountEur,
  currency: "EUR",
  amountEur,
});
const bgn = (amount: number, amountEur: number): Money => ({
  amount,
  currency: "BGN",
  amountEur,
});

const fact = (
  documentId: string,
  money: Money,
  kind: FactKind = "expenditure",
): BudgetFact => ({
  key: `${documentId}|${kind}`,
  fiscalYear: 2024,
  version: { stage: "law", seq: 0, effectiveDate: "2024-01-01", documentId },
  kind,
  classification: {
    admin: NODE,
    functional: null,
    economic: null,
    program: null,
    programLine: null,
  },
  grain: ["admin"],
  money,
  sourceRef: { documentId, rowLabel: "x" },
});

const expenditureRow = (lawFacts: BudgetFact[], execFacts: BudgetFact[]) => {
  const rows = buildAdminReconciliation(2024, lawFacts, execFacts, registry);
  const row = rows.find((r) => r.kind === "expenditure");
  if (!row) throw new Error("no expenditure row");
  return row;
};

describe("buildAdminReconciliation — plannedLaw", () => {
  it("preserves the ЗДБ when the отчет restates the appropriation", () => {
    const row = expenditureRow(
      [fact("law-2024", eur(60_325_488))],
      [fact("exec-mosv-2024", eur(104_230_071))],
    );
    // Within the row, the отчет's own basis — so the variance beside it is
    // like-with-like.
    expect(row.planned?.amountEur).toBe(104_230_071);
    // Across years, the ЗДБ.
    expect(row.plannedLaw?.amountEur).toBe(60_325_488);
  });

  it("writes NO plannedLaw when the two scopes agree", () => {
    const row = expenditureRow(
      [fact("law-2024", eur(1_000))],
      [fact("exec-x-2024", eur(1_000))],
    );
    expect(row.planned?.amountEur).toBe(1_000);
    expect(row.plannedLaw).toBeUndefined();
  });

  it("writes NO plannedLaw when only the euro CONVERSION differs", () => {
    // МТСП 2023: both sides are 2 465 016 000 BGN and land €1 apart in euros.
    // Publishing that €1 would assert a scope restatement that never happened.
    const row = expenditureRow(
      [fact("law-2023", bgn(2_465_016_000, 1_260_342_668))],
      [fact("exec-mtsp-2023", bgn(2_465_016_000, 1_260_342_667))],
    );
    expect(row.plannedLaw).toBeUndefined();
  });

  it("leaves plannedLaw absent when there is no ЗДБ fact to displace", () => {
    // A node-id split between the law's spelling and canonicalExecutionAdminId's
    // (Министерство на земеделието). `planned` silently becomes the отчет's, so
    // the basis is UNMARKED — the reconciler warns rather than inventing one.
    const row = expenditureRow([], [fact("exec-mzh-2024", eur(155_301_688))]);
    expect(row.planned?.amountEur).toBe(155_301_688);
    expect(row.plannedLaw).toBeUndefined();
  });

  it("does not write plannedLaw for revenue or balance", () => {
    // Only `expenditure` is read as a series (ministries.ts → pickLaw), so the
    // corpus holds exactly the rows something consumes and "N divergent
    // ministry-years" stays countable.
    const rows = buildAdminReconciliation(
      2024,
      [fact("law-2024", eur(10), "revenue")],
      [fact("exec-x-2024", eur(20), "revenue")],
      registry,
    );
    const rev = rows.find((r) => r.kind === "revenue");
    expect(rev?.planned?.amountEur).toBe(20);
    expect(rev?.plannedLaw).toBeUndefined();
  });

  it("throws rather than let a second отчет law fact overwrite the ЗДБ", () => {
    // On a second one the comparison would be отчет-vs-отчет, and plannedLaw —
    // documented as the State Budget Law's own figure — would silently hold an
    // отчет number instead.
    expect(() =>
      expenditureRow(
        [fact("law-2024", eur(60_325_488))],
        [
          fact("exec-mosv-2024", eur(104_230_071)),
          fact("exec-mosv-2024-b", eur(111_000_000)),
        ],
      ),
    ).toThrow(/second отчет law fact/);
  });
});
