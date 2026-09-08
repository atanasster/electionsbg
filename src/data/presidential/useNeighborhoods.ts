// One round's flagged-district figures — `<cycle>/tur<round>/neighborhoods.json`.
//
// ⚠⚠ THE PAYLOAD IS ABOUT EIGHT NAMED ROMA DISTRICTS, so the caveat is not a formality and this
// hook refuses a file without it. `basis` says in the artifact that the figures are sums over
// POLLING STATIONS and not a statement about the people who voted in them, and it names the
// press sources the catalogue is curated from. A surface cannot supply that sentence itself,
// which only works if a file that lost it never renders.
//
// ⚠ COVERAGE IS PER CYCLE AND NOT MONOTONIC IN TIME — 2011 locates five of the eight districts
// and 2001 all eight, because section numbering moved rather than because anything changed on
// the ground. `coverage.located` / `coverage.missing` are therefore required leaves: a tile
// that showed the aggregate without them would present a different set of places under the same
// heading in every cycle.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR. `data/*_pvr` is gitignored and reaches the bucket
// only through `bucket:gz`. The four-state machine is `./guardedFetch`.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { guardedFetch, makeWarnOnce, num, str } from "./guardedFetch";

export interface NeighborhoodTicket {
  number: number;
  /** ⚠ THE BULGARIAN NAME, in both languages — a reader is matching it against a ballot. */
  president: string;
  votes: number;
  /** Share of the districts' valid votes, 0-100. */
  pct: number;
  /** The ticket's published national share, 0-100 — the only honest comparison for `pct`. */
  pctNational: number;
}

export interface NeighborhoodRates {
  /** ⚠ DOMESTIC SECTIONS ONLY, on BOTH sides of every comparison — the producer sums the 31
   *  oblast shards and never reads `abroad.json`. The PUBLISHED national turnout includes
   *  abroad and is higher (2021 r1: 40.30% against 37.20% here), so a surface must name the
   *  basis rather than write a bare „в страната" beside the published figure on the same page. */
  turnoutPct: number | null;
  /** ⚠ NULL WHERE THE DISTRICTS COUNTED ON MACHINES. 2021's eight districts filed 228 paper
   *  ballots in round 1 and 78 in the runoff, so a rate over them is not a measurement — the
   *  producer suppresses it rather than publishing „0% vs 1.5% nationally". */
  invalidPct: number | null;
  /** ⚠ NULL BELOW THE PRODUCER'S ACTUAL-VOTER FLOOR, for the same reason: 2021's Факултета is
   *  126 additions over 488 voters, and „a quarter of this neighbourhood was added to the roll
   *  on the day" is an allegation rather than a rate. */
  additionalPct: number | null;
  /** The denominator the rate above was, or was not, computed over. */
  paperBallots: number;
  /** The denominator `additionalPct` was, or was not, computed over. */
  actualVoters: number;
}

export interface NeighborhoodPlace {
  id: string;
  name_bg: string;
  name_en: string;
  city_bg: string;
  city_en: string;
  /** The published report the district is named in — rendered as a link, never as a claim of
   *  ours. */
  sourceUrl: string;
  sections: number;
  valid: number;
  turnoutPct: number | null;
  invalidPct: number | null;
  additionalPct: number | null;
  paperBallots: number;
  /** ⚠ THE „ГЛАСУВАЛИ" COLUMN, and it is the protocols' own count rather than `valid` — a
   *  voter who spoiled a ballot voted. The two are close and not equal. */
  actualVoters: number;
  /** ⚠ WHERE THE DISTRICT'S STATIONS SIT — ARRAYS, because a neighbourhood is not an
   *  administrative unit. ⚠⚠ ALL THREE CAN BE EMPTY: the placement pass refuses Sofia's
   *  Филиповци and Факултета in every cycle (no município, no ЕКАТТЕ) and on 2011 gives them no
   *  oblast either. A place page reads an empty list as „not here", never as a hole in the
   *  corpus — the country page still carries the district. */
  oblasts: string[];
  obshtini: string[];
  ekattes: string[];
  /** ⚠ THE SAME TICKET SET AS THE TOP-LEVEL ARRAY, per district, so a place-scoped view can
   *  re-aggregate its own answer instead of showing the country's under a place's name. */
  tickets: NeighborhoodTicket[];
  leader: {
    number: number;
    president: string;
    votes: number;
    pct: number;
  } | null;
}

export interface PresidentialNeighborhoods {
  cycle: string;
  round: 1 | 2;
  basis: string;
  basisEn: string;
  coverage: {
    catalogue: number;
    located: number;
    missing: { id: string; name_bg: string; name_en: string }[];
    sections: number;
    sectionsInCycle: number;
    validVotes: number;
    pctOfValid: number;
  };
  national: NeighborhoodRates;
  totals: NeighborhoodRates;
  tickets: NeighborhoodTicket[];
  places: NeighborhoodPlace[];
}

/** ⚠ FOUR STATES, NOT A BOOLEAN — the presidential family's rule. */
export type PresidentialNeighborhoodsState =
  | { status: "loading" }
  | { status: "ready"; neighborhoods: PresidentialNeighborhoods }
  | { status: "absent" }
  | { status: "unusable" };

/** ⚠ A NULLABLE RATE IS NOT AN ABSENT ONE. `null` is a published answer here („the protocols
 *  cannot say"), so the guard accepts it and rejects a string or a NaN. */
const rate = (v: unknown): boolean => v === null || num(v);

const isRates = (v: unknown): v is NeighborhoodRates => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    rate(r.turnoutPct) &&
    rate(r.invalidPct) &&
    rate(r.additionalPct) &&
    num(r.paperBallots) &&
    num(r.actualVoters)
  );
};

/** ⚠ ONE PREDICATE FOR BOTH TICKET ARRAYS — the top-level one and every district's. Written
 *  twice, the district arm is the copy that quietly stops checking. */
const isTicket = (t: unknown): t is NeighborhoodTicket => {
  if (typeof t !== "object" || t === null) return false;
  const x = t as Record<string, unknown>;
  return (
    num(x.number) &&
    str(x.president) &&
    num(x.votes) &&
    num(x.pct) &&
    num(x.pctNational)
  );
};

const isLeader = (v: unknown): v is NeighborhoodPlace["leader"] => {
  if (v === null) return true;
  if (typeof v !== "object") return false;
  const x = v as Record<string, unknown>;
  return num(x.number) && str(x.president) && num(x.votes) && num(x.pct);
};

/** An array of place codes: present, and every entry a string. EMPTY IS VALID — see
 *  `NeighborhoodPlace.oblasts`. */
const codes = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((c) => str(c));

export const isPresidentialNeighborhoods = (
  v: unknown,
): v is PresidentialNeighborhoods => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // ⚠ BOTH LANGUAGES. An EN reader of a file carrying only the Bulgarian sentence would get a
  // table of named Roma districts with no qualification and no sources at all.
  if (!str(o.basis) || !str(o.basisEn)) return false;
  const c = o.coverage as Record<string, unknown> | undefined;
  if (
    !num(c?.catalogue) ||
    !num(c?.located) ||
    !num(c?.sections) ||
    !num(c?.validVotes) ||
    !num(c?.pctOfValid) ||
    !Array.isArray(c?.missing)
  )
    return false;
  if (!isRates(o.national) || !isRates(o.totals)) return false;
  if (!Array.isArray(o.tickets) || !Array.isArray(o.places)) return false;
  // ⚠ THE TWO MUST AGREE. `hasNeighborhoodContent` gates the section on `coverage.located`, so
  // a payload claiming eight districts with an empty `places` array draws an empty table under
  // the heading — the one state that gate exists to prevent, arriving through the other field.
  if ((o.places as unknown[]).length !== c?.located) return false;
  // ⚠ EVERY LEAF A ROW DEREFERENCES. A ticket with no name renders as a blank row beside a
  // percentage on a list about vote-buying risk, which attributes the figure to nobody a reader
  // can check — and a place with no name does the same one table down.
  if (!(o.tickets as unknown[]).every(isTicket)) return false;
  return (o.places as unknown[]).every((p) => {
    const x = p as Record<string, unknown>;
    return (
      typeof p === "object" &&
      p !== null &&
      str(x.id) &&
      str(x.name_bg) &&
      // ⚠ THE PLACE CODES ARE REQUIRED AND MAY BE EMPTY — a missing ARRAY and an empty one are
      // different answers, and only the second is publishable. Absent, a place-scoped view
      // silently shows every district on every page.
      codes(x.oblasts) &&
      codes(x.obshtini) &&
      codes(x.ekattes) &&
      Array.isArray(x.tickets) &&
      (x.tickets as unknown[]).every(isTicket) &&
      // ⚠ NULL IS A PUBLISHED ANSWER („no ticket took a vote here"); a leader missing its vote
      // count is not, because the table prints that count beside the share.
      isLeader(x.leader) &&
      // ⚠⚠ THE SOURCE IS AN INVARIANT, NOT A DECORATION, and it stands with `basis` rather
      // than below it. „Рисков" is somebody else's published finding; a row that cannot link
      // to it presents that finding as this site's own — and with the attribute absent React
      // renders an underlined, non-navigable „източник", which looks like a link and is not.
      str(x.sourceUrl) &&
      (x.sourceUrl as string).startsWith("https://") &&
      // The city sits before the „ · " separator; empty, the row reads „ · източник".
      str(x.city_bg) &&
      num(x.sections) &&
      num(x.valid) &&
      isRates(x)
    );
  });
};

/** ⚠ „READY" IS NOT „HAS SOMETHING TO SAY" — the family's gating rule. A payload that located
 *  no district and lists no ticket is a heading over a blank, on the one section where a blank
 *  reads as an accusation nobody made. */
export const hasNeighborhoodContent = (n: PresidentialNeighborhoods): boolean =>
  n.coverage.located > 0 && n.tickets.length > 0;

export const neighborhoodsPath = (cycle: string, round: 1 | 2): string =>
  `${cycle}/tur${round}/neighborhoods.json`;

const { warnOnce, reset } = makeWarnOnce();

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetNeighborhoodsWarnings = reset;

export const fetchPresidentialNeighborhoods = async (
  cycle: string,
  round: 1 | 2,
): Promise<PresidentialNeighborhoodsState> => {
  const got = await guardedFetch({
    path: neighborhoodsPath(cycle, round),
    id: `${cycle}/tur${round}`,
    prefix: "nb",
    subject: "presidential neighbourhoods",
    guard: isPresidentialNeighborhoods,
    shapeMessage:
      "missing the districts' caveat, their coverage or a named row — refusing to render it",
    warnOnce,
    toUrl: (path) => dataUrl(`/${path}`),
  });
  return got.status === "ready"
    ? { status: "ready", neighborhoods: got.value }
    : got;
};

export const usePresidentialNeighborhoods = (
  cycle: string | undefined,
  round: 1 | 2,
): PresidentialNeighborhoodsState => {
  const q = useQuery({
    queryKey: ["presidential_neighborhoods", cycle ?? "", round],
    queryFn: () => fetchPresidentialNeighborhoods(cycle as string, round),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
