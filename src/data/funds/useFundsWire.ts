// /api/db/funds-wire — the /funds band-0 wire and band-2 news rail (migration 144).
//
// EVERY FIGURE HERE IS AN INGEST WINDOW. `fund_projects` carries no date columns at all — ИСУН's
// beneficiary export publishes no signing, start or end date — so „нови" can only mean „new to
// us", and the copy has to say that rather than imply the lag is zero. The plan's rule „event
// date, not ingest date" was written for the procurement corpus, which has one; here there is
// nothing to prefer.

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/data/judiciary/fetchJson";

/** Backfill rows inside a window — reported, never hidden. On a corpus loaded in one go this is
 *  the difference between „quiet" and „broken pipeline". */
export interface FundsBackfill {
  backfillDays: number;
  backfillRows: number;
}

export interface FundsWire {
  /** The last day the funds ingest RAN, whether or not it found anything. „Обновено" means we
   *  looked — worth saying even on a day with no new rows. */
  checkedOn: string | null;
  /** The last day it FOUND something, excluding backfills. Null when the window is quiet. */
  lastChangeOn: string | null;
  newProjects: number;
  newEur: number;
  /** Days in the window that were backfills, reported rather than hidden — „82 011 при
   *  първоначално зареждане" is why the itemised number is small, and it is the difference
   *  between a quiet corpus and a broken pipeline. */
  backfillDays: number;
  backfillRows: number;
  openCalls: number;
}

export interface FundsNewsRow {
  card: string;
  rank: number;
  label: string;
  sublabel: string | null;
  href: string | null;
  amountEur: number | null;
  /** Disbursement percent — only on the `lowestPaid` card. */
  pct: number | null;
}

export interface FundsWireResponse {
  wire: FundsWire | null;
  news: {
    newContracts: FundsNewsRow[];
    byPlace: FundsNewsRow[];
    /** The 2014-2020 period only. On the full set a 0% procedure is indistinguishable from one
     *  signed last month, and presenting recency as underperformance is the „signal read as
     *  finding" failure — see 144's header. */
    lowestPaid: FundsNewsRow[];
  };
  windowDays: number;
  newsWindowDays: number;
  /** Backfills inside the NEWS window, which differs from the wire's. The real 81,616-row load
   *  sits inside one and outside the other, so the rail needs its own figure or it drops those
   *  rows from cards claiming to cover 60 days with nothing on the page to say so. */
  newsBackfill: FundsBackfill;
}

export const useFundsWire = () =>
  useQuery({
    queryKey: ["funds-wire"] as const,
    queryFn: async (): Promise<FundsWireResponse> =>
      await fetchJson<FundsWireResponse>("/api/db/funds-wire"),
    // The corpus moves on an ingest, which is at most daily. Not `Infinity`, because the whole
    // point of the wire is that it tells a returning reader something changed.
    staleTime: 30 * 60_000,
  });
