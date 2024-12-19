import { FC } from "react";
import { MultiHistoryChart } from "../charts/MultiHistoryChart";
import { useMunicipalityStats } from "@/data/municipalities/useMunicipalityStats";

export const SettlementHistoryChart: FC<{ municipality: string }> = ({
  municipality,
}) => {
  const { stats } = useMunicipalityStats(municipality);
  return stats && <MultiHistoryChart stats={stats} />;
};
