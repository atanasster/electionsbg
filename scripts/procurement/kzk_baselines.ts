// The КЗК coverage ratchet — Gates C and D.
//
// WHY A RATCHET AND NOT A CONSTANT. The skill's original gate was
// `count(outcome) >= 2098`, a hardcoded floor. It protected the irreplaceable
// hand-made rows, and it also passed forever: it would have stayed green if no
// new outcome ever landed again, which is exactly what happened for five weeks.
// A floor that never moves cannot tell "healthy" from "frozen".
//
// So the floor MOVES. Every successful `kzk:rejoin --apply` records what it
// achieved, and the gate asserts the next run does at least as well. Coverage
// becomes monotonic by construction: a matcher change that silently loses
// outcomes fails, and one that gains them raises the bar it will be held to.
//
// MONOTONIC ON PURPOSE — `recordBaselines` only ever writes UPWARD. A run against
// a half-loaded database, or with the decisions corpus missing, must not be able
// to lower the bar and thereby launder a regression into the new normal.
//
// The file is COMMITTED (unlike the two corpora, which are gitignored), so the
// ratchet travels with the repo and a fresh clone inherits the real bar rather
// than starting at zero.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BASELINES_FILE = path.resolve(
  __dirname,
  "../../data/procurement/derived/kzk_baselines.json",
);

export type KzkBaselines = {
  /** Rows with an outcome, of either provenance. Gate C. */
  outcomes: number;
  /**
   * Appeals the matcher resolved 1:1 against the stored corpus. Gate D.
   *
   * Recorded SEPARATELY from `outcomes` because they fail differently: outcomes
   * can only be written, never cleared, so `count(outcome)` is non-decreasing by
   * construction and cannot detect a matcher that got WORSE. Re-running the
   * matcher and comparing to this number can.
   */
  matched: number;
  /** ISO date of the run that last raised any of the above. */
  updatedAt: string;
};

/**
 * The hand-seeded floor is a CONSTANT, not a ratcheted field.
 *
 * That population is CLOSED — 2,098 rows produced interactively before any
 * generator existed, and no process can legitimately create another. So the only
 * way the observed count could rise is the laundering hazard kzk_rejoin.ts
 * documents: a machine-derived outcome losing its `decision_act_no` and being
 * re-read as hand-seeded. Ratcheting on it would raise the floor to the laundered
 * number and commit it, making the corruption permanent and self-certifying.
 */
export const HAND_SEEDED_FLOOR = 2098;

/** Conservative fallback for a clone that predates the file. */
const FLOOR: KzkBaselines = {
  outcomes: 2098,
  matched: 0,
  updatedAt: "2026-08-02",
};

export const readBaselines = (): KzkBaselines => {
  if (!fs.existsSync(BASELINES_FILE)) return FLOOR;
  try {
    const raw = JSON.parse(
      fs.readFileSync(BASELINES_FILE, "utf8"),
    ) as Partial<KzkBaselines>;
    return {
      outcomes: Number(raw.outcomes ?? FLOOR.outcomes),
      matched: Number(raw.matched ?? FLOOR.matched),
      updatedAt: String(raw.updatedAt ?? FLOOR.updatedAt),
    };
  } catch {
    // A corrupt ratchet must not silently become "no bar at all".
    return FLOOR;
  }
};

/**
 * Raise the ratchet to `observed`, field by field. Never lowers anything.
 *
 * Returns the fields that actually moved, so the caller can tell the operator to
 * commit the file — and say nothing when the run merely held the line.
 */
export const recordBaselines = (
  observed: Pick<KzkBaselines, "outcomes" | "matched">,
  today: string,
): Array<keyof KzkBaselines> => {
  const prev = readBaselines();
  const next: KzkBaselines = {
    outcomes: Math.max(prev.outcomes, observed.outcomes),
    matched: Math.max(prev.matched, observed.matched),
    updatedAt: prev.updatedAt,
  };
  const raised = (["outcomes", "matched"] as const).filter(
    (k) => next[k] > prev[k],
  );
  if (raised.length === 0) return [];
  next.updatedAt = today;
  fs.mkdirSync(path.dirname(BASELINES_FILE), { recursive: true });
  fs.writeFileSync(BASELINES_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return raised;
};
