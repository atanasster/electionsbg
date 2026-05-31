// Full oblast-level results table for a local-elections cycle.
// Route: /local/:cycle/regions
//
// The "see details" target of the country dashboard's top-regions tile —
// every oblast (mayoral control + council seats + município count), where the
// tile only shows the largest few.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalRegionsTable } from "./dashboard/local/LocalRegionsTable";

export const LocalAllRegionsScreen: FC = () => {
  const { cycle } = useParams<{ cycle: string }>();
  const { t } = useTranslation();
  if (!cycle) return null;
  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <div className="text-xs text-muted-foreground">
        <Link to={`/local/${cycle}`} className="hover:underline">
          {t("local_election_screen_back")}
        </Link>
        <span className="mx-2">·</span>
        <span>{friendlyCycleDate(cycle)}</span>
      </div>
      <h1 className="text-2xl font-semibold">{t("local_all_regions")}</h1>
      <LocalRegionsTable cycle={cycle} />
    </main>
  );
};
