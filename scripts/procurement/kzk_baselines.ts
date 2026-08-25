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
// ⚠️ "MONOTONIC BY CONSTRUCTION" IS A PROPERTY OF THE QUANTITY, NOT OF THE
// RATCHET, and picking the wrong quantity is how Gate D spent 2026-08-25 telling
// an operator to audit an untouched matcher. `matched` is not monotone: the
// appeal corpus only grows, growth creates ambiguity, and the matcher's CORRECT
// response to ambiguity is to withdraw a match. Growth and regression are
// therefore indistinguishable in it. Gate D's bar is now `reached`, which no
// growth on either side can shrink. Before adding a field here, ask what corpus
// growth does to it — see docs/plans/kzk-gate-d-ambiguity-v1.md §3.
//
// MONOTONIC ON PURPOSE — `recordBaselines` only ever moves a BAR upward. A run
// against a half-loaded database, or with the decisions corpus missing, must not
// be able to lower one and thereby launder a regression into the new normal. That
// rule covers `outcomes` and `reached` and nothing else: `matched` is an
// OBSERVATION and is written as last-seen, so it may go down, and a fall in it is
// a fact about the corpus rather than a regression. Which fields are bars is
// declared once, in RATCHETED.
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
   * Recorded SEPARATELY from `outcomes` because they fail differently — though
   * NOT for the reason this comment gave until 2026-08-24. Outcomes are not
   * append-only: `partitionByProvenance` puts a match with a NULL outcome into
   * `writable` whenever the row is already machine-owned, and the writer assigns
   * it unconditionally, so a re-derivation CAN clear a value.
   *
   * What `count(outcome)` actually misses is the row that stops being matched at
   * all — it is simply absent from `writable`, so its stale outcome survives
   * untouched and the count does not move. That is why it cannot detect a matcher
   * that got WORSE, and why re-running the matcher and comparing to this number
   * can. The twin of this note lives in kzk_appeals_provenance.data.test.ts.
   *
   * ⚠️ SINCE 2026-08-25 THIS IS AN OBSERVATION, NOT A BAR — Gate D asserts on
   * `reached` instead, and this may go DOWN. It is recorded from whatever run
   * last wrote the file, with NO completeness check, unlike the bars: the header
   * rule that a half-loaded run must not move the bar does not apply here, so a
   * partial-corpus run leaves a low number. Gate D quotes it as labelled context
   * and nothing asserts on it. Read it as "what the last writer saw", never as
   * "what the matcher can do" — and never re-arm a ratchet on it.
   */
  matched: number;
  /**
   * Appeals some act's `(party, respondent)` key named inside the year window —
   * `MatchReport.reached`. **Gate D's bar since 2026-08-25.**
   *
   * `matched` above was the bar until then, and it was the wrong quantity: it is
   * NOT monotone under corpus growth. A new complaint joining a matched appeal's
   * group makes that group ambiguous, the matcher correctly withdraws the match,
   * and the count falls on a healthy crawl — measured, 2,920 → 2,918 on nine real
   * complaints, halting a publish in which nothing served would have changed. The
   * decisions side does the same when a second act claims an already-matched
   * appeal. `reached` cannot fall that way, because an appeal only ever JOINS a
   * group and an act only ever POINTS AT more groups.
   *
   * ⚠️ NULL MEANS "NEVER MINTED", AND IT IS NOT ZERO. A ratchet of 0 passes
   * forever, which is exactly the "cannot tell healthy from frozen" failure this
   * file was written to end — so the absence of a bar has to be distinguishable
   * from a bar of nothing, and Gate D FAILS on null with the mint command rather
   * than sailing through. That state is reachable: the file is committed, so a
   * checkout predating the swap has no such field.
   * Plan: docs/plans/kzk-gate-d-ambiguity-v1.md §4.1, §8.1.
   */
  reached: number | null;
  /** ISO date of the run that last raised a RATCHETED field (never `matched`). */
  updatedAt: string;
};

/**
 * The fields that are BARS. `matched` is deliberately absent: it is kept as an
 * observation so the rejoin can print the delta and a reader can see growth
 * withdrawing matches, but nothing asserts on it and nothing may — re-arming a
 * `matched` ratchet reinstates the false positive of 2026-08-25.
 */
const RATCHETED = ["outcomes", "reached"] as const;

/**
 * What `recordBaselines` did, so the caller can tell the operator.
 *
 * ⚠️ `raised` AND `wrote` ARE DIFFERENT QUESTIONS, and collapsing them loses the
 * common case. The file is COMMITTED, and after the Gate D swap its steady state
 * is a bar that holds while the `matched` observation drifts — so a run that
 * raises nothing still changes a tracked file. Reporting only `raised` leaves
 * `data/procurement/derived/kzk_baselines.json` modified with the operator told
 * nothing, in a repo whose SKILL.md says to commit it "when the rejoin says it
 * moved". A silently-dirty committed file is how a ratchet ends up carried into
 * an unrelated commit, or reverted by someone tidying their tree.
 */
export type BaselineWrite = {
  /** BARS that moved UP. Empty when the run merely held the line. */
  raised: Array<(typeof RATCHETED)[number]>;
  /** True when the committed file changed on disk, for ANY reason. */
  wrote: boolean;
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
  // NOT 0 — see the field's note. A clone that predates the Gate D swap has no
  // bar, and "no bar" must fail loudly rather than pass at zero forever.
  reached: null,
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
      // `?? FLOOR.reached` would be right but reads as an oversight next to the
      // two Number() casts, so the null case is spelled out: an absent or
      // non-numeric `reached` is NO BAR, never a bar of zero.
      reached: typeof raw.reached === "number" ? raw.reached : FLOOR.reached,
      updatedAt: String(raw.updatedAt ?? FLOOR.updatedAt),
    };
  } catch {
    // A corrupt ratchet must not silently become "no bar at all".
    return FLOOR;
  }
};

/**
 * Raise the ratchet to `observed`, field by field. Never lowers a BAR.
 *
 * Returns which bars moved AND whether the committed file changed — see
 * `BaselineWrite` for why those cannot be one answer. The caller uses the pair to
 * tell the operator what to commit, and to say nothing only when the file really
 * did not move.
 */
export const recordBaselines = (
  observed: Pick<KzkBaselines, "outcomes" | "matched" | "reached">,
  today: string,
): BaselineWrite => {
  const prev = readBaselines();
  // ⚠️ FINITE OR IT DOES NOT COUNT. `??` catches null and undefined; NaN sails
  // straight through `Math.max`, and `JSON.stringify(NaN)` is `null` — so a
  // non-finite observation does not merely fail to raise the bar, it DESTROYS
  // it, and Gate D's own recovery (re-mint from the current corpus) would then
  // launder whatever regression is live into the new normal. Ratchets fail
  // closed, in every direction.
  const seen =
    typeof observed.reached === "number" && Number.isFinite(observed.reached)
      ? observed.reached
      : null;
  const next: KzkBaselines = {
    outcomes: Math.max(prev.outcomes, observed.outcomes),
    // OBSERVATION, not a bar: stored as LAST SEEN rather than as a running max.
    // A max here would leave the file asserting 2,920 for ever while the matcher
    // reports 2,918 — a committed number describing nothing. Nothing reads it as
    // a threshold, so it is free to go down, and going down is the point: it is
    // how a reader sees corpus growth withdrawing matches.
    matched: observed.matched,
    reached:
      prev.reached == null
        ? seen
        : Math.max(prev.reached, seen ?? prev.reached),
    updatedAt: prev.updatedAt,
  };
  const raised = RATCHETED.filter((k) => {
    const before = prev[k];
    const after = next[k];
    // A first mint (null → number) counts as raised: it is the transition that
    // arms Gate D, and §8.1's operator instruction depends on it being reported.
    if (before == null) return after != null;
    return after != null && after > before;
  });
  // The observation moves far more often than a bar does. Writing for it keeps
  // the committed file honest without letting it move `updatedAt`, which means
  // "when a bar last rose" and is quoted in both gates' failure messages.
  if (raised.length === 0 && next.matched === prev.matched)
    return { raised, wrote: false };
  if (raised.length > 0) next.updatedAt = today;
  fs.mkdirSync(path.dirname(BASELINES_FILE), { recursive: true });
  fs.writeFileSync(BASELINES_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return { raised, wrote: true };
};
