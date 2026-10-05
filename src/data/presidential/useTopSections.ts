// A presidential settlement's polling stations ranked by votes cast for a pair, with each
// station's address and leading ticket — the rows behind the „Топ секции" tile, and the gate its
// section heading uses, so the two cannot disagree about whether there is anything to show.
//
// ⚠ THE ADDRESS IS THE PARLIAMENTARY ARCHIVE'S, joined by station code exactly as the
// settlement's station map joins its coordinates. A code the archive does not list has no
// address („"), never a guessed one.

import { useMemo } from "react";
import { stripSettlementFromAddress } from "@/screens/dashboard/sectionAddress";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import { usePresidentialSectionRollup } from "./useSectionRollup";

export type TopSectionRow = {
  code: string;
  address: string;
  total: number;
  leader?: { number: number; votes: number };
};

/** The settlement's stations, ranked — `[]` until the shard is ready. Shared with the section
 *  gate so the heading and the tile can never disagree about whether there is anything. */
export const useTopSections = (
  cycle: string,
  round: 1 | 2,
  ekatte: string | undefined,
): TopSectionRow[] => {
  const { findSettlement } = useSettlementsInfo();
  const place = ekatte ? findSettlement(ekatte) : undefined;
  const rollup = usePresidentialSectionRollup(cycle, round, place?.oblast);
  const { settlement } = useSettlementVotes(ekatte ?? "");
  return useMemo(() => {
    if (rollup.status !== "ready" || !ekatte) return [];
    const address = new Map<string, string>();
    for (const s of settlement?.sections ?? [])
      address.set(
        String(s.section),
        stripSettlementFromAddress(s.address, s.settlement),
      );
    return rollup.rows
      .filter((r) => r.ekatte === ekatte)
      .map<TopSectionRow>((r) => {
        let best: TopSectionRow["leader"];
        let total = 0;
        for (const v of r.votes) {
          total += v.totalVotes;
          if (
            !best ||
            v.totalVotes > best.votes ||
            (v.totalVotes === best.votes && v.partyNum < best.number)
          )
            best = { number: v.partyNum, votes: v.totalVotes };
        }
        return {
          code: r.code,
          address: address.get(r.code) ?? "",
          total,
          leader: best && best.votes > 0 ? best : undefined,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  }, [rollup, ekatte, settlement]);
};
