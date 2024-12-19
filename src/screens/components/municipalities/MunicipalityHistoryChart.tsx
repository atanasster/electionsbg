import { FC } from "react";
import { MultiHistoryChart } from "../charts/MultiHistoryChart";
import { useRegionStats } from "@/data/regions/useRegionStats";

export const MunicipalityHistoryChart: FC<{ region: string }> = ({
  region,
}) => {
  const { stats } = useRegionStats(region);
  return stats && <MultiHistoryChart stats={stats} />;
};
