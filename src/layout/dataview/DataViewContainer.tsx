import { FC, ReactNode } from "react";
import { ChartLine, MapPinned, TableProperties } from "lucide-react";
import { IconTabs } from "@/screens/IconTabs";

// eslint-disable-next-line react-refresh/only-export-components
export const dataViews = ["map", "table", "chart"] as const;
export type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  map: <MapPinned />,
  table: <TableProperties />,
  chart: <ChartLine />,
};
export const DataViewContainer: FC<{
  children: (view: DataViewType) => ReactNode;
  title: ReactNode;
  excluded?: { exclude: DataViewType; replace: DataViewType };
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
