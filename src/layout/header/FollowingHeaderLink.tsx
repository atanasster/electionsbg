// Header entry point to /following (audit T3.10, gap C1) — a bell with the follow count.
//
// Renders nothing until the reader follows at least one person, so it never adds chrome for
// the majority who don't use the watchlist. Browser-local, like everything watchlist-related
// (src/lib/watchlist.ts) — it subscribes because a same-tab toggle does not fire `storage`.

import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing } from "lucide-react";
import { Link } from "@/ux/Link";
import { watchlist } from "@/lib/watchlist";

export const FollowingHeaderLink: FC = () => {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(watchlist.all().length);
    return watchlist.subscribe(() => setCount(watchlist.all().length));
  }, []);

  if (count === 0) return null;

  return (
    <Link
      to="/following"
      aria-label={t("pp_watch_following_count", { count })}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <BellRing className="h-5 w-5" />
      <span className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
        {count}
      </span>
    </Link>
  );
};
