// One round's suspicious-settlement flags — `<cycle>/tur<round>/suspicious_settlements.json`.
//
// ⚠⚠ „A RED FLAG, NOT A VERDICT" LIVES IN THE FILE AND THIS HOOK REFUSES A FILE WITHOUT IT.
// The payload names villages, so a surface that drew the list without the sentence would be
// publishing an accusation the data does not make — none of the three thresholds proves
// wrongdoing on its own. The same rule `useRunoffTransfer` states for the transition matrix,
// and it matters more here because the subject is a named place rather than an estimate.
//
// ⚠ `discriminating` IS THE OTHER HALF, AND A CONSUMER MUST NOT SECOND-GUESS IT. When it is
// false the producer publishes NO names — on 2006's runoff the concentration rule caught 2,537
// settlements of which 205 sat at exactly 100%, so any three were an arbitrary pick — and the
// count and the national rate are what a surface renders instead.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR. `data/*_pvr` is gitignored and reaches the bucket
// only through `bucket:gz`, so „not published yet" is the ordinary answer. The four-state
// machine and the `warnOnce` set behind it are `./guardedFetch`, shared with every other
// presidential hook.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { SuspiciousTopSettlement } from "@/data/dashboard/useSuspiciousSections";
import { guardedFetch, makeWarnOnce, num, str } from "./guardedFetch";

/** ⚠ A NARROWING OF THE PARLIAMENTARY ROW, NOT A SECOND DECLARATION OF IT. The producer emits
 *  exactly `SuspiciousTopSettlement` (`build_suspicious.ts` imports it from
 *  `scripts/reports/suspiciousSections`), so a field added there reaches this consumer too.
 *
 *  ⚠ NO PARTY. A presidential row is a PAIR rather than a party, so `partyNum`/`partyVotes` are
 *  REMOVED rather than left unread — see `PresidentialSuspiciousTile`'s header. Stating that as
 *  an `Omit` is the difference between a deliberate narrowing and a copy that drifted. */
export type SuspiciousPlace = Omit<
  SuspiciousTopSettlement,
  "partyNum" | "partyVotes"
>;

export interface SuspiciousCategoryPayload {
  count: number;
  /** The bar a settlement had to clear, as a PERCENTAGE (0-100), like `nationalPct` and
   *  `SuspiciousPlace.value`. */
  threshold: number;
  /** The cycle's own rate on the same measure, over EVERY section — the baseline that says
   *  whether `threshold` is a high bar this year. Also 0-100. */
  nationalPct: number;
  /** Settlements the rule could be computed for. ⚠ NOT the settlement total: the invalid rule
   *  needs a paper denominator, which machine voting removes from most of 2021. */
  measurableSettlements: number;
  /** ⚠ A FRACTION (0-1), UNLIKE EVERY OTHER PERCENTAGE HERE — `count / measurableSettlements`.
   *  `discriminating` is derived by the producer from this comparison, so a consumer that
   *  recomputes it can disagree at the boundary: render this, never re-derive the verdict. */
  flaggedShare: number;
  /** ⚠ FALSE MEANS „THIS FLAG SAYS NOTHING THIS CYCLE", not „nothing was flagged" — and `top`
   *  is EMPTY in that state by construction. */
  discriminating: boolean;
  top: SuspiciousPlace[];
  /** ⚠ NO CONSUMER TODAY, and deliberately unvalidated for that reason — the guard checks the
   *  leaves a surface dereferences and nothing more. Mirrored from the artifact because the
   *  parliamentary `computeRiskComposite` vote-weights its composite on the same field, so a
   *  presidential risk index would need no producer change. */
  votesAffected: number;
}

export interface PresidentialSuspicious {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  coverage: {
    settlements: number;
    /** ⚠ NO CONSUMER TODAY — see `votesAffected`. The tile renders the two `…WithoutEkatte`
     *  figures, which are what the caveat needs. */
    sections: number;
    /** ⚠ SOFIA AND THE ABSORBED QUARTERS — outside every figure in this payload. */
    sectionsWithoutEkatte: number;
    votesWithoutEkatte: number;
  };
  concentrated: SuspiciousCategoryPayload;
  invalidBallots: SuspiciousCategoryPayload;
  additionalVoters: SuspiciousCategoryPayload;
}

/** ⚠ FOUR STATES, NOT A BOOLEAN — the presidential family's rule. */
export type PresidentialSuspiciousState =
  | { status: "loading" }
  | { status: "ready"; suspicious: PresidentialSuspicious }
  | { status: "absent" }
  | { status: "unusable" };

const isCategory = (v: unknown): v is SuspiciousCategoryPayload => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (
    !num(c.count) ||
    !num(c.threshold) ||
    !num(c.nationalPct) ||
    !num(c.measurableSettlements) ||
    // ⚠⚠ THE NON-DISCRIMINATING BRANCH IS THIS FIELD'S ONLY READER, and `null * 100` is 0 in
    // JavaScript while `formatPct(0)` is „0%" rather than „—". Unguarded, a null therefore
    // prints „обхваща 0% от измеримите населени места" inside the sentence explaining that the
    // flag separated nothing — a contradiction a reader cannot detect, on the one column that
    // exists to stop an unfair accusation. A dash is survivable; a fabricated 0 is not.
    !num(c.flaggedShare) ||
    typeof c.discriminating !== "boolean" ||
    !Array.isArray(c.top)
  )
    return false;
  // ⚠ EVERY LEAF A ROW DEREFERENCES. A named place with no name renders as a blank line in a
  // list of flagged settlements, which reads as one more place rather than as a broken row.
  return (c.top as unknown[]).every((t) => {
    const p = t as Record<string, unknown>;
    return typeof t === "object" && t !== null && str(p.ekatte) && num(p.value);
  });
};

export const isPresidentialSuspicious = (
  v: unknown,
): v is PresidentialSuspicious => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // ⚠ BOTH LANGUAGES. An EN reader of a file carrying only the Bulgarian sentence would get a
  // list of named villages with no caveat at all.
  if (!str(o.basis) || !str(o.basisEn)) return false;
  const cov = o.coverage as Record<string, unknown> | undefined;
  if (
    !num(cov?.settlements) ||
    !num(cov?.sectionsWithoutEkatte) ||
    // ⚠ THE TILE RENDERS THIS ONE TOO — half a million votes on a real cycle. A dash there
    // turns the София caveat into a sentence with a hole in it, on the line that stops a
    // settlement-grain count reading as a national one.
    !num(cov?.votesWithoutEkatte)
  )
    return false;
  return (
    isCategory(o.concentrated) &&
    isCategory(o.invalidBallots) &&
    isCategory(o.additionalVoters)
  );
};

/** ⚠ „READY" IS NOT „HAS SOMETHING TO SAY". A round whose every rule was unmeasurable — no
 *  paper denominator, no roll, no valid votes — publishes three zeros over „measurable for 0
 *  settlements", which reads as „nothing was wrong here" when the truth is that nothing could
 *  be checked. Gate a surface on this, never on the query status: it is the same rule the
 *  geography section's `hasCleavages` follows, and the flash tile's own `tickets.length`.
 *
 *  ⚠ A MEASURABLE RULE WITH A ZERO COUNT IS CONTENT and passes. „0 settlements above 10%
 *  invalid, out of 2,341 measurable, against a national 0.4%" is an answer. */
export const hasSuspiciousContent = (s: PresidentialSuspicious): boolean =>
  [s.concentrated, s.invalidBallots, s.additionalVoters].some(
    (c) => c.measurableSettlements > 0,
  );

export const suspiciousPath = (cycle: string, round: 1 | 2): string =>
  `${cycle}/tur${round}/suspicious_settlements.json`;

// ⚠ ONE SET PER MODULE, so a broken origin on one artifact cannot silence another's first
// warning. The state machine itself lives in `guardedFetch`.
const { warnOnce, reset } = makeWarnOnce();

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetSuspiciousSettlementsWarnings = reset;

export const fetchPresidentialSuspicious = async (
  cycle: string,
  round: 1 | 2,
): Promise<PresidentialSuspiciousState> => {
  const got = await guardedFetch({
    path: suspiciousPath(cycle, round),
    id: `${cycle}/tur${round}`,
    prefix: "ss",
    subject: "suspicious settlements",
    guard: isPresidentialSuspicious,
    shapeMessage:
      "missing the red-flag caveat or a category — refusing to render it",
    warnOnce,
    toUrl: (path) => dataUrl(`/${path}`),
  });
  return got.status === "ready"
    ? { status: "ready", suspicious: got.value }
    : got;
};

export const usePresidentialSuspicious = (
  cycle: string | undefined,
  round: 1 | 2,
): PresidentialSuspiciousState => {
  const q = useQuery({
    queryKey: ["presidential_suspicious", cycle ?? "", round],
    queryFn: () => fetchPresidentialSuspicious(cycle as string, round),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
