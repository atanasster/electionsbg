// Join КЗК decisions (the merits register) onto КЗК complaints (the intake
// register). Pure — no I/O, no database, no network — so it can be unit-tested
// without a headed browser or BG egress, and so the T4 crawler and the offline
// rejoin script cannot disagree about what a match is.
//
// THERE IS NO SHARED KEY. The intake register publishes a complaint number
// ("ВХР-2303-29.07.2026") and the УНП; the decisions register publishes an act
// number ("АКТ-608-25.06.2026") and a КЗК case number ("КЗК/417/2026"). Neither
// carries the other's identifier, so the join is on
// complainant + respondent + year, and it is inherently lossy. That is a known
// ceiling, not a bug — see §4 of docs/plans/kzk-decisions-freshness-v1.md.
//
// THREE THINGS THE PREVIOUS (interactive) MATCHER GOT WRONG, all measured
// against the 2026-07-04 corpus:
//
//  1. MULTI-PARTY ACTS MATCHED WHOLE-STRING. КЗК consolidates several complaints
//     against one procedure into ONE act, so the decisions register prints a
//     ';'-joined party list:
//         "ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"
//     Compared whole against a single-complainant appeal row, every one of these
//     misses. Splitting on ';' and matching each party independently is the
//     single biggest recovery.
//  2. THE YEAR KEY WAS THE DECISION'S YEAR ONLY. A complaint filed in December is
//     decided in January, so 534 decision rows could only ever match against the
//     PREVIOUS complaint year. The window is now `year | year - 1`.
//  3. AMBIGUITY WAS DROPPED SILENTLY. Keys non-unique on either side were
//     discarded with no counter, so a shrinking match rate looked like a quiet
//     data trend. Ambiguity and misses are now RETURNED as data, so every rejoin
//     reports them.
//     ⚠️ Gate D ratchets `matches` TODAY, and that is the defect being fixed:
//     corpus growth withdraws matches, so the gate cannot tell a worse matcher
//     from a bigger corpus and is currently RED for that reason. It is being
//     moved onto `reached` (docs/plans/kzk-gate-d-ambiguity-v1.md Tier 1) — see
//     that field's note. Until `kzk_baselines.ts` carries the field and
//     `kzk_appeals_provenance.data.test.ts` asserts on it, `reached` is computed
//     and NOT yet ratcheted. The other three counters are never ratcheted and
//     must not be: corpus growth legitimately raises collisions, so such a gate
//     would fail on every healthy crawl. `KzkBaselines` has no field for them.
//
// Combined effect, MEASURED on that corpus (2026-08-02) with no new crawl —
// 4,407 decisions × 7,886 appeals:
//     2,860 appeals matched · 42 claimed by >1 act · 1,674 decisions matched
//     nothing → kzk_appeals.outcome 2,098 → 3,014 (+916).
//
// ONLY UNAMBIGUOUS 1:1 RESOLUTIONS ARE EMITTED. A complainant+respondent+year
// that names two candidate appeals, or an appeal claimed by two different acts,
// is reported and skipped. A wrong outcome is materially worse than a missing
// one: it feeds `upheld_ocids`, which feeds the contract Corruption Risk Index.

/** Minimal shape this module needs from an intake row. */
export type MatchableAppeal = {
  complaintNo: string;
  complainant?: string | null;
  respondent?: string | null;
  complaintDate?: string | null;
};

/** Minimal shape this module needs from a decision row. */
export type MatchableDecision = {
  /** Act number — the natural key, used to record provenance on the match. */
  no: string;
  ddate: string;
  pron?: string | null;
  init?: string | null;
  resp?: string | null;
};

export type OutcomeCode = "уважена" | "отхвърлена" | "прекратена";

export type DecisionMatch = {
  complaintNo: string;
  /** The act this outcome came from — written to kzk_appeals.decision_act_no. */
  actNo: string;
  decisionDate: string;
  /** Null when the pronouncement is blank or unmapped — never guessed. */
  outcome: OutcomeCode | null;
};

/**
 * The four counters have DIFFERENT UNITS and do not sum to anything meaningful —
 * `matches` can even exceed `decisions.length`, since one consolidated act
 * resolves several complaints. `reached` is the one honest denominator for a
 * coverage rate (`matches / reached`), and the only field measured in the same
 * unit as `matches`: DISTINCT APPEALS. `ambiguous` counts appeals,
 * `partyAmbiguous` counts PARTIES and `unmatched` counts DECISION ROWS.
 */
export type MatchReport = {
  /** One entry per APPEAL resolved 1:1. May exceed the number of decisions. */
  matches: DecisionMatch[];
  /**
   * DISTINCT APPEALS some act's `(party, respondent)` key named inside the year
   * window — the union of every candidate set below, taken BEFORE the 1:1 test.
   *
   * This is the quantity Gate D is being moved onto (Tier 1 of the plan below),
   * and `matches` is not, because
   * `matches` IS NOT MONOTONE UNDER CORPUS GROWTH and this is. A new complaint
   * joining a matched appeal's group makes the group ambiguous, so the matcher
   * correctly withdraws a match and the count FALLS on a healthy crawl — that
   * is a false positive that halted a correct publish on 2026-08-25 (2,920 →
   * 2,918 on nine new complaints). A new act becoming a second claimant does the
   * same from the decisions side. `reached` cannot fall that way: an appeal only
   * ever JOINS a group and an act only ever POINTS AT more groups. Measured over
   * 122 corpus sizes on both sides — `matches` violated monotonicity 3 times,
   * `reached` zero. See docs/plans/kzk-gate-d-ambiguity-v1.md §2.2/§4.1.
   *
   * It is also the STRICTLY better regression detector, which is the part that
   * is easy to disbelieve. Breaking a name fold destroys COLLISIONS faster than
   * it destroys matches — more groups collapse to a spurious 1:1 — so two of
   * four injected regressions RAISE `matches` (quote fold 2,918 → 2,934;
   * whitespace fold → 2,926) and sail past a `matches` ratchet. All four lower
   * `reached` (4,914 / 4,911 / 4,166 / 4,131 against 4,932).
   *
   * ⚠️ TAKEN AT THE COARSE LEVEL, AND IT MUST STAY THERE. Any future
   * candidate-NARROWING rule — R1 "an act cannot predate its complaint",
   * R2 `kzk_case_no` (docs/plans/kzk-matcher-ambiguity-v1.md §4) — must be
   * applied AFTER this set is taken, i.e. below the `reached.add` loop. Measured
   * with R1 applied: coarse `reached` is unchanged at 4,932 while a `reached`
   * computed after the filter collapses to 4,753 — so a narrowing rule folded in
   * here would fail the ratchet on the very improvement it ships.
   *
   * ⚠️ AND IT MUST NOT DRIFT UPWARD EITHER. The line is: the year window DEFINES
   * an act's reach — which appeals it points at — and stays ABOVE `reached.add`;
   * R1/R2 REFINE among reached candidates and go BELOW. Both are date rules, so
   * the precedent alone does not separate them. Moved above the window filter,
   * `reached` goes window-blind and the plan's `narrow-window` regression
   * (§7.2, 4,131 against 4,932) stops being detectable at all. Both placements
   * are pinned by fixtures: "does not reach back two years" asserts
   * `reached === 0`, and the predating-act fixture asserts `reached === 2`.
   */
  reached: number;
  /** APPEALS claimed by more than one act — unresolvable act-side collisions. */
  ambiguous: number;
  /**
   * PARTIES (not appeals, not decisions) that named more than one candidate
   * appeal in the year window — unresolvable complainant-side collisions.
   * Counted separately because one act can resolve some of its parties cleanly
   * and leave others ambiguous; folding this into `unmatched` would hide it.
   */
  partyAmbiguous: number;
  /** DECISION ROWS none of whose parties resolved to any appeal. */
  unmatched: number;
};

/**
 * Fold the register's punctuation and casing so the two sides compare equal.
 *
 * Deliberately conservative: case, quote style (the register mixes " ' „ “ « »),
 * trailing punctuation and runs of whitespace only. It does NOT strip legal-form
 * suffixes (ЕООД / ООД / АД / ДЗЗД) — those distinguish real, different
 * companies, and folding them would manufacture ambiguity the caller then throws
 * away, which reads as "no match" rather than as the over-merge it is.
 */
export const normalizeParty = (s: string | null | undefined): string =>
  (s ?? "")
    .toUpperCase()
    .replace(/["'„“”«»]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Split the decisions register's ';'-joined party list.
 *
 * One act can resolve several joined complaints, and each party is a separate
 * intake row. Empty segments are dropped so a trailing ';' costs nothing.
 */
export const splitInitiators = (init: string | null | undefined): string[] =>
  (init ?? "")
    .split(";")
    .map((p) => normalizeParty(p))
    .filter((p) => p.length > 0);

const year = (iso: string | null | undefined): number =>
  Number((iso ?? "").slice(0, 4)) || 0;

// The measured vocabulary of the `Произнасяне` field. Counts are from the
// 2026-07-04 corpus so a future contributor can see how much of the register each
// rule actually covers.
//
// Two shapes here are easy to get wrong and both were caught by diffing against
// the 2,098 hand-made outcomes:
//
//  * "ОТМЕНЯ **КАТО** НЕЗАКОНОСЪОБРАЗНО действие…" — the two words are not
//    adjacent, so an `отменя\s+незаконосъобразн` regex silently misses a whole
//    family of upholds that the register wraps in `друго(...)`.
//  * "ОСТАВЯ БЕЗ УВАЖЕНИЕ **искането** … за възлагане на разноски" is a ruling on
//    COSTS, not on the complaint. Every "rejected" rule therefore requires the
//    word `жалбата`, or a costs decision would be recorded as a merits loss.
const OUTCOME_RULES: Array<{ re: RegExp; outcome: OutcomeCode }> = [
  // 1,173 + 270 — the buyer's act is annulled. This is the signal that feeds
  // upheld_ocids and the risk index's procedureAppealUpheld component.
  // NB: `\s`, never `\b`. JavaScript's `\b` is defined over ASCII `\w`, so it does
  // NOT match at a Cyrillic word boundary — an `отменя\b…` rule silently matches
  // nothing at all and every uphold degrades to null.
  // The `.{0,40}?` span is bounded by the ';' segment split in classifyOutcome,
  // not by the character class, so it cannot cross into a neighbouring ruling.
  { re: /отменя\s.{0,40}?незаконосъобразн/i, outcome: "уважена" },
  { re: /отменя\s+решението\s+на\s+възложителя/i, outcome: "уважена" },
  // 15 + 9 — КЗК finds the buyer's act or omission unlawful. Same substance.
  { re: /установява\s+незаконосъобразн/i, outcome: "уважена" },
  // 2,860 — the complaint failed on the merits. `жалбата` is load-bearing.
  { re: /оставя\s+жалбата\s+без\s+уважение/i, outcome: "отхвърлена" },
  // 11 — not heard on the merits (withdrawn, out of time, inadmissible).
  { re: /оставя\s+жалбата\s+без\s+разглеждане/i, outcome: "прекратена" },
  { re: /прекратява\s+производство/i, outcome: "прекратена" },
];

/** Most-significant-first. A part-uphold is an uphold — see classifyOutcome. */
const OUTCOME_PRIORITY: OutcomeCode[] = ["уважена", "отхвърлена", "прекратена"];

/**
 * Map a `Произнасяне` onto one outcome code, or null when it says nothing about
 * the merits.
 *
 * ⚠️ `pron` IS ITSELF A ';'-JOINED LIST. One act rules separately on each
 * обособена позиция and on each party, so a single field routinely carries both
 * an uphold and a rejection:
 *
 *   отменя незаконосъобразно решение и връща(в частта по ОП № 3) - "Н2О СЕРВИЗ"
 *   ЕООД; оставя жалбата без уважение(в частта по ОП № 7) - "Н2О СЕРВИЗ" ЕООД
 *
 * A first-match-wins scan over the whole string therefore returns whichever
 * ruling the register happened to print first — which is how the naive version of
 * this function disagreed with 10 of the 2,098 hand-made outcomes, in both
 * directions. Each segment is classified separately and the most significant
 * wins.
 *
 * WHY UPHOLD WINS A MIXED ACT. The one consumer that reads this is
 * `upheld_ocids` → the contract Corruption Risk Index's `procedureAppealUpheld`
 * component, and the question it asks is "did КЗК find this procedure improper?"
 * A partial annulment answers yes. (042 also declares a `частично` code; using it
 * here would drop every part-upheld procedure OUT of the risk index, which is a
 * change to what the index measures rather than a fix to this matcher — left
 * alone deliberately.)
 *
 * Returning null is a real answer, not a failure: rows that rule only on costs or
 * on a clerical correction say nothing about the merits, and guessing would put
 * fabricated signal into the risk index.
 */
export const classifyOutcome = (
  pron: string | null | undefined,
): OutcomeCode | null => {
  const s = (pron ?? "").trim();
  if (!s) return null;

  const found = new Set<OutcomeCode>();
  for (const segment of s.split(";")) {
    for (const { re, outcome } of OUTCOME_RULES) {
      if (re.test(segment)) {
        found.add(outcome);
        break;
      }
    }
  }
  return OUTCOME_PRIORITY.find((o) => found.has(o)) ?? null;
};

/**
 * Match decisions onto appeals, returning only unambiguous 1:1 resolutions, the
 * counts of what could not be resolved, and `reached` — the coarse candidate
 * union taken BEFORE the 1:1 test (see `MatchReport.reached`; its placement in
 * the loop is load-bearing in both directions).
 *
 * Both sides are indexed on `complainant|respondent` and then filtered by the
 * year window, rather than keying on the year directly, so a December→January
 * case resolves without loosening the party match.
 */
export const matchDecisions = (
  appeals: readonly MatchableAppeal[],
  decisions: readonly MatchableDecision[],
): MatchReport => {
  // party+respondent → the appeals filed under it, with their year.
  const byParty = new Map<string, Array<{ no: string; y: number }>>();
  for (const a of appeals) {
    const key = `${normalizeParty(a.complainant)}|${normalizeParty(a.respondent)}`;
    if (key === "|") continue;
    const bucket = byParty.get(key);
    const entry = { no: a.complaintNo, y: year(a.complaintDate) };
    if (bucket) bucket.push(entry);
    else byParty.set(key, [entry]);
  }

  // complaintNo → every act that claims it. A second claimant makes it ambiguous.
  const claims = new Map<string, Map<string, MatchableDecision>>();
  // The coarse candidate union — see `MatchReport.reached`. Populated from
  // `inWindow` BEFORE the 1:1 test, so ambiguity neither adds to it nor takes
  // from it; a candidate-narrowing rule must go below the `reached.add` loop.
  const reached = new Set<string>();
  let unmatched = 0;
  let partyAmbiguous = 0;

  for (const d of decisions) {
    const resp = normalizeParty(d.resp);
    const y = year(d.ddate);
    let hit = false;

    for (const party of splitInitiators(d.init)) {
      const candidates = byParty.get(`${party}|${resp}`);
      if (!candidates) continue;
      // The year window: a complaint is decided in its own year or the next one.
      const inWindow = candidates.filter((c) => c.y === y || c.y === y - 1);
      if (inWindow.length === 0) continue; // this party filed nothing in the window
      for (const c of inWindow) reached.add(c.no);
      if (inWindow.length > 1) {
        // The same party sued the same buyer twice in the window and we cannot
        // tell which act is which. Counted PER PARTY, not per decision: a
        // two-party act can resolve one side cleanly and leave the other
        // ambiguous, and `hit` would then mask the unresolved half entirely.
        partyAmbiguous++;
        continue;
      }
      hit = true;
      const no = inWindow[0].no;
      const acts = claims.get(no);
      if (acts) acts.set(d.no, d);
      else claims.set(no, new Map([[d.no, d]]));
    }

    if (!hit) unmatched++;
  }

  const matches: DecisionMatch[] = [];
  let ambiguous = 0;
  for (const [complaintNo, acts] of claims) {
    if (acts.size !== 1) {
      // Two different acts both resolve to this complaint — we cannot say which
      // is its outcome, so it gets none. Counted, never guessed.
      ambiguous++;
      continue;
    }
    const d = [...acts.values()][0];
    matches.push({
      complaintNo,
      actNo: d.no,
      decisionDate: d.ddate,
      outcome: classifyOutcome(d.pron),
    });
  }

  // Stable order so a diff of two runs is comparable. localeCompare (not a
  // `< ? -1 : 1` comparator) because that one never returns 0, so equal keys sort
  // inconsistently by argument order — defeating the stability it is here for.
  matches.sort((a, b) => a.complaintNo.localeCompare(b.complaintNo));
  return {
    matches,
    reached: reached.size,
    ambiguous,
    partyAmbiguous,
    unmatched,
  };
};
