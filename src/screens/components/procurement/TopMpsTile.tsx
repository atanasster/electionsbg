// Dashboard tile: top MPs ranked by total procurement awarded to their
// connected companies. Per-NS by default (reflects the selected parliament's
// term); the standalone page at /procurement/mps shows the same data with a
// pageable table + the "show all years" toggle.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type {
  ProcurementByNsFile,
  ProcurementByNsTopMp,
} from "@/data/dataTypes";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";
import { useMpParty } from "@/data/procurement/useMpParty";
import { useMps } from "@/data/parliament/useMps";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { ConfidenceBadge } from "@/screens/components/connections/ConfidenceBadge";

const TOP_ROWS = 10;

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

// Compact row matching the dashboard convention used by MpAssetsTile /
// MpConnectionsTile — flex row, no bordered table wrapper. The party chip
// uses the same colour mapping as everywhere else (PartyTag); the lookup
// covers former MPs too (see useMpParty), so the chip should render on
// every row unless we genuinely have no record of the MP.
const renderMps = (
  rows: ProcurementByNsTopMp[],
  partyForMp: (id: number) => string | undefined,
  displayMpName: (mpId: number, fallback: string) => string,
) => (
  <div className="flex flex-col">
    {rows.map((e, idx) => {
      const display = displayMpName(e.mpId, e.mpName);
      return (
        <div
          key={e.mpId}
          className="text-sm flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0"
        >
          <span className="text-muted-foreground w-5 shrink-0 text-right tabular-nums text-xs">
            {idx + 1}
          </span>
          <Link
            to={`/candidate/mp-${e.mpId}#mp-procurement`}
            className="font-medium hover:underline inline-flex items-center gap-2 min-w-0 flex-1"
          >
            <MpAvatar mpId={e.mpId} name={display} />
            <span className="min-w-0">
              <span className="truncate block">{display}</span>
              {e.topContractorNames.length > 0 ? (
                <span className="text-xs text-muted-foreground truncate block">
                  {e.topContractorNames.join(", ")}
                </span>
              ) : null}
            </span>
          </Link>
          <PartyTag partyShort={partyForMp(e.mpId)} />
          {e.confidence === "medium" ? (
            <ConfidenceBadge confidence="medium" showHigh={false} />
          ) : null}
          <span className="tabular-nums shrink-0 min-w-[70px] text-right font-medium">
            €{formatEur.format(Math.round(e.totalEur))}
          </span>
          <span className="text-muted-foreground tabular-nums shrink-0 text-xs w-6 text-right hidden md:inline">
            {e.contractorCount}
          </span>
        </div>
      );
    })}
  </div>
);

export const TopMpsTile: FC<{
  data?: ProcurementByNsFile | null;
}> = ({ data: dataProp }) => {
  const { t } = useTranslation();
  const q = useProcurementByNs(dataProp === undefined);
  const { partyForMp } = useMpParty();
  const { findMpById } = useMps();
  const { mpName } = useCandidateName();
  const displayMpName = (mpId: number, fallback: string) => {
    const mp = findMpById(mpId);
    return mp ? mpName(mp) : fallback;
  };
  const data = dataProp !== undefined ? dataProp : q.data;
  const isLoading = dataProp !== undefined ? false : q.isLoading;

  if (isLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[440px]" />
        </CardContent>
      </Card>
    );
  }
  if (!data || data.topMps.length === 0) return null;
  const rows = data.topMps.slice(0, TOP_ROWS);

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4 text-amber-600" />
          {t("procurement_top_mps") || "Top MPs by connected procurement"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("procurement_top_mps_subtitle") ||
              "MPs whose declared business interests received the most procurement in the period."}
          </span>
          <Link
            to="/procurement/mps"
            className="ml-auto text-[10px] normal-case text-primary hover:underline"
          >
            {t("procurement_tile_see_all") || "See all"} →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {renderMps(rows, partyForMp, displayMpName)}
      </CardContent>
    </Card>
  );
};
