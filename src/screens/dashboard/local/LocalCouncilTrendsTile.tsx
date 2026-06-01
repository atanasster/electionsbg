// Per-município council trends: this município's council vote share per party
// across the regular local cycles. The place-scoped sibling of the national
// LocalCrossCycleTile — both render the shared LocalCrossCycleChart. Self-hides
// (the chart returns null) for municípios with fewer than two cycles of usable
// council signal — e.g. Sofia район shards, whose council replicates the
// city-wide bundle.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { useLocalMunicipalityCrossCycle } from "@/data/local/useLocalMunicipalityCrossCycle";
import { LocalCrossCycleChart } from "./LocalCrossCycleChart";

type Props = {
  obshtinaCode: string;
  className?: string;
};

export const LocalCouncilTrendsTile: FC<Props> = ({
  obshtinaCode,
  className,
}) => {
  const { t } = useTranslation();
  const { data } = useLocalMunicipalityCrossCycle(obshtinaCode, 6);
  return (
    <LocalCrossCycleChart
      data={data}
      title={t("local_trends_council_title")}
      hint={t("local_council_trends_muni_hint")}
      className={className}
    />
  );
};
