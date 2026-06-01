// "Top polling sections" leaderboard for one local município — the at-a-glance
// dashboard tile, the local-elections counterpart of the parliamentary
// TopSectionsTile. The full searchable / sortable per-station table now lives on
// its own page (LocalSectionsListScreen), reached via the "see details" link the
// leaderboard renders when there are more sections than the tile shows.
//
// Reads the per-município section shard (via useLocalSectionShard, which serves
// Sofia район shards from the city-wide SOF bundle). The station MAP lives in
// the mayor + council rows of MunicipalityResults (LocalSectionsMapTile); the
// shard is shared via React Query so this consumer pays no extra fetch.
// Self-hides when the cycle/município has fewer than two sections.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote } from "lucide-react";
import { useLocalSectionShard } from "@/data/local/useLocalSectionShard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { LocalTopSectionsTile } from "./LocalTopSectionsTile";

export const LocalSectionsTile: FC<{
  cycle: string;
  obshtinaCode: string;
}> = ({ cycle, obshtinaCode }) => {
  const { t } = useTranslation();
  const { shard } = useLocalSectionShard(cycle, obshtinaCode);

  // The leaderboard needs at least two sections to rank.
  if (!shard || shard.sections.length < 2) return null;

  return (
    <DashboardSection
      id="local-sections"
      title={t("local_sections_group_title")}
      icon={Vote}
    >
      <LocalTopSectionsTile
        shard={shard}
        cycle={cycle}
        obshtinaCode={obshtinaCode}
        seeAllHref={`/local/${cycle}/${obshtinaCode}/sections`}
      />
    </DashboardSection>
  );
};
