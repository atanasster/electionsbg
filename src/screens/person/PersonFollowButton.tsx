// Follow a person to get their new declarations in the watchlist feed (audit T3.10).
//
// Local to this browser: the list never reaches the server as stored state (src/lib/
// watchlist.ts explains why). The button subscribes because `storage` alone does not fire
// in the tab that made the change.

import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { watchlist } from "@/lib/watchlist";

export const PersonFollowButton: FC<{ slug: string }> = ({ slug }) => {
  const { t } = useTranslation();
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(watchlist.has(slug));
    return watchlist.subscribe(() => setOn(watchlist.has(slug)));
  }, [slug]);

  return (
    <button
      type="button"
      onClick={() => setOn(watchlist.toggle(slug))}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
        on
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      {on ? (
        <BellRing className="h-3.5 w-3.5" />
      ) : (
        <Bell className="h-3.5 w-3.5" />
      )}
      {on ? t("pp_follow_on") : t("pp_follow_off")}
    </button>
  );
};
