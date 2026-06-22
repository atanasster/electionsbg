// Compact watchlist digest for the procurement overview. Renders nothing until
// the user follows at least one entity, then shows a one-line "you're following
// N · M with new activity" strip linking to the full watchlist — so the value
// of the watchlist is visible without opening the tab. Highlighted when there's
// new activity since the user last looked.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Star, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import {
  useWatchlist,
  useCachedNewCount,
} from "@/data/procurement/useWatchlist";

export const WatchlistDigestTile: FC = () => {
  const { t } = useTranslation();
  const items = useWatchlist();
  const newCount = useCachedNewCount();

  if (items.length === 0) return null;
  const hot = newCount > 0;

  return (
    <Card
      className={`my-4 ${hot ? "border-amber-300/70 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20" : ""}`}
    >
      <CardContent className="p-3 flex items-center gap-2 flex-wrap text-sm">
        <Star
          className={`h-4 w-4 ${hot ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`}
        />
        <span>
          {t("watchlist_digest_following") || "On your watchlist:"}{" "}
          <strong className="tabular-nums">{items.length}</strong>
          {hot ? (
            <>
              {" · "}
              <span className="font-medium text-amber-600 dark:text-amber-400 tabular-nums">
                {newCount} {t("watchlist_with_new") || "with new activity"}
              </span>
            </>
          ) : null}
        </span>
        <Link
          to="/procurement/watchlist"
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          {t("watchlist_digest_open") || "Open watchlist"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
};
