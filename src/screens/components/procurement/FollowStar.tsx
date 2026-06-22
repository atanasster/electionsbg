// Compact icon-only follow toggle — the universal "watch this" affordance.
// Unlike the text-pill FollowButton (which sits in an entity-page header), this
// is a small star meant to live inline on list rows, search results, the
// red-flag feed and the contract page, so anything visible can be followed in
// one click without drilling into its detail page first.
//
// Safe to nest inside a <Link> row: the click is stopped from bubbling/navigating.

import { FC, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { useFollow, type WatchKind } from "@/data/procurement/useWatchlist";

export const FollowStar: FC<{
  kind: WatchKind;
  id: string;
  label: string;
  size?: "sm" | "md";
  className?: string;
}> = ({ kind, id, label, size = "sm", className = "" }) => {
  const { t } = useTranslation();
  const { following, toggle } = useFollow(kind, id, label);
  const dim = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const title = following
    ? t("follow_following") || "Following"
    : t("follow_follow") || "Follow";

  const onClick = (e: MouseEvent) => {
    // Rows are usually wrapped in a Link — don't navigate when toggling.
    e.preventDefault();
    e.stopPropagation();
    toggle();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={following}
      aria-label={title}
      title={title}
      className={`inline-flex items-center justify-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        following
          ? "text-amber-500 hover:text-amber-600"
          : "text-muted-foreground/50 hover:text-amber-500 hover:bg-accent/40"
      } ${className}`}
    >
      <Star className={`${dim} ${following ? "fill-amber-500" : ""}`} />
    </button>
  );
};
