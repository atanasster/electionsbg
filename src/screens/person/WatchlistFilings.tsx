// New declarations from the people this reader follows (audit T3.10).
//
// Self-hides when the watchlist is empty or nothing new has arrived, so a reader who follows
// nobody sees no empty shell.
//
// THE DATE IS NOT A FILING DATE. `firstSeen` is when the declaration entered OUR data. A
// backfill stamps thousands of decade-old filings with today's date, so the copy says
// "added here on" and the caveat spells it out — labelling it as "filed" would tell readers
// an official just declared something they declared in 2016.

import { FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BellRing, ExternalLink } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { watchlist } from "@/lib/watchlist";
import { useNewFilings } from "./useNewFilings";

export const WatchlistFilings: FC = () => {
  const { t } = useTranslation();
  const [slugs, setSlugs] = useState<string[]>([]);

  useEffect(() => {
    setSlugs(watchlist.all());
    return watchlist.subscribe(() => setSlugs(watchlist.all()));
  }, []);

  const rows = useNewFilings(slugs);
  if (!rows || rows.length === 0) return null;

  return (
    <DashboardSection
      id="person-watchlist"
      title={t("pp_watch_title")}
      icon={BellRing}
      subtitle={t("pp_watch_hint")}
    >
      <Card>
        <CardContent className="pt-6">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.sourceUrl}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
              >
                <Link
                  to={`/person/${r.slug}`}
                  className="font-medium text-primary hover:underline"
                >
                  {r.name}
                </Link>
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {r.fiscalYear ?? r.year}
                  {r.institution ? ` · ${r.institution}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("pp_watch_seen")} {r.firstSeen}
                </span>
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-primary hover:underline"
                  aria-label={r.sourceUrl}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("pp_watch_caveat")}
          </p>
        </CardContent>
      </Card>
    </DashboardSection>
  );
};
