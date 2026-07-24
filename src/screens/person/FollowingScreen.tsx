// /following (audit T3.10, gap C1+C2) — the reader's watchlist feed, on its own route.
//
// WHY ITS OWN PAGE. The new-filing feed used to render on every /person profile, where it
// showed filings for OTHER people (whoever the reader follows) and duplicated the subject's
// own declarations. It belongs on a personal page instead. This route is browser-local,
// keeps no server-side record of who follows whom (the feed request is identical for every
// reader — see useNewFilings / migration 098), and is `noindex` + never prerendered.
//
// Two lists off ONE fetch of the recent site-wide feed:
//   · "from people you follow" — the feed filtered to the local watchlist (C1).
//   · "recently added" — the whole site-wide feed (C2), so the page is useful even before
//     the reader follows anyone.
//
// firstSeen is when a filing entered OUR data, not when it was filed — a backfill stamps old
// filings with one recent date, so the copy says "added here on" and a caveat spells it out.

import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { BellRing, Bell, ExternalLink, ListPlus } from "lucide-react";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { useNoindex } from "@/lib/useNoindex";
import { watchlist } from "@/lib/watchlist";
import { useAllNewFilings, type NewFilingRow } from "./useNewFilings";

const FilingList: FC<{ rows: NewFilingRow[] }> = ({ rows }) => {
  const { t } = useTranslation();
  return (
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
            aria-label={t("pp_watch_open_source")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </li>
      ))}
    </ul>
  );
};

export const FollowingScreen: FC = () => {
  const { t } = useTranslation();
  useNoindex();

  const [slugs, setSlugs] = useState<string[]>([]);
  useEffect(() => {
    setSlugs(watchlist.all());
    return watchlist.subscribe(() => setSlugs(watchlist.all()));
  }, []);

  const all = useAllNewFilings();
  const mine = useMemo(() => {
    if (!all) return undefined;
    const set = new Set(slugs);
    return all.filter((r) => set.has(r.slug));
  }, [all, slugs]);

  const following = slugs.length > 0;

  return (
    <div className="flex flex-col gap-6 py-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t("pp_watch_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pp_watch_hint")}
        </p>
      </div>

      {/* From people the reader follows. Empty state doubles as the "how to follow"
          explainer, since there is no other entry point to the watchlist. */}
      {following ? (
        <DashboardSection
          id="person-watchlist"
          title={t("pp_watch_following_count", { count: slugs.length })}
          icon={BellRing}
        >
          <Card>
            <CardContent className="pt-6">
              {mine === undefined ? (
                // Loading — distinct from "none recent", so the empty message does not
                // flash before the feed arrives.
                <p className="text-sm text-muted-foreground">{t("loading")}</p>
              ) : mine.length > 0 ? (
                <FilingList rows={mine} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("pp_watch_none_recent")}
                </p>
              )}
            </CardContent>
          </Card>
        </DashboardSection>
      ) : (
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <Bell className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("pp_watch_empty_help")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* The whole recent feed — useful even before the reader follows anyone (C2). */}
      <DashboardSection
        id="person-events"
        title={t("pp_watch_sitewide_title")}
        icon={ListPlus}
        subtitle={t("pp_watch_caveat")}
      >
        <Card>
          <CardContent className="pt-6">
            {all === undefined ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : all.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("pp_watch_none_recent")}
              </p>
            ) : (
              <FilingList rows={all} />
            )}
          </CardContent>
        </Card>
      </DashboardSection>
    </div>
  );
};
