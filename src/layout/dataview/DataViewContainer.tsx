import { FC, ReactNode } from "react";
import {
  ChartLine,
  Heart,
  MapPinned,
  RotateCcwSquare,
  TableProperties,
  UsersRound,
} from "lucide-react";
import { IconTabs } from "@/screens/IconTabs";
import { useElectionContext } from "@/data/ElectionContext";

// eslint-disable-next-line react-refresh/only-export-components
export const dataViews = [
  "map",
  "table",
  "parties",
  "recount",
  "pref.",
  "chart",
] as const;
export type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  map: <MapPinned />,
  table: <TableProperties />,
  parties: <UsersRound />,
  recount: <RotateCcwSquare />,
  "pref.": <Heart />,
  chart: <ChartLine />,
};
export const DataViewContainer: FC<{
  children: (view: DataViewType) => ReactNode;

  title: ReactNode;
  excluded?: { exclude: DataViewType[]; replace?: DataViewType };
}> = ({ children, title, excluded }) => {
  const { electionStats } = useElectionContext();
  const excludedTabs = excluded || { exclude: [] };
  if (!electionStats?.hasPreferences) {
    excludedTabs.exclude.push("pref.");
  }
  if (!electionStats?.hasRecount) {
    excludedTabs.exclude.push("recount");
  }
  return (
    <IconTabs<DataViewType>
      title={title}
      shortTitle={title}
      tabs={dataViews}
      icons={DataTypeIcons}
      storageKey="view"
      excluded={excludedTabs}
    >
      {children}
    </IconTabs>
  );
};
