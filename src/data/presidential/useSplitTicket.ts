// One cycle's split-ticket comparison — `<cycle>/split_ticket.json`.
//
// ⚠⚠ THE HEADLINE FIGURE IS A LOWER BOUND AND THE GUARD REFUSES A FILE THAT HAS FORGOTTEN TO
// SAY SO. `basis` carries the derivation — two sets drawn from one section's voters, so the
// number who voted differently on the two ballots is at least the difference between their
// sizes — and a payload without it lets a surface render „41,235 split their ticket" as a
// measurement rather than a floor. Same rule, same reason, as `useRunoffTransfer`.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR, and here that is the NORMAL case: only 2021 had a
// parliamentary election on the same day, so four of the five cycles have no such file by
// construction. Throwing would put the ordinary state into React Query's retry-and-error path.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { guardedFetch, makeWarnOnce, num, str } from "./guardedFetch";

export interface SplitPair {
  /** The ballot number, which is the SAME on both ballots — that is what confirms the match. */
  number: number;
  president: string;
  nominator: string;
  listName: string;
  ticketVotes: number;
  listVotes: number;
  /** ⚠ SUMMED PER SECTION. See `basis` — the national difference is a far weaker bound. */
  minSplitVoters: number;
  sections: number;
}

/**
 * A pair joined to a list by a published ENDORSEMENT rather than by the ballot's nominator.
 *
 * ⚠⚠ IT LIVES IN ITS OWN ARRAY AND MUST STAY THERE. The floor is computed identically — the
 * arithmetic holds for any two columns of the same protocols — but „ДПС's list voters against
 * ДПС's ticket" is one entity on one ballot, while „ГЕРБ-СДС's list against the pair ГЕРБ-СДС
 * backed" is two entities joined by a political fact somebody else published. Merging the two
 * arrays would let one render under the other's heading.
 */
export interface EndorsedPair extends SplitPair {
  /** The parliamentary ballot number compared against. ⚠ NOT equal to `number` — for a
   *  nominator-matched pair the two agree and that agreement is the proof; here they are two
   *  different entities, which is exactly what this field records. */
  listNumber: number;
  /** ⚠ REQUIRED WHEREVER A ROW IS. The join is the one claim this family makes that the
   *  register does not, so the evidence travels with the figure. */
  sourceUrl: string;
}

export interface RefusedTicket {
  number: number;
  president: string;
  nominator: string;
  kind: string;
  /** ⚠ TWO KINDS OF FACT IN ONE FIELD, AND A SURFACE MUST NOT MERGE THEM. `committee` and
   *  `no-list` are facts about the BALLOT — this nominator put up no list. `ambiguous-name` and
   *  `number-mismatch` are facts about OUR MATCHER. Describing the second pair as „nominated by
   *  an initiative committee" publishes a nominator kind the register did not record, which is
   *  the same unsupported attribution this whole feature exists to refuse, pointed the other
   *  way. */
  reason: "committee" | "no-list" | "ambiguous-name" | "number-mismatch";
  /** ⚠ THE FACT THAT MAKES THE REFUSAL COSTLY — and therefore the one a surface must show. */
  reachedRunoff: boolean;
}

export interface SplitTicket {
  cycle: string;
  sameDayElection: string;
  basis: string;
  basisEn: string;
  pairs: SplitPair[];
  /** ⚠ OPTIONAL ON PURPOSE — DEPLOY ORDER. `split_ticket.json` is gitignored and reaches the
   *  bucket only through `bucket:gz`, so a bundle carrying this field will meet an artifact
   *  built before it. Required, the guard would reject that file and take the WHOLE tile down
   *  to teach a reader nothing; optional, the main table renders and the endorsement block
   *  simply is not there yet. */
  endorsed?: EndorsedPair[];
  endorsedBasis?: string;
  endorsedBasisEn?: string;
  refused: RefusedTicket[];
  coverage: {
    basis: string;
    basisEn: string;
    sectionsMatched: number;
    sectionsPvrOnly: number;
    sectionsNsOnly: number;
  };
}

export type SplitTicketState =
  | { status: "loading" }
  | { status: "ready"; split: SplitTicket }
  | { status: "absent" }
  | { status: "unusable" };

export const isSplitTicket = (v: unknown): v is SplitTicket => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!str(o.basis) || !str(o.basisEn)) return false;
  if (!Array.isArray(o.pairs) || !Array.isArray(o.refused)) return false;
  const cov = o.coverage as Record<string, unknown> | undefined;
  if (!str(cov?.basis) || !str(cov?.basisEn)) return false;
  // ⚠ THE NUMERIC HALF, GUARDED TOO. The prose check alone lets `sectionsMatched: null` reach
  // `formatInt` and a pair missing `minSplitVoters` render as „поне undefined" — a refusal is
  // the right posture for both, the same as for a lost derivation.
  if (!num(cov?.sectionsMatched) || !num(cov?.sectionsNsOnly)) return false;
  if (
    !(o.pairs as unknown[]).every((p) => {
      const r = p as Record<string, unknown>;
      return num(r?.minSplitVoters) && num(r?.listVotes) && num(r?.ticketVotes);
    })
  )
    return false;
  // ⚠ ABSENT IS FINE (see the field); PRESENT AND MALFORMED IS NOT. An endorsement row without
  // its `sourceUrl` is this site asserting that a party backed a named candidate, with nothing
  // a reader can check — the row's whole licence — so a payload carrying one is refused rather
  // than rendered with a dead „източник".
  if (o.endorsed === undefined) return true;
  if (!Array.isArray(o.endorsed)) return false;
  if (o.endorsed.length && (!str(o.endorsedBasis) || !str(o.endorsedBasisEn)))
    return false;
  return (o.endorsed as unknown[]).every((p) => {
    const r = p as Record<string, unknown>;
    return (
      num(r?.minSplitVoters) &&
      num(r?.listVotes) &&
      num(r?.ticketVotes) &&
      num(r?.listNumber) &&
      str(r?.president) &&
      str(r?.listName) &&
      str(r?.sourceUrl) &&
      (r.sourceUrl as string).startsWith("https://")
    );
  });
};

export const splitTicketPath = (cycle: string): string =>
  `${cycle}/split_ticket.json`;

// ⚠ ONE SET PER MODULE, so a broken origin on one artifact cannot silence another's
// first warning. The state machine itself lives in `guardedFetch`.
const { warnOnce, reset } = makeWarnOnce();

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetSplitTicketWarnings = reset;

export const fetchSplitTicket = async (
  cycle: string,
): Promise<SplitTicketState> => {
  const got = await guardedFetch({
    path: splitTicketPath(cycle),
    id: cycle,
    prefix: "st",
    subject: "split ticket",
    guard: isSplitTicket,
    shapeMessage:
      "missing the lower bound's derivation — refusing to render it",
    warnOnce,
    toUrl: (path) => dataUrl(`/${path}`),
  });
  // ⚠ THE PAYLOAD KEEPS ITS OWN NAME. `split` is what every consumer destructures;
  // renaming it to a generic `value` would rewrite five surfaces for no reader's benefit.
  return got.status === "ready" ? { status: "ready", split: got.value } : got;
};

export const useSplitTicket = (cycle: string | undefined): SplitTicketState => {
  const q = useQuery({
    queryKey: ["presidential_split_ticket", cycle ?? ""],
    queryFn: () => fetchSplitTicket(cycle as string),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
