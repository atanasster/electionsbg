import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Separator } from "@/components/ui/separator";
import { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParam } from "./utils/useSearchParam";

export const IconTabs = <DType extends string>(props: {
  title: ReactNode;
  tabs: readonly DType[];
  storageKey: string;
  shortTitle?: ReactNode;
  children: (key: DType) => ReactNode;
  className?: string;
  excluded?: { exclude: DType[]; replace?: DType };
  icons?: {
    [key: string]: ReactNode;
  };
}) => {
  const {
    title,
    tabs,
    storageKey,
    shortTitle,
    icons,
    children,
    excluded,
    className,
  } = props;
  const { t } = useTranslation();
  const isMedium = useMediaQueryMatch("md");
  const [currentView, setView] = useSearchParam(storageKey, { replace: false });
  const view =
    tabs.find((t) => t === currentView) &&
    (!excluded || !excluded.exclude.find((t) => t === currentView))
      ? currentView
      : excluded?.replace || tabs[0];
  return (
    <>
      <Separator className="my-2" />
      <div className="flex justify-between w-full items-center">
        <div className="truncate font-semibold text-muted-foreground">
          {isMedium ? title : shortTitle || title}
        </div>
        <div className="flex gap-2 ">
          {tabs
            .filter((key) => !excluded || !excluded.exclude.includes(key))
            .map((key: DType) => {
              return (
                <Button
                  key={key}
                  variant="outline"
                  role="radio"
                  data-state={view === key ? "checked" : "unchecked"}
                  className={cn(
                    "flex w-20 data-[state=checked]:bg-muted text-muted-foreground",
                    className,
                  )}
                  onClick={() => {
                    setView(key);
                  }}
                >
                  {icons?.[key]}
                  <span className="text-xs text-muted-foreground">
                    {t(key).toLowerCase()}
                  </span>
                </Button>
              );
            })}
        </div>
      </div>
      <Separator className="my-2" />
      {children(view as DType)}
    </>
  );
};
