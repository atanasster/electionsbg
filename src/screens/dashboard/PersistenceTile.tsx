import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GitFork, ArrowRight } from "lucide-react";
import { formatPct, formatThousands } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useVoteFlowPersistence } from "@/data/voteFlows/useVoteFlow";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { oblastToMir } from "@/data/parliament/nsFolders";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import regionsJson from "@/data/json/regions.json";

type RegionMeta = {
  oblast: string;
  name?: string;
  name_en?: string;
  long_name?: string;
  long_name_en?: string;
};

// Home dashboard tile surfacing the national voter-persistence rate and
// the top-3 most stable / most volatile regions for the currently-selected
// election (paired with its prior).
export const PersistenceTile: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { selected, priorElections } = useElectionContext();
  const { data } = useVoteFlowPersistence(priorElections?.name, selected);
  const { displayNameForId } = useCanonicalParties();

  const { stable, volatile: vol } = useMemo(() => {
    const rows = (data?.byOblast ?? []).map((r) => {
      const info = (regionsJson as RegionMeta[]).find(
        (rr) => oblastToMir(rr.oblast) === r.oblast,
      );
      const name = info
        ? isBg
          ? info.long_name || info.name
          : info.long_name_en || info.name_en
        : undefined;
      return {
        mir: r.oblast,
        name: name || r.oblast,
        share: r.persistence.stayRate * 100,
      };
    });
    return {
      stable: [...rows].sort((a, b) => b.share - a.share).slice(0, 3),
      volatile: [...rows].sort((a, b) => a.share - b.share).slice(0, 3),
    };
  }, [data, isBg]);

  if (!data?.national) return null;
  const national = data.national;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("persistence_stay_rate_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <GitFork className="h-4 w-4" />
              <span>{t("persistence_title")}</span>
            </div>
          </Hint>
          <Link
            to="/persistence"
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
          {formatPct(national.stayRate * 100, 1)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("persistence_stay_rate")}
        </span>
      </div>
      {national.topDefection && (
        <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
          {displayNameForId(national.topDefection.fromId) ??
            national.topDefection.fromId}{" "}
          <ArrowRight className="inline-block h-3 w-3 mx-0.5" />{" "}
          {displayNameForId(national.topDefection.toId) ??
            national.topDefection.toId}{" "}
          · {formatThousands(national.topDefection.votes)}
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <div className="text-[10px] text-muted-foreground col-span-2">
          {t("persistence_most_stable")}
        </div>
        {stable.map((r) => (
          <div key={`s-${r.mir}`} className="flex justify-between col-span-2">
            <span className="truncate">{r.name}</span>
            <span className="font-mono">{formatPct(r.share, 1)}</span>
          </div>
        ))}
        <div className="text-[10px] text-muted-foreground col-span-2 mt-1">
          {t("persistence_most_volatile")}
        </div>
        {vol.map((r) => (
          <div key={`v-${r.mir}`} className="flex justify-between col-span-2">
            <span className="truncate">{r.name}</span>
            <span className="font-mono">{formatPct(r.share, 1)}</span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
