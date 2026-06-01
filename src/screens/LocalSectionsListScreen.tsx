// Standalone "all polling stations" page for one local município — the full
// searchable / sortable per-station council table behind the "see details" link
// on the LocalTopSectionsTile leaderboard. Mirrors the parliamentary
// SettlementSectionsListScreen, and reuses the breadcrumb shell of the local
// mayor / council sub-pages (LocalRaceScreen).

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useLocalSectionShard } from "@/data/local/useLocalSectionShard";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalSectionsTable } from "./dashboard/local/LocalSectionsTable";

const LocalSectionsList: FC<{ cycle: string; obshtinaCode: string }> = ({
  cycle,
  obshtinaCode,
}) => {
  const { t } = useTranslation();
  const { municipality } = useLocalMunicipality(obshtinaCode, cycle);
  const { shard } = useLocalSectionShard(cycle, obshtinaCode);

  const back = (
    <div className="mb-2 text-xs text-muted-foreground">
      <Link to={`/local/${cycle}`} className="hover:underline">
        {t("local_election_screen_back")}
      </Link>
      <span className="mx-2">·</span>
      <Link to={`/local/${cycle}/${obshtinaCode}`} className="hover:underline">
        {municipality?.obshtinaName ?? obshtinaCode}
      </Link>
      <span className="mx-2">·</span>
      <span>{friendlyCycleDate(cycle)}</span>
    </div>
  );

  if (!shard || shard.sections.length === 0) {
    return (
      <section className="my-4">
        {back}
        <p className="text-sm text-muted-foreground">
          {t("local_election_no_data")}
        </p>
      </section>
    );
  }

  return (
    <section className="my-4">
      {back}
      <h1 className="text-2xl font-semibold">{t("local_sections_title")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("local_sections_intro", { count: shard.sections.length })}
      </p>
      <LocalSectionsTable
        shard={shard}
        cycle={cycle}
        obshtinaCode={obshtinaCode}
      />
    </section>
  );
};

export const LocalSectionsListScreen: FC = () => {
  const { cycle, obshtinaCode } = useParams<{
    cycle: string;
    obshtinaCode: string;
  }>();
  if (!cycle || !obshtinaCode) return null;
  return <LocalSectionsList cycle={cycle} obshtinaCode={obshtinaCode} />;
};
