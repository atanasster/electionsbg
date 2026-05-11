import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { formatPct } from "@/data/utils";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useRegionWastedVotes } from "@/data/wastedVote/useWastedVote";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import regions from "@/data/json/regions.json";

// Dashboard tile surfacing the national wasted-vote share and the top-3
// most-affected regions. Reads from the already-cached national_summary +
// the per-region rollup so no extra fetch is incurred for this tile when
// the dashboard is the landing page.
type Props = {
  regionCode?: string;
  regionCodes?: string[];
};

export const WastedVoteTile: FC<Props> = ({ regionCode, regionCodes }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data: summary } = useNationalSummary();
  const { data: regionRows } = useRegionWastedVotes();

  const top = useMemo(() => {
    if (!regionRows) return [];
    const filtered = regionRows.filter((r) => {
      if (r.key === "32") return false; // diaspora
      if (regionCode) return r.key === regionCode;
      if (regionCodes?.length) return regionCodes.includes(r.key);
      return true;
    });
    return filtered.slice(0, 3).map((r) => {
      const info = regions.find((rg) => rg.oblast === r.key) as
        | {
            name?: string;
            name_en?: string;
            long_name?: string;
            long_name_en?: string;
          }
        | undefined;
      const name = isBg
        ? info?.long_name || info?.name
        : info?.long_name_en || info?.name_en;
      return {
        key: r.key,
        name,
        share: r.share,
      };
    });
  }, [regionRows, regionCode, regionCodes, isBg]);

  const wasted = summary?.wastedVotes;
  if (!wasted) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("wasted_votes_share_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Vote className="h-4 w-4" />
              <span>{t("wasted_votes_title")}</span>
            </div>
          </Hint>
          <Link
            to="/wasted-vote"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums">
          {formatPct(wasted.share, 2)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("wasted_votes_share_national")}
        </span>
      </div>
      {top.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="text-muted-foreground pb-1">
            {t("wasted_votes_top_parties")}
          </div>
          <ul className="space-y-0.5">
            {top.map((r) => (
              <li key={r.key} className="flex justify-between">
                <span>{r.name || r.key}</span>
                <span className="font-mono">{formatPct(r.share, 2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </StatCard>
  );
};
