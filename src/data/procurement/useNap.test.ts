// Gate for the НАП tax-revenue composition — the `/sector/revenue` + `/awarder/
// 131063188` band-1 card. Audit 2026-08-19, docs/plans/revenue-sector-audit-v1.md.
//
//   npx vitest run src/data/procurement/useNap.test.ts
//
// It exists because `TAX_REVENUE_GROUP` had no gate at all, and the bug it now
// carries anchors against was invisible to every other check in the repo: the
// headline was overstated 10.3%-15.8% in every year of the corpus, the arithmetic
// was internally consistent, nothing threw, and the segment doing the damage was
// LABELLED „Други данъци" — so it read as a plausible residual rather than as
// €3.35bn of fees, fines and BNB surplus counted as tax.
//
// Two properties are asserted rather than two literals, because a literal is
// satisfied by an implementation that has stopped filtering at all:
//
//  · MUTATION — the same fixture folded through the OLD unanchored regex must
//    produce a LARGER total. Without this, "excludes the non-tax lines" passes for
//    any fold whose fixture happens to be small.
//  · RE-SPACING — the МФ source re-spaces its group labels between snapshots
//    („Трансфери  (нето)" 2021-2024 → „Трансфери (нето)" 2025-2026), so the
//    interior `\s+` is tested from both sides: a re-spaced „Данъчни" must still be
//    ACCEPTED, and a re-spaced „Неданъчни" must still be REJECTED. A pattern that
//    relaxed the anchors to survive the first would fail the second.

import { describe, it, expect } from "vitest";
import { buildComposition } from "./useNap";
import { TAX_REVENUE_GROUP } from "@/lib/napReferenceData";
import type { KfpSnapshot, KfpSnapshotLine, Money } from "@/data/budget/types";

const eur = (amountEur: number): Money => ({
  amountEur,
  amount: Math.round(amountEur * 1.95583),
  currency: "BGN",
});

const line = (
  labelBg: string,
  groupLabelBg: string,
  amountEur: number,
): KfpSnapshotLine => ({
  labelBg,
  labelEn: labelBg,
  planned: null,
  executed: eur(amountEur),
  depth: 1,
  isSubtotal: false,
  groupLabelBg,
  groupLabelEn: groupLabelBg,
});

// Mirrors the real 2025-12 snapshot's revenue section, rounded to whole millions:
// eight genuine tax leaves under „Данъчни приходи" and five non-tax leaves under
// „Неданъчни приходи". `taxGroup`/`nonTaxGroup` are parameterised so the re-spacing
// cases can be built from the same shape.
const snapshot = (
  taxGroup = "Данъчни приходи",
  nonTaxGroup = "Неданъчни приходи",
): KfpSnapshot => ({
  period: "2025-12",
  fiscalYear: 2025,
  asOf: "2025-12-31",
  currency: "BGN",
  constituentBudget: "consolidated",
  sections: [
    {
      code: "revenue",
      series: "revenue",
      kind: "revenue",
      labelBg: "Приходи",
      labelEn: "Revenue",
      planned: null,
      executed: eur(26_126_000_000),
      lines: [
        // The depth-0 subtotal — its OWN labelBg is „Данъчни приходи", which is
        // why TAX_REVENUE_GROUP must never be tested against labelBg.
        {
          labelBg: taxGroup,
          labelEn: "Tax revenue",
          planned: null,
          executed: eur(22_774_000_000),
          depth: 0,
          isSubtotal: true,
          groupLabelBg: null,
          groupLabelEn: null,
        },
        line("Корпоративен данък", taxGroup, 3_328_000_000),
        line(
          "Данъци върху  дивидентите, ликвидац. дялове",
          taxGroup,
          75_000_000,
        ),
        line("Данъци в/у доходите на физически лица", taxGroup, 4_184_000_000),
        line("Данък върху добавената стойност", taxGroup, 11_029_000_000),
        line("Акцизи", taxGroup, 3_796_000_000),
        line("Данък върху застрахователните премии", taxGroup, 40_000_000),
        line("Мита и митнически такси", taxGroup, 204_000_000),
        line("Други данъци", taxGroup, 119_000_000),
        // Non-tax — must never reach the composition.
        line("Приходи и доходи  от собственост", nonTaxGroup, 1_333_000_000),
        line(
          "Превишение на приходите над разходите на БНБ",
          nonTaxGroup,
          281_000_000,
        ),
        line("Приходи от такси", nonTaxGroup, 1_225_000_000),
        line("Глоби, санкции и наказателни лихви", nonTaxGroup, 227_000_000),
        line("Други неданъчни приходи", nonTaxGroup, 286_000_000),
      ],
    },
  ],
});

/** The pre-fix fold: identical to `buildComposition` except for the group regex.
 *  Used only by the mutation check. */
const foldWith = (groupRe: RegExp, snap: KfpSnapshot): number =>
  (snap.sections.find((s) => s.series === "revenue")?.lines ?? [])
    .filter(
      (l) =>
        !l.isSubtotal &&
        l.executed != null &&
        groupRe.test(l.groupLabelBg ?? ""),
    )
    .reduce((a, l) => a + (l.executed?.amountEur ?? 0), 0);

const TRUE_TAX_EUR = 22_775_000_000; // Σ of the eight tax leaves above
const TRUE_OTHER_EUR = 234_000_000; // dividends + insurance premiums + „Други данъци"

describe("TAX_REVENUE_GROUP", () => {
  it("accepts the tax group and rejects the NON-tax group", () => {
    // „Неданъчни приходи" CONTAINS „данъчни приходи" — the whole reason the
    // pattern is anchored.
    expect(TAX_REVENUE_GROUP.test("Данъчни приходи")).toBe(true);
    expect(TAX_REVENUE_GROUP.test("Неданъчни приходи")).toBe(false);
  });

  it("survives the source re-spacing the label, in BOTH directions", () => {
    // The МФ source did exactly this to „Трансфери  (нето)" between the 2024-12
    // and 2025-12 snapshots. A relaxation that rescued the first case by dropping
    // the anchors would fail the second.
    expect(TAX_REVENUE_GROUP.test("Данъчни  приходи")).toBe(true);
    expect(TAX_REVENUE_GROUP.test("Данъчни приходи")).toBe(true);
    expect(TAX_REVENUE_GROUP.test(" Данъчни приходи ")).toBe(true);
    expect(TAX_REVENUE_GROUP.test("Неданъчни  приходи")).toBe(false);
    expect(TAX_REVENUE_GROUP.test("Неданъчни приходи")).toBe(false);
  });
});

describe("buildComposition", () => {
  it("counts only the tax leaves", () => {
    const c = buildComposition(snapshot());
    expect(c).not.toBeNull();
    expect(c!.totalTaxEur).toBe(TRUE_TAX_EUR);
    expect(c!.year).toBe(2025);
    expect(c!.partial).toBe(false);
  });

  it("keeps the residual a REAL residual", () => {
    // The defect this file gates put €3.35bn of fees, fines and BNB surplus into
    // the segment rendered as „Други данъци" — 15× its true size and 93% not a
    // tax. Asserted as a bound, not a literal: the point is that it stays small
    // relative to the headline, whatever the corpus does next.
    const other = buildComposition(snapshot())!.segments.find(
      (s) => s.id === "other",
    )!;
    expect(other.eur).toBe(TRUE_OTHER_EUR);
    expect(other.eur / buildComposition(snapshot())!.totalTaxEur).toBeLessThan(
      0.05,
    );
  });

  it("MUTATION: the pre-fix unanchored regex would fold in MORE", () => {
    // Without this, "counts only the tax leaves" is satisfiable by a fold that
    // dropped the group filter entirely.
    const withOld = foldWith(/данъчни приходи/i, snapshot());
    const withNew = foldWith(TAX_REVENUE_GROUP, snapshot());
    expect(withOld).toBeGreaterThan(withNew);
    expect(withOld - withNew).toBe(3_352_000_000);
    expect(withNew).toBe(TRUE_TAX_EUR);
  });

  it("is unmoved by the source re-spacing the group label", () => {
    // The failure this guards is TOTAL and silent — a null composition drops the
    // whole pack (composition + VAT drill + tax gap) via NapPack's `if (!comp)`.
    const respaced = buildComposition(
      snapshot("Данъчни  приходи", "Неданъчни  приходи"),
    );
    expect(respaced).not.toBeNull();
    expect(respaced!.totalTaxEur).toBe(TRUE_TAX_EUR);
  });

  it("never picks the subtotal, whose own labelBg is the group label", () => {
    // Testing TAX_REVENUE_GROUP against labelBg instead of groupLabelBg returns a
    // row carrying the correct total — the shape that survives a spot check and
    // then double-counts beside real leaves.
    const c = buildComposition(snapshot())!;
    const leafSum = c.segments.reduce((a, s) => a + s.eur, 0);
    expect(leafSum).toBe(c.totalTaxEur);
    expect(c.totalTaxEur).toBeLessThan(22_774_000_000 * 2);
  });

  it("marks a mid-year snapshot partial and never annualizes it", () => {
    const mid = { ...snapshot(), period: "2026-06", fiscalYear: 2026 };
    const c = buildComposition(mid)!;
    expect(c.partial).toBe(true);
    expect(c.totalTaxEur).toBe(TRUE_TAX_EUR);
  });

  it("returns null when the revenue section has no tax leaves at all", () => {
    const empty = snapshot("Неданъчни приходи", "Неданъчни приходи");
    expect(buildComposition(empty)).toBeNull();
  });
});
