// The per-arm breakdowns the four /culture/funds/<arm> pages chart.
//
// ⚠️ A SECOND ARTIFACT, DELIBERATELY, AND THIS IS THE WHOLE REASON IT EXISTS.
// These went into `hub_stats.json` first and took it from 789 B to 4,498 B, past
// the 4 KB budget `culture_hub_figures.data.test.ts` holds. That gate is right:
// /culture downloads the hub blob on every view and uses none of this, so a
// per-row payload there is paid by every reader of the hub to serve four
// sub-pages. Splitting it keeps the hub's payload where it was and costs the
// four pages one small extra fetch they alone make.
//
// Same generator (`npm run db:gen-culture-hub-stats`), same 404 → null degrade,
// and the same rule about figures: a page's numbers come from here, never from a
// literal in the copy.
//
// ⚠️ FOUR ARRAYS, NOT ONE KEYED BY ARM. Each is a different quantity over a
// different population — a grant, the same grant over a wider population, a
// published budget, a farm subsidy — so a shared shape with an `eur` field would
// be one a consumer could concatenate. That is the cross-arm addition
// /culture/funds exists to prevent.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface CultureFundSourceBreakdowns {
  generatedAt: string;
  /** How many DISTINCT bodies the EIK arm has in total — the denominator the
   *  chart's note needs, so it can say „10 of 31" rather than quoting the arm's
   *  project total over bars whose chips do not add to it. */
  eikBodyCount: number;
  /** Top 10 register bodies by grant, keyed by EIK.
   *
   *  ⚠️ THE EIK IS THE IDENTITY AND `name` IS ONLY A LABEL. This arm's whole
   *  value is that it is reached by an exact EIK match, and its 31 EIKs sit
   *  under 38 NAMES — six bodies are spelled two or three ways in ИСУН. Grouping
   *  on the name split Министерство на културата across two rows of one top ten.
   *  Key and link on `eik`; `name` is an arbitrary representative spelling. */
  eikByBeneficiary: {
    eik: string;
    name: string;
    eur: number;
    projects: number;
  }[];
  /** The name arm's programme split, by grant desc. ⚠️ ONE programme (the RRF)
   *  is ~80% of it, which is what the chart exists to show. */
  byNameByProgram: {
    code: string;
    name: string;
    eur: number;
    projects: number;
  }[];
  /** Published partner budget by cross-border programme, desc. */
  interregByProgramme: { code: string; eur: number; rows: number }[];
  /** ⚠️ ORDERED BY YEAR, not by money: a TIME series, and sorting it by size
   *  would draw a ranking that looks like a trend. The arm is heavily
   *  front-loaded, which a flat total hides. */
  agriByYear: { year: number; eur: number; rows: number }[];
}

/** 404 → null rather than a throw, exactly as `useCultureHubStats` does: a
 *  checkout that has never run the generator should render the page without its
 *  chart, not an error. The consumers treat null as „no chart", which is the
 *  honest state — an empty frame would read as „this arm has no breakdown". */
export const useCultureFundSources = () =>
  useQuery({
    queryKey: ["culture", "fund-sources"] as const,
    queryFn: async (): Promise<CultureFundSourceBreakdowns | null> => {
      const r = await fetch(dataUrl("/culture/derived/fund_sources.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return r.json() as Promise<CultureFundSourceBreakdowns>;
    },
    staleTime: Infinity,
  });
