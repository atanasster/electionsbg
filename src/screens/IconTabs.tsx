import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Separator } from "@radix-ui/react-separator";
import { ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

export const IconTabs = <DType extends string>(props: {
  title: ReactNode;
  tabs: readonly DType[];
  storageKey: string;
  shortTitle?: ReactNode;
  children: (key: DType) => ReactNode;
  className?: string;
  excluded?: { exclude: DType; replace: DType };
  icons: {
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
  const [view, setViewInternal] = useState<DType>(
    (localStorage.getItem(storageKey) as DType) || (tabs[0] as DType),
  );
  const setView = (newView: DType) => {
    setViewInternal(newView);
    localStorage.setItem(storageKey, newView);
  };

  return (
    <>
      <Separator className="my-2" />
      <div className="flex justify-between w-full items-center">
        <div className="truncate font-semibold text-muted-foreground">
          {isMedium ? title : shortTitle || title}
        </div>
        <div className="flex gap-2 ">
          {tabs
            .filter((key) => !excluded || excluded.exclude !== key)
            .map((key: DType) => {
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
                  className={cn(
                    "flex w-20 data-[state=checked]:bg-muted text-muted-foreground",
                    className,
                  )}
                  onClick={() => {
                    setView(key);
                  }}
                >
                  {icons[key]}
                  <span className="text-xs text-muted-foreground">
                    {t(key)}
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
