// Who owns a tier-2 outcome, and may it be overwritten?
//
// Pure and separate from kzk_rejoin.ts so the rule that stands between a matcher
// fix and the destruction of ~2,098 irreplaceable rows is unit-testable without a
// database. See migration 131 for why the distinction exists at all.

import type { DecisionMatch } from "./kzk_match";

/** The subset of a kzk_appeals row the provenance rule reads. */
export type ProvenanceRow = {
  outcome: string | null;
  decisionDate: string | null;
  decisionActNo: string | null;
};

export type ProvenanceConflict = {
  complaintNo: string;
  actNo: string;
  /** What the human recorded. */
  hand: string | null;
  /** What the matcher would record instead. */
  derived: string | null;
};

export type ProvenancePartition = {
  /** Matches the rule permits writing. */
  writable: DecisionMatch[];
  /** Rows that had no outcome at all and are being filled for the first time. */
  fillNew: number;
  /** Rows previously derived by the matcher, now re-derived. */
  refreshDerived: number;
  /** Hand-seeded rows left untouched. */
  protectedHand: number;
  /** Hand-seeded rows whose recorded outcome the matcher disagrees with. */
  conflicts: ProvenanceConflict[];
};

/**
 * Split matches into what may be written and what must be protected.
 *
 * Three cases, in the order they are tested:
 *
 *  1. `decisionActNo` set → the matcher wrote this row before. RE-DERIVABLE, so a
 *     better matcher may correct it. Without this case a wrong machine value
 *     would be permanent, which is the failure fill-only `COALESCE` causes.
 *  2. no outcome AND no decision date → never populated. Safe to fill, and the
 *     row becomes machine-owned.
 *  3. otherwise → hand-seeded and irreplaceable. NEVER written. Counted, and any
 *     disagreement recorded in full so a matcher bug is visible rather than a
 *     bare number.
 *
 * Case 3's boundary is deliberately generous: a row carrying a `decisionDate` but
 * no `outcome` still counts as hand-touched, because something recorded that date
 * and this function cannot tell what.
 */
export const partitionByProvenance = (
  matches: readonly DecisionMatch[],
  rows: ReadonlyMap<string, ProvenanceRow>,
): ProvenancePartition => {
  const writable: DecisionMatch[] = [];
  const conflicts: ProvenanceConflict[] = [];
  let fillNew = 0;
  let refreshDerived = 0;
  let protectedHand = 0;

  for (const m of matches) {
    const row = rows.get(m.complaintNo);
    if (!row) continue;

    if (row.decisionActNo != null) {
      refreshDerived++;
      writable.push(m);
    } else if (row.outcome == null && row.decisionDate == null) {
      fillNew++;
      writable.push(m);
    } else {
      protectedHand++;
      if (row.outcome !== m.outcome) {
        conflicts.push({
          complaintNo: m.complaintNo,
          actNo: m.actNo,
          hand: row.outcome,
          derived: m.outcome,
        });
      }
    }
  }

  return { writable, fillNew, refreshDerived, protectedHand, conflicts };
};
