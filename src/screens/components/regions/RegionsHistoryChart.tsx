import { useElectionContext } from "@/data/ElectionContext";
import { FC } from "react";
import { MultiHistoryChart } from "../charts/MultiHistoryChart";

export const RegionsHistoryChart: FC = () => {
  const { stats } = useElectionContext();
  return (
    <>
      <MultiHistoryChart stats={stats} />
    </>
  );
};
