// Dashboard tile: the political class ranked TOGETHER by procurement awarded to
// their connected companies — MPs and non-MP officials (cabinet, governors,
// mayors, councillors…) interleaved by euro total, not split into two tiles.
// Mirrors the merged /procurement/mps page (its "see all" destination). Merging
// the two per-NS top lists and re-sorting is exact for a combined top-10: every
// entity in the combined top-10 is already in its own kind's top-10.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type {
  ProcurementByNsFile,
  ProcurementByNsTopMp,
  ProcurementByNsTopOfficial,
} from "@/data/dataTypes";
import { useProcurementByNs } from "@/data/procurement/useProcurementByNs";
import { normalizeMpName } from "@/lib/utils";
import { useMpParty } from "@/data/procurement/useMpParty";
import { useMps } from "@/data/parliament/useMps";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { ConfidenceBadge } from "@/screens/components/connections/ConfidenceBadge";

const TOP_ROWS = 10;

const formatEur = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

// Map a canonical role slug to a localized label via the shared official_role_*
// key family; fall back to the de-slugged role. Same convention as
// CompanyOfficialsTile.
const roleLabel = (role: string, t: (k: string) => string): string => {
  if (!role) return "";
  const key = `official_role_${role}`;
  const translated = t(key);
  return translated === key ? role.replace(/_/g, " ") : translated;
};

type Merged =
  | { kind: "mp"; total: number; mp: ProcurementByNsTopMp }
  | { kind: "official"; total: number; off: ProcurementByNsTopOfficial };

export const TopConnectedPeopleTile: FC<{
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
  if (!data) return null;
  // Someone who is both a sitting MP and a non-MP official (e.g. an MP who is
  // also a councillor) lands in both lists with the same connected total —
  // drop the official copy so they show once, under the richer MP identity
  // (party chip + candidate dashboard). Folded-name match; full 3-part names
  // make a cross-person collision unlikely.
  const mpNames = new Set(data.topMps.map((mp) => normalizeMpName(mp.mpName)));
  const merged: Merged[] = [
    ...data.topMps.map((mp) => ({
      kind: "mp" as const,
      total: mp.totalEur,
      mp,
    })),
    ...data.topOfficials
      .filter((off) => !mpNames.has(normalizeMpName(off.name)))
      .map((off) => ({
        kind: "official" as const,
        total: off.totalEur,
        off,
      })),
  ]
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_ROWS);
  if (merged.length === 0) return null;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4 text-amber-600" />
          {t("procurement_connected_people_title") ||
            "Connected MPs and officials"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("procurement_top_connected_subtitle") ||
              "MPs and public officials whose declared business interests received the most procurement in the period."}
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
        <div className="flex flex-col">
          {merged.map((row, idx) => {
            const rank = (
              <span className="text-muted-foreground w-5 shrink-0 text-right tabular-nums text-xs">
                {idx + 1}
              </span>
            );
            const amount = (total: number, count: number) => (
              <>
                <span className="tabular-nums shrink-0 min-w-[70px] text-right font-medium">
                  €{formatEur.format(Math.round(total))}
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0 text-xs w-6 text-right hidden md:inline">
                  {count}
                </span>
              </>
            );
            const contractorNames = (names: string[]) =>
              names.length > 0 ? (
                <span className="text-xs text-muted-foreground truncate block">
                  {names.join(", ")}
                </span>
              ) : null;

            if (row.kind === "mp") {
              const e = row.mp;
              const display = displayMpName(e.mpId, e.mpName);
              return (
                <div
                  key={`mp-${e.mpId}`}
                  className="text-sm flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0"
                >
                  {rank}
                  <Link
                    to={`/candidate/mp-${e.mpId}#mp-procurement`}
                    className="font-medium hover:underline inline-flex items-center gap-2 min-w-0 flex-1"
                  >
                    {/* h-8 w-8 to match the official icon so names line up in
                        one column (MpAvatar defaults to h-5 w-5). */}
                    <MpAvatar
                      mpId={e.mpId}
                      name={display}
                      className="h-8 w-8"
                    />
                    <span className="min-w-0">
                      <span className="truncate block">{display}</span>
                      {contractorNames(e.topContractorNames)}
                    </span>
                  </Link>
                  <PartyTag partyShort={partyForMp(e.mpId)} />
                  {e.confidence === "medium" ? (
                    <ConfidenceBadge confidence="medium" showHigh={false} />
                  ) : null}
                  {amount(e.totalEur, e.contractorCount)}
                </div>
              );
            }
            const e = row.off;
            return (
              <div
                key={`off-${e.slug}`}
                className="text-sm flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0"
              >
                {rank}
                <Link
                  to={`/officials/${e.slug}`}
                  className="font-medium hover:underline inline-flex items-center gap-2 min-w-0 flex-1"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
                    <Landmark className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="truncate block">{e.name}</span>
                    {contractorNames(e.topContractorNames)}
                  </span>
                </Link>
                {e.role ? (
                  <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                    {roleLabel(e.role, t)}
                  </span>
                ) : null}
                {amount(e.totalEur, e.contractorCount)}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
