// Follow / unfollow toggle for a procurement entity. Backed by the on-site
// localStorage watchlist (useFollow). Sits in an entity-page header next to the
// EIK badge; followed entities surface on /procurement/watchlist.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { useFollow, type WatchKind } from "@/data/procurement/useWatchlist";

export const FollowButton: FC<{
  kind: WatchKind;
  id: string;
  label: string;
}> = ({ kind, id, label }) => {
  const { t } = useTranslation();
  const { following, toggle } = useFollow(kind, id, label);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={following}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        following
          ? "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
          : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent/40"
      }`}
    >
      <Star className={`h-3 w-3 ${following ? "fill-amber-500" : ""}`} />
      {following
        ? t("follow_following") || "Following"
        : t("follow_follow") || "Follow"}
    </button>
  );
};
