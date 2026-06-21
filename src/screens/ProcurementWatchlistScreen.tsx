// /procurement/watchlist — the user's followed procurement entities. Backed by
// the on-site localStorage watchlist (no account). Each entry links to its page;
// the × removes it. Empty state points to the Follow button on entity pages.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Star, X, Building2, Receipt, User, MapPin } from "lucide-react";
import { Title } from "@/ux/Title";
import { ProcurementNav } from "@/screens/components/procurement/ProcurementNav";
import { Card, CardContent } from "@/ux/Card";
import {
  useWatchlist,
  removeFollow,
  type WatchItem,
  type WatchKind,
} from "@/data/procurement/useWatchlist";

const hrefFor = (i: WatchItem): string => {
  switch (i.kind) {
    case "company":
      return `/company/${i.id}`;
    case "awarder":
      return `/awarder/${i.id}`;
    case "person":
      return `/candidate/mp-${i.id}/procurement`;
    case "place":
      return `/procurement/settlement/${i.id}`;
  }
};

const ICON: Record<WatchKind, typeof Building2> = {
  company: Receipt,
  awarder: Building2,
  person: User,
  place: MapPin,
};

export const ProcurementWatchlistScreen: FC = () => {
  const { t } = useTranslation();
  const items = useWatchlist();
  const sorted = [...items].sort((a, b) => b.addedAt - a.addedAt);

  return (
    <>
      <Title
        description={
          t("watchlist_desc") ||
          "Entities you follow. Stored in this browser only — no account needed."
        }
      >
        {t("watchlist_title") || "My watchlist"}
      </Title>
      <ProcurementNav />
      <section aria-label="watchlist" className="my-4">
        {sorted.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              <Star className="mx-auto mb-2 h-6 w-6 opacity-50" />
              {t("watchlist_empty") ||
                "You're not following anything yet. Open a company, buyer or politician and press Follow."}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-3 md:p-4">
              <ul className="flex flex-col">
                {sorted.map((i) => {
                  const Icon = ICON[i.kind];
                  return (
                    <li
                      key={`${i.kind}:${i.id}`}
                      className="flex items-center gap-2 py-2 border-b border-border/40 last:border-b-0"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Link
                        to={hrefFor(i)}
                        className="min-w-0 flex-1 text-sm font-medium hover:underline truncate"
                      >
                        {i.label}
                      </Link>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                        {t(`watchlist_kind_${i.kind}`) || i.kind}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFollow(i.kind, i.id)}
                        aria-label={t("watchlist_remove") || "Remove"}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
};
