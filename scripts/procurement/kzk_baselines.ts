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
// declared in RATCHETED and which are observations in OBSERVED, side by side —
// ⚠️ but the `next` object literal in recordBaselines independently spells each
// one as a Math.max or a last-seen read, so the two CAN drift on a one-word edit
// that typechecks. The "raises each field" unit test is what catches that.
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
  /**
   * The corpus THE LAST RECORDED RUN saw — appeals, and MERITS-ELIGIBLE
   * decisions.
   *
   * ⚠️ LAST-SEEN, LIKE `matched` — NOT a snapshot of the run that set the bar.
   * A bar-holding run refreshes these while leaving `updatedAt` alone, so the two
   * legitimately describe different runs, and a message must not say "the corpus
   * the bar was measured against". `corpusDelta()` phrases it as "the last
   * recorded run" for that reason.
   *
   * ⚠️ DIAGNOSTIC, AND IT MUST NEVER DECIDE WHETHER A GATE PASSES. Read it, print
   * it, and let it decide whether the FILE is rewritten — that branch is
   * `refreshed` below and it is intended. What it must never become is
   * "only ratchet when the corpus is unchanged", which is a gate that stops
   * asserting the moment data lands, i.e. the "passes forever" failure this whole
   * file replaced. Its job is one sentence: "the appeals corpus grew 7,998 →
   * 8,007 since the last recorded run" — the sentence whose absence sent an
   * operator after an untouched matcher on 2026-08-25.
   *
   * Null on a file written before 2026-08-25, so a consumer must render the delta
   * conditionally rather than printing "grew from null".
   */
  appeals: number | null;
  /**
   * Merits-eligible decisions ONLY — the `MERITS_ELIGIBLE_SQL` / `setsMeritsOutcome`
   * population, NEVER `count(*) FROM kzk_decisions`. The two differ by the
   * определения (4,502 against 4,779 today) and every gate uses the former, so a
   * raw count here would misreport the delta by ~277 in the operator's face. See
   * the note on `appeals` above for the rest.
   */
  decisionsMerits: number | null;
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
 * The fields that are OBSERVATIONS — last-seen, free to go DOWN, asserted on by
 * nothing. Declared beside `RATCHETED` so "which fields are bars" is answerable
 * by reading two lines, and so `recordBaselines` can report which of them moved
 * instead of guessing (it announced a `matched` refresh on the very run that
 * introduced the other two, when `matched` was the one field that had not moved).
 */
const OBSERVED = ["matched", "appeals", "decisionsMerits"] as const;

/**
 * Every field of `KzkBaselines` except `updatedAt` must be declared as a BAR or as
 * an OBSERVATION. A field in neither is computed into `next` and then DROPPED:
 * `raised` and `refreshed` never mention it, so `wrote` is false and the file is
 * not rewritten at all — the new value simply never lands. Verified with the
 * sibling plan's own next field (`upheld`, kzk-matcher-ambiguity-v1 §8): added to
 * the type, to FLOOR, to readBaselines and to `next` but not to RATCHETED, it
 * persists at its old value with every unit test green.
 *
 * This alias makes that a COMPILE error instead. It cannot go stale, and it costs
 * nothing at runtime.
 */
type _AllFieldsDeclared =
  Exclude<
    keyof KzkBaselines,
    (typeof RATCHETED)[number] | (typeof OBSERVED)[number] | "updatedAt"
  > extends never
    ? true
    : ["field declared in neither RATCHETED nor OBSERVED", never];
const _allFieldsDeclared: _AllFieldsDeclared = true;
void _allFieldsDeclared;

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
  /** OBSERVATIONS that changed. `wrote` is true iff this or `raised` is non-empty. */
  refreshed: Array<(typeof OBSERVED)[number]>;
  /** True when the committed file changed on disk, for ANY reason. */
  wrote: boolean;
};

/**
 * Render "and the corpus moved since then" for a gate's failure text.
 *
 * ⚠️ MESSAGE ONLY. Nothing branches on the result and nothing may — see the note
 * on `appeals`. It exists because a gate that says only "4,166 is below 4,932"
 * leaves the operator to guess whether the corpus moved underneath it, which is
 * the guess that went wrong on 2026-08-25.
 *
 * Takes the baseline explicitly rather than closing over `readBaselines()` so it
 * is unit-testable, and takes nullable counts so a caller that can see only one
 * side of the corpus (Gate C, which runs without kzk_decisions) can still render
 * half of it.
 */
export const corpusDelta = (
  base: Pick<KzkBaselines, "appeals" | "decisionsMerits">,
  nowAppeals: number | null,
  nowMerits: number | null,
  /**
   * The bar the CALLING gate asserts on — `reached` for Gate D, `outcomes` for
   * Gate C. The tail is a claim about MONOTONICITY, and the two bars are monotone
   * for different reasons, so it must never name the other gate's quantity.
   */
  bar: "reached" | "outcomes",
): string => {
  const parts: string[] = [];
  if (base.appeals != null && nowAppeals != null && base.appeals !== nowAppeals)
    parts.push(`appeals ${base.appeals} → ${nowAppeals}`);
  if (
    base.decisionsMerits != null &&
    nowMerits != null &&
    base.decisionsMerits !== nowMerits
  )
    parts.push(
      `merits-eligible decisions ${base.decisionsMerits} → ${nowMerits}`,
    );
  if (parts.length === 0) return "";

  // ⚠️ THE DIRECTION DECIDES WHAT THIS MEANS, and a single closing sentence gets
  // it wrong. GROWTH cannot lower a bar — that is the whole reason these are the
  // bars — so there it really is context and not an excuse. A SHRINK on EITHER
  // side can lower one legitimately (an appeal that is gone cannot be reached; an
  // act that is gone reaches nothing), and that is Gate D's own cause 3, so
  // dismissing it would have the message contradict the evidence it just
  // produced. Both sides are tested, because the ratchet is COMMITTED while both
  // corpora are gitignored — a fresh clone legitimately holds fewer of each.
  const shrank: string[] = [];
  if (base.appeals != null && nowAppeals != null && nowAppeals < base.appeals)
    shrank.push("APPEALS");
  if (
    base.decisionsMerits != null &&
    nowMerits != null &&
    nowMerits < base.decisionsMerits
  )
    shrank.push("DECISIONS");
  const tail = shrank.length
    ? `The ${shrank.join(" and ")} corpus SHRANK — that is cause 3, and it CAN ` +
      `lower \`${bar}\` legitimately: an appeal that is gone cannot be reached, ` +
      "and an act that is gone reaches nothing. Check the loader's anti-shrink " +
      "guard, and whether this database simply holds an older corpus than the " +
      "committed ratchet, before suspecting the matcher."
    : `Growth alone cannot lower \`${bar}\` — that is why it is the bar — so ` +
      "this is context, not an excuse.";
  return `\n  the corpus moved since the last recorded run: ${parts.join(", ")}. ${tail}`;
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
  // Diagnostic, and absent on any pre-2026-08-25 file — see the fields' note.
  appeals: null,
  decisionsMerits: null,
  updatedAt: "2026-08-02",
};

/** A finite number, or null. Shared so "ratchets fail closed" is one rule, not three. */
const finite = (n: unknown): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

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
      reached: finite(raw.reached) ?? FLOOR.reached,
      appeals: finite(raw.appeals) ?? FLOOR.appeals,
      decisionsMerits: finite(raw.decisionsMerits) ?? FLOOR.decisionsMerits,
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
  observed: Pick<
    KzkBaselines,
    "outcomes" | "matched" | "reached" | "appeals" | "decisionsMerits"
  >,
  today: string,
): BaselineWrite => {
  const prev = readBaselines();
  // ⚠️ FINITE OR IT DOES NOT COUNT. `??` catches null and undefined; NaN sails
  // straight through `Math.max`, and `JSON.stringify(NaN)` is `null` — so a
  // non-finite observation does not merely fail to raise the bar, it DESTROYS
  // it, and Gate D's own recovery (re-mint from the current corpus) would then
  // launder whatever regression is live into the new normal. Ratchets fail
  // closed, in every direction.
  const seen = finite(observed.reached);
  const next: KzkBaselines = {
    // ⚠️ BOTH BARS FAIL CLOSED, not just `reached` — the header's "in every
    // direction" covers this one too, and the first cut of the finite() refactor
    // missed it. A NaN here does not merely fail to raise `outcomes`: it writes
    // JSON `null`, which readBaselines() maps to FLOOR.outcomes, dropping Gate C
    // back to the 2,098 HARDCODED FLOOR the ratchet exists to replace — in a
    // committed file, on a run that had some other reason to rewrite it.
    outcomes: Math.max(
      prev.outcomes,
      finite(observed.outcomes) ?? prev.outcomes,
    ),
    // OBSERVATION, not a bar: stored as LAST SEEN rather than as a running max.
    // A max here would leave the file asserting 2,920 for ever while the matcher
    // reports 2,918 — a committed number describing nothing. Nothing reads it as
    // a threshold, so it is free to go down, and going down is the point: it is
    // how a reader sees corpus growth withdrawing matches.
    // An observation is free to go DOWN, never to go non-numeric: a NaN is stored
    // as null and read back as 0, so `refreshed` would report a move to garbage
    // as a legitimate refresh.
    matched: finite(observed.matched) ?? prev.matched,
    reached:
      prev.reached == null
        ? seen
        : Math.max(prev.reached, seen ?? prev.reached),
    // Diagnostics follow the observation, not the bars: LAST SEEN, never a max,
    // because the question they answer is "what corpus were the bars measured
    // on". A max would make them lie in exactly the case they exist to explain —
    // a shrinking corpus.
    appeals: finite(observed.appeals) ?? prev.appeals,
    decisionsMerits: finite(observed.decisionsMerits) ?? prev.decisionsMerits,
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
  const refreshed = OBSERVED.filter((k) => next[k] !== prev[k]);
  if (raised.length === 0 && refreshed.length === 0)
    return { raised, refreshed, wrote: false };
  if (raised.length > 0) next.updatedAt = today;
  fs.mkdirSync(path.dirname(BASELINES_FILE), { recursive: true });
  fs.writeFileSync(BASELINES_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return { raised, refreshed, wrote: true };
};
