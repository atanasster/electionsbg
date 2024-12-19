import { FC, PropsWithChildren, ReactNode } from "react";

import { dataViews, DataViewType, useDataViewContext } from "./DataViewContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ChartLine, MapPinned, TableProperties } from "lucide-react";
import { useTranslation } from "react-i18next";

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  map: <MapPinned />,
  table: <TableProperties />,
  chart: <ChartLine />,
};
export const DataViewContainer: FC<
  PropsWithChildren<{
    title: ReactNode;
    excluded?: { exclude: DataViewType; replace: DataViewType };
  }>
> = ({ children, title, excluded }) => {
  const { t } = useTranslation();
  const { view, setView } = useDataViewContext();
  return (
    <>
      <Separator className="my-2" />
      <div className="flex justify-between w-full items-center">
        <div className="truncate font-semibold text-muted-foreground">
          {title}
        </div>
        <div className="flex gap-2 ">
          {dataViews
            .filter((key) => !excluded || excluded.exclude !== key)
            .map((key: DataViewType) => {
              return (
                <Button
                  key={key}
                  variant="outline"
                  role="radio"
                  data-state={
                    view === key ||
                    (excluded &&
                      view === excluded.exclude &&
                      key === excluded.replace)
                      ? "checked"
                      : "unchecked"
                  }
                  className="flex w-20 data-[state=checked]:bg-muted text-muted-foreground"
                  onClick={() => {
                    setView(key);
                  }}
                >
                  {DataTypeIcons[key]}
                  <span className="text-xs text-muted-foreground">
                    {t(key)}
                  </span>
                </Button>
              );
            })}
        </div>
      </div>
      <Separator className="my-2" />
      {children}
    </>
  );
};
