// One round's demographic cleavages — `<cycle>/tur<round>/demographic_cleavages.json`.
//
// ⚠⚠ THE ECOLOGICAL CAVEAT LIVES IN THE FILE AND THIS HOOK REFUSES A FILE WITHOUT ONE. „r =
// +0.88 against religionMuslim" is a claim about PLACES — municipalities with more Muslim
// residents gave this pair a larger share — and a dot on a −1…+1 track is exactly the shape
// that invites a reader to make it a claim about people, which is the ecological fallacy. So a
// payload missing `basis` is `unusable` rather than `ready`, and „the plot rendered" implies
// „the caveat rendered". The same rule `useRunoffTransfer` states for the transition matrix.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR. `data/*_pvr` is gitignored and reaches the bucket
// only through `bucket:gz`, and the producer writes nothing for a round in which fewer than two
// tickets clear its readability cut — so „no such analysis" is an ordinary answer and must not
// enter React Query's retry-and-error path.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { CensusMetric } from "@/data/census/censusTypes";

export interface PresidentialCleavageTicket {
  number: number;
  /** ⚠ BULGARIAN IN BOTH LANGUAGES — a person's name is not translated. */
  president: string;
  color?: string;
  /** The PUBLISHED national share of valid votes, not the share of the correlated base. */
  pctNational: number;
}

export interface PresidentialCleavageRow {
  metric: CensusMetric;
  /** One r per ticket, in `tickets` order. */
  rs: number[];
  spread: number;
}

export interface PresidentialCleavages {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  /** The n behind every r. */
  municipalities: number;
  votes: number;
  /** Outside every r by construction — a section abroad belongs to no Bulgarian municipality. */
  abroadVotes: number;
  /** Votes the producer could not place in a municipality. Zero on every committed cycle. */
  unmappedVotes: number;
  tickets: PresidentialCleavageTicket[];
  rows: PresidentialCleavageRow[];
}

/** ⚠ FOUR STATES, NOT A BOOLEAN — the presidential family's rule: „not published yet" and
 *  „published but unreadable" are different instructions to a screen. */
export type PresidentialCleavagesState =
  | { status: "loading" }
  | { status: "ready"; cleavages: PresidentialCleavages }
  | { status: "absent" }
  | { status: "unusable" };

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const isPresidentialCleavages = (
  v: unknown,
): v is PresidentialCleavages => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // ⚠ BOTH LANGUAGES. An EN reader of a file carrying only the Bulgarian sentence would get the
  // dots with no caveat at all.
  if (!str(o.basis) || !str(o.basisEn)) return false;
  if (!Array.isArray(o.tickets) || o.tickets.length < 2) return false;
  // ⚠⚠ EVERY LEAF THE PLOT DEREFERENCES — THE TICKET SIDE TOO, and this half was missing.
  // `DemographicCleavagesPlot` reads `p.pctNational.toFixed(1)` UNGUARDED and uses `partyNum`
  // as its React key, so a `tickets: [{}, {}]` payload passed a length-only check and then
  // threw `TypeError: Cannot read properties of undefined (reading 'toFixed')` during render —
  // which, with no error boundary anywhere in `src/`, unmounts the React ROOT rather than
  // degrading this one tile. Reachable by a truncated artifact on the bucket or by a producer
  // field rename shipping ahead of the bundle.
  if (
    !(o.tickets as unknown[]).every((tk) => {
      if (typeof tk !== "object" || tk === null) return false;
      const t = tk as Record<string, unknown>;
      return num(t.number) && num(t.pctNational) && str(t.president);
    })
  )
    return false;
  if (!Array.isArray(o.rows) || o.rows.length === 0) return false;
  // ⚠ EVERY LEAF THE PLOT DEREFERENCES. A guard that stopped at „rows is an array" lets a
  // truncated file through, and the plot then indexes `payload.parties[i]` off `undefined` —
  // which, with no error boundary in `src/`, unmounts the React root rather than degrading.
  return (o.rows as unknown[]).every((r) => {
    const row = r as Record<string, unknown>;
    return (
      typeof row?.metric === "string" &&
      typeof row?.spread === "number" &&
      Array.isArray(row?.rs) &&
      (row.rs as unknown[]).length === (o.tickets as unknown[]).length &&
      (row.rs as unknown[]).every((x) => typeof x === "number")
    );
  });
};

export const presidentialCleavagesPath = (
  cycle: string,
  round: 1 | 2,
): string => `${cycle}/tur${round}/demographic_cleavages.json`;

const logged = new Set<string>();
/** ⚠ ONCE PER PROCESS PER REASON — the family's rule. „Not published" is expected and
 *  „malformed" is a defect, and a per-render warning is a log nobody reads. */
const warnOnce = (key: string, message: string): void => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
};

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetPresidentialCleavagesWarnings = (): void => logged.clear();

export const fetchPresidentialCleavages = async (
  cycle: string,
  round: 1 | 2,
): Promise<PresidentialCleavagesState> => {
  const id = `${cycle}/tur${round}`;
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${presidentialCleavagesPath(cycle, round)}`));
  } catch (e) {
    // ⚠ A REJECTED FETCH LOOKS EXACTLY LIKE ROUTINE ABSENCE — a CORS misconfiguration on the
    // bucket takes every cycle out at once, and uncaught it reads as „no such analysis".
    warnOnce(
      `pc:net:${id}`,
      `presidential cleavages ${id}: fetch failed (${e})`,
    );
    return { status: "unusable" };
  }
  if (res.status === 404) return { status: "absent" };
  if (!res.ok) {
    warnOnce(
      `pc:http:${id}`,
      `presidential cleavages ${id}: HTTP ${res.status}`,
    );
    return { status: "unusable" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    warnOnce(`pc:json:${id}`, `presidential cleavages ${id}: not JSON`);
    return { status: "unusable" };
  }
  if (!isPresidentialCleavages(body)) {
    warnOnce(
      `pc:shape:${id}`,
      `presidential cleavages ${id}: missing the ecological caveat or its rows — refusing to render it`,
    );
    return { status: "unusable" };
  }
  return { status: "ready", cleavages: body };
};

export const usePresidentialCleavages = (
  cycle: string | undefined,
  round: 1 | 2,
): PresidentialCleavagesState => {
  const q = useQuery({
    queryKey: ["presidential_cleavages", cycle ?? "", round],
    queryFn: () => fetchPresidentialCleavages(cycle as string, round),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
