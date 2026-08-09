// /api/db/funds-fit — „финансирано ли е нещо като моето" (migration 143).
//
// TWO ARMS, NEVER SUMMED. `isun` is the ИСУН corpus at PROCEDURE grain; `interreg` is the keep.eu
// corpus at operation grain. They are different bases — an ИСУН figure is a contract's own value,
// an Interreg figure is one Bulgarian partner's published budget — so a consumer that adds them
// produces a number with no definition. The `basis` block travels in the payload so no surface can
// render one arm and present it as the whole corpus.

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchJson } from "@/data/judiciary/fetchJson";

/** One ИСУН procedure — the „has anything like mine been funded" answer. */
export interface FundsFitIsunRow {
  procedureCode: string;
  /** Published for only 41% of procedures; `sampleTitle` stands in for the rest. Kept separate so
   *  a consumer can tell „this is the scheme's name" from „this is an example of what it funded". */
  procedureName: string | null;
  sampleTitle: string | null;
  programName: string | null;
  projectCount: number;
  beneficiaryCount: number;
  /** Signed contracts that have actually been PAID something. NOT an approval rate: ИСУН publishes
   *  no rejected applications, so the denominator for „одобрен ли е бил" does not exist. */
  paidProjectCount: number;
  totalEur: number;
  grantMedian: number | null;
  grantP25: number | null;
  grantP75: number | null;
  /** Top legal forms, `[{label, n}]`, already ordered by count. */
  orgKinds: { label: string; n: number }[];
  /** `{oblastCode: projectCount}` for EVERY oblast the procedure reached — an object, so the
   *  server's „how many near me" lookup is a key probe rather than an array scan. */
  oblasti: Record<string, number>;
  /** Projects in the asked-for oblast; 0 when none was asked or none are there. */
  localCount: number;
  score: number;
}

export interface FundsFitInterregRow {
  keepId: number;
  title: string;
  /** keep.eu publishes 2014-2020 titles in English only and we do NOT machine-translate them — a
   *  mistranslated operation name is unfindable in the register a reader would have to go to. The
   *  flag is what lets the UI mark the row rather than leave English sitting unexplained. */
  titleIsEnglish: boolean;
  programmeName: string | null;
  period: string;
  /** The BULGARIAN partner's budget, summed over that operation's partners — never the
   *  cross-border project total, which overstates what a Bulgarian applicant received. */
  bgBudgetEur: number | null;
  partnerCount: number;
  oblast: string | null;
  obshtina: string | null;
  isLocal: boolean;
  score: number;
}

/** What the answer is computed FROM. Rendered as a caption, not kept internal. */
export interface FundsFitBasis {
  isunProjects: number;
  isunProcedures: number;
  interregOperations: number;
  interregPartners: number;
  /** Of `interregPartners`. 2014-2020 Interreg carries no EIK, so an org breakdown over that arm
   *  is partial — the caption states the real share rather than a hedge. */
  interregWithEik: number;
}

export interface FundsFitResponse {
  q: string;
  oblast?: string | null;
  isun: FundsFitIsunRow[];
  interreg: FundsFitInterregRow[];
  /** The ENGLISH term the Interreg arm was actually searched with, when the reader's Bulgarian
   *  query was bridged to one — otherwise null. keep.eu publishes 86% of these titles in English
   *  only, so without the bridge a Bulgarian reader never sees this arm at all. Surfaced rather
   *  than applied silently: an English row under a Bulgarian query needs an explanation, and a
   *  reader who can see the term can tell when the bridge picked the wrong topic. */
  interregQuery: string | null;
  basis: FundsFitBasis | null;
}

/** Below this the trigram match is noise and the scan is wide. The route enforces it too. */
export const FIT_MIN_QUERY = 3;

export const useFundsFit = (
  q: string,
  oblast: string | null,
  opts: { enabled?: boolean } = {},
) => {
  const query = q.trim();
  return useQuery({
    queryKey: ["funds-fit", query, oblast ?? ""] as const,
    queryFn: async (): Promise<FundsFitResponse> => {
      const p = new URLSearchParams({ q: query });
      if (oblast) p.set("oblast", oblast);
      return await fetchJson<FundsFitResponse>(`/api/db/funds-fit?${p}`);
    },
    enabled: (opts.enabled ?? true) && query.length >= FIT_MIN_QUERY,
    // The corpus moves on a funds reload, not per request. But NOT `Infinity`: the tile is a
    // search box, and a reader refining „къща" → „къща за гости" should not be served the first
    // result set from cache for the rest of the session.
    staleTime: 30 * 60_000,
    // Keeps the previous answer on screen while the next one loads, so refining a query does not
    // flash „нищо намерено" — which, on this tile, is a statement rather than a loading state.
    placeholderData: keepPreviousData,
  });
};
