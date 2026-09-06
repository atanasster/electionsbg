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

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

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
  return (o.pairs as unknown[]).every((p) => {
    const r = p as Record<string, unknown>;
    return num(r?.minSplitVoters) && num(r?.listVotes) && num(r?.ticketVotes);
  });
};

export const splitTicketPath = (cycle: string): string =>
  `${cycle}/split_ticket.json`;

const logged = new Set<string>();
const warnOnce = (key: string, message: string): void => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
};

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetSplitTicketWarnings = (): void => logged.clear();

export const fetchSplitTicket = async (
  cycle: string,
): Promise<SplitTicketState> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${splitTicketPath(cycle)}`));
  } catch (e) {
    warnOnce(`st:net:${cycle}`, `split ticket ${cycle}: fetch failed (${e})`);
    return { status: "unusable" };
  }
  if (res.status === 404) return { status: "absent" };
  if (!res.ok) {
    warnOnce(`st:http:${cycle}`, `split ticket ${cycle}: HTTP ${res.status}`);
    return { status: "unusable" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // ⚠ A 200 CARRYING THE SPA SHELL. A `data/**` fetch that misses the bucket falls through to
    // the catch-all, which `firebase.json` stamps `application/json` — successful right up to
    // `JSON.parse`, and the one signature that separates a misconfigured data origin from an
    // absent file.
    warnOnce(`st:json:${cycle}`, `split ticket ${cycle}: not JSON`);
    return { status: "unusable" };
  }
  if (!isSplitTicket(body)) {
    warnOnce(
      `st:shape:${cycle}`,
      `split ticket ${cycle}: missing the lower bound's derivation — refusing to render it`,
    );
    return { status: "unusable" };
  }
  return { status: "ready", split: body };
};

export const useSplitTicket = (cycle: string | undefined): SplitTicketState => {
  const q = useQuery({
    queryKey: ["presidential_split_ticket", cycle ?? ""],
    queryFn: () => fetchSplitTicket(cycle as string),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
