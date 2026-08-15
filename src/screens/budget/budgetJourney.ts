// The budget-journey chain for ONE fiscal year — the data half.
//
// Plan: docs/plans/budget-hub-v1.md T9.11. `/budget/law` listed the year's
// documents newest-first, which is a filing cabinet. The journey is the same
// rows read as a sequence: the law package is passed, the year is executed and
// reported month by month, and an audit follows once it closes. Ordering by
// publication date destroys exactly that, because an execution report for
// January is published long after the law and lands above it.
//
// THREE THINGS THIS MODULE REFUSES TO DO, each because the corpus cannot
// support it:
//
//   * IT NEVER SAYS A STAGE IS MISSING. `audit-report` exists for 2 of the nine
//     catalogued years (a `GROUP BY fiscal_year` shows ten groups, but the tenth
//     is the year-less КФП feed row), and чл. 92 ЗПФ requires the СП to audit the
//     annual report EVERY year — so „no audit" here is this site's coverage,
//     not the country's record. That is the same distinction the page's
//     scorecard caveat draws, and it is the whole reason the score is worded as
//     coverage. The one absence the module WILL assert is a year that has not
//     finished, which is a fact about the calendar.
//   * IT NEVER TREATS `monthsAvailable` AS COVERAGE, and the reason is not the
//     one it looks like. That column counts КФП observations CAPTURED — 152's
//     `COMMENT ON COLUMN` says so and adds „rendering this as coverage is false
//     about a complete year". FY2021 is `complete` with SIX: the feed is
//     cumulative year-to-date, so its December row IS the whole year, and the
//     six is how many monthly snapshots exist rather than how much of the year
//     was reported. („The feed starts in June" explains the six; it does not
//     explain the completeness, and reading it that way is what makes rendering
//     the raw count look safe.) `lastPeriod` answers „how far has this year been
//     reported" exactly, and is what the page leads with.
//   * IT NEVER SCORES A LAW PACKAGE IT CANNOT SEE. A Bulgarian budget year is
//     three laws — the ЗДБРБ plus the ЗБДОО and ЗБНЗОК fund budgets — but the
//     fund half is catalogued from 2026 only. Scoring earlier years against it
//     printed „1 of 3 laws — still pending: ЗБДОО, ЗБНЗОК" for eight long-closed
//     years: a meter reading our own catalogue and captioned as the state's.

/** EXACTLY the three fields the ordering reads — structural rather than an
 *  imported row type, so both journey surfaces can pass their own shape.
 *
 *  Narrow on purpose. Declaring `titleBg`/`url` here (which the ordering never
 *  touches) locked the module to the Postgres row and shut out `BudgetJourneyTile`,
 *  whose shard-backed `BudgetDocument` carries `title` + `sources` instead —
 *  which is how the two surfaces came to hold two copies of this file's rules
 *  and to order the same year differently. */
export interface JourneyDoc {
  documentId: string;
  kind: string;
  publishedOn: string | null;
}

/** Legislative first, then execution, then the audit that closes the year.
 *
 *  THE BRIDGING LAW HEADS THE LEGISLATIVE BLOCK, which looks wrong and is not.
 *  A „закон за събирането на приходи" governs the year UNTIL the ЗДБРБ passes,
 *  so it precedes it by definition — and in the only year that has one it
 *  precedes it in fact: FY2026's two bridging laws are 2025-12-23 and
 *  2026-03-27, seven and four months ahead of the budget act. With the ЗДБРБ at
 *  the head the page read as though the year had a budget and then needed
 *  bridging. Every other year has no `interim-law` row at all, so the budget act
 *  still opens the chain there.
 *
 *  The fund budgets are promulgated as one package with the ЗДБРБ, so they
 *  follow it and precede any mid-year amendment.
 *
 *  An unknown kind sorts last rather than crashing — a new document type must
 *  not silently take the head of the chain. */
const STAGE_ORDER: Record<string, number> = {
  "interim-law": 0,
  law: 1,
  "fund-law": 2,
  amendment: 3,
  "execution-report": 4,
  "audit-report": 5,
  "kfp-feed": 6,
};
const UNKNOWN_STAGE = 99;

export const stageOf = (kind: string): number =>
  STAGE_ORDER[kind] ?? UNKNOWN_STAGE;

/**
 * The year's documents as a chain.
 *
 * Stage first, then publication date ASCENDING within a stage — a sequence
 * reads forwards. `documentId` breaks the remaining ties so the order is total
 * and a re-render cannot reshuffle two same-day rows.
 *
 * An undated row sorts LAST within its stage rather than first: `null` is „we
 * do not know when", and placing it at the head of a stage asserts it came
 * before rows we do have dates for.
 *
 * ⚠️ THE NULL BRANCH IS A SUBTRACTION, NOT A TERNARY CHAIN. Written as
 * `a == null ? 1 : b == null ? -1 : 0` it returns 1 for BOTH orderings of two
 * undated rows — `cmp(a,b)` and `cmp(b,a)` equal rather than opposite — so the
 * comparator is not antisymmetric, `documentId` is unreachable for exactly the
 * rows that most need it, and past V8's insertion-sort threshold the whole
 * undated block flips with the input order. 12 of the corpus's 33 rows are
 * undated (every `law`, both audits, the feed), so this is one document away
 * from live. It also makes the reverse-input mutation a FALSE NEGATIVE: it stays
 * green because no fixture holds two same-stage undated rows, not because the
 * order is total.
 */
export const orderJourney = <T extends JourneyDoc>(docs: T[]): T[] =>
  [...docs].sort(
    (a, b) =>
      stageOf(a.kind) - stageOf(b.kind) ||
      (a.publishedOn == null ? 1 : 0) - (b.publishedOn == null ? 1 : 0) ||
      (a.publishedOn ?? "").localeCompare(b.publishedOn ?? "") ||
      a.documentId.localeCompare(b.documentId),
  );

export interface PackageProgress {
  have: number;
  total: number;
  /** The laws of the three-law package this year is missing, by Bulgarian
   *  abbreviation. Empty when the package is complete. */
  missing: string[];
}

/**
 * How much of the year's three-law package is promulgated, or null when the
 * question cannot be asked of this year.
 *
 * Null — not „0 of 3" — is the important return. It means the year predates the
 * fund-law catalogue, and a completeness meter that has never seen a ЗБДОО
 * cannot report one as pending.
 *
 * The fund is read out of the document id (`fund-law-doo-2026-0`), which is how
 * the two halves are told apart without a column for it.
 */
export const packageProgress = (
  docs: { kind: string; documentId: string }[],
): PackageProgress | null => {
  const hasStateLaw = docs.some((d) => d.kind === "law");
  const funds = ["doo", "nzok"] as const;
  const haveFund = funds.filter((f) =>
    docs.some((d) => d.kind === "fund-law" && d.documentId.includes(`-${f}-`)),
  );
  // No fund law catalogued ⇒ the year is outside the frame, not failing it.
  if (haveFund.length === 0) return null;
  const have = (hasStateLaw ? 1 : 0) + haveFund.length;
  const missing: string[] = [];
  if (!hasStateLaw) missing.push("ЗДБРБ");
  if (!haveFund.includes("doo")) missing.push("ЗБДОО");
  if (!haveFund.includes("nzok")) missing.push("ЗБНЗОК");
  return { have, total: 3, missing };
};
