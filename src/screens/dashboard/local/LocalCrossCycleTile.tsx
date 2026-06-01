// National cross-cycle trends: council vote share per party across the regular
// local cycles (2011 → 2023). Thin wrapper over the shared
// LocalCrossCycleChart, fed by useLocalCrossCycle. Council share is the
// proportional party-preference signal; mayoralties are winner-take-all.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocalCrossCycle } from "@/data/local/useLocalCrossCycle";
import { LocalCrossCycleChart } from "./LocalCrossCycleChart";

export const LocalCrossCycleTile: FC = () => {
  const { t } = useTranslation();
  const { data } = useLocalCrossCycle(6);
  return (
    <LocalCrossCycleChart
      data={data}
      title={t("local_trends_council_title")}
      hint={t("local_trends_hint")}
    />
  );
};
