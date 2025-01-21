import { FC, ReactNode } from "react";
import {
  ChartLine,
  Heart,
  MapPinned,
  TableProperties,
  UsersRound,
} from "lucide-react";
import { IconTabs } from "@/screens/IconTabs";

// eslint-disable-next-line react-refresh/only-export-components
export const dataViews = ["map", "table", "parties", "pref.", "chart"] as const;
export type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  map: <MapPinned />,
  table: <TableProperties />,
  parties: <UsersRound />,
  "pref.": <Heart />,
  chart: <ChartLine />,
};
export const DataViewContainer: FC<{
  children: (view: DataViewType) => ReactNode;
  title: ReactNode;
  excluded?: { exclude: DataViewType[]; replace: DataViewType };
}> = ({ children, title, excluded }) => {
  return (
    <IconTabs<DataViewType>
      title={title}
      shortTitle={title}
      tabs={dataViews}
      icons={DataTypeIcons}
      storageKey="view"
      excluded={excluded}
    >
      {children}
    </IconTabs>
  );
};
