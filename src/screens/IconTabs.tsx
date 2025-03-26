import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Separator } from "@/components/ui/separator";
import { ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParam } from "./utils/useSearchParam";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Ellipsis } from "lucide-react";

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
  mobileTabs?: number;
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
    mobileTabs = 3,
  } = props;
  const { t } = useTranslation();
  const isMedium = useMediaQueryMatch("md");
  const [currentView, setView] = useSearchParam(storageKey, { replace: false });
  const view =
    tabs.find((t) => t === currentView) &&
    (!excluded || !excluded.exclude.find((t) => t === currentView))
      ? currentView
      : excluded?.replace || tabs[0];
  const visibleTabs = useMemo(
    () => tabs.filter((key) => !excluded || !excluded.exclude.includes(key)),
    [excluded, tabs],
  );
  const isLarge = useMediaQueryMatch("lg");
  return (
    <>
      <Separator className="my-2" />
      <div className="flex justify-between w-full items-center">
        <div className="truncate font-semibold text-muted-foreground">
          {isMedium ? title : shortTitle || title}
        </div>
        <div className="flex gap-2 ">
          {visibleTabs
            .slice(0, isLarge ? undefined : mobileTabs)
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
          {visibleTabs.length > mobileTabs && !isLarge && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  data-collapse-toggle="navbar-default"
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg lg:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-gray-400 dark:hover:bg-gray-700 dark:focus:ring-gray-600"
                  aria-controls="navbar-default"
                  aria-expanded="false"
                >
                  <span className="sr-only">Open menu</span>
                  <Ellipsis />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                {visibleTabs.slice(3).map((key: DType) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={view === key}
                    onCheckedChange={(checked) => {
                      if (checked) setView(key);
                    }}
                  >
                    <div className="flex gap-2 items-center">
                      {icons?.[key]}
                      <span className="text-xs text-muted-foreground">
                        {t(key).toLowerCase()}
                      </span>
                    </div>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Separator className="my-2" />
      {children(view as DType)}
    </>
  );
};
