// The candidate's ballot in the selected election, rendered as a compact, elegant line:
// the party badge followed by one rounded chip per region (region name + preference number).
// Replaces the old stacked party-box + region + "#pref" rows. Shared by the candidate
// sub-page header (CandidateProfileHeader) and the legacy candidate dashboard (CandidateHeader).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { PartyBadge } from "@/screens/components/PartyBadge";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useRegions } from "@/data/regions/useRegions";
import type { CandidatesInfo } from "@/data/dataTypes";

export type BallotRow = Pick<CandidatesInfo, "partyNum" | "oblast" | "pref">;

export const CandidateBallot: FC<{ rows?: BallotRow[] }> = ({ rows }) => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";
  const { findParty } = usePartyInfo();
  const { findRegion } = useRegions();

  if (!rows || rows.length === 0) return null;

  // Group regions under their party (one candidate is usually a single party, but a namesake
  // shard can carry more than one) — the party badge shows once, the regions line up after it.
  const order: number[] = [];
  const byParty = new Map<number, BallotRow[]>();
  for (const r of rows) {
    if (!byParty.has(r.partyNum)) {
      byParty.set(r.partyNum, []);
      order.push(r.partyNum);
    }
    byParty.get(r.partyNum)!.push(r);
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {order.map((partyNum) => {
        const party = findParty(partyNum);
        const partyRows = byParty.get(partyNum)!;
        const partyLabel = party
          ? ((isEn ? party.nickName_en : undefined) ?? party.nickName)
          : null;
        return (
          <div
            key={partyNum}
            className="inline-flex flex-wrap items-center gap-1.5"
          >
            {partyLabel && (
              <PartyBadge label={partyLabel} color={party?.color} />
            )}
            {partyRows.map((r) => {
              const region = findRegion(r.oblast);
              const label = region
                ? isEn
                  ? region.long_name_en || region.name_en
                  : region.long_name || region.name
                : r.oblast;
              return (
                <Link
                  key={`${r.oblast}-${r.pref}`}
                  to={`/municipality/${r.oblast}`}
                  underline={false}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  <span>{label}</span>
                  <span className="tabular-nums font-semibold text-muted-foreground">
                    №{r.pref}
                  </span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
