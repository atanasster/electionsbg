// /procurement/watchlist — the user's followed procurement entities, as a live
// monitoring dashboard (not a static bookmark list). Backed by the on-site
// localStorage watchlist (no account). Each followed company / buyer / person /
// place / contract renders a live card (total awarded, contract count, latest
// contract, top counterparty) and the page surfaces "new activity since you
// last looked" at the top. The empty state points to where the Follow star now
// lives across the section.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Star,
  Building2,
  Receipt,
  User,
  MapPin,
  FileText,
  Check,
  ArrowRight,
  Bell,
} from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { Title } from "@/ux/Title";
import { ProcurementSectionHeader } from "@/screens/components/procurement/ProcurementSectionHeader";
import { FollowStar } from "@/screens/components/procurement/FollowStar";
import { Card, CardContent } from "@/ux/Card";
import {
  formatEur,
  formatEurCompact,
  formatEurWithOther,
} from "@/lib/currency";
import {
  useWatchlist,
  markManySeen,
  type WatchItem,
  type WatchKind,
  type WatchSignature,
} from "@/data/procurement/useWatchlist";
import {
  useWatchlistActivity,
  type WatchActivity,
} from "@/data/procurement/useWatchlistActivity";

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
    case "contract":
      return `/procurement/contract/${i.id}`;
  }
};

const ICON: Record<WatchKind, typeof Building2> = {
  company: Receipt,
  awarder: Building2,
  person: User,
  place: MapPin,
  contract: FileText,
};

type SortKey = "activity" | "value" | "added" | "name";

// Bulgarian count form: "1 договор" (singular) vs "N договора" (after numerals).
const contractsWord = (t: (k: string) => string, n: number): string =>
  n === 1
    ? t("watchlist_contract_one") || "contract"
    : t("watchlist_contracts_short") || "contracts";

export const ProcurementWatchlistScreen: FC = () => {
  const { t } = useTranslation();
  const items = useWatchlist();
  const { activities, newCount } = useWatchlistActivity();
  const [sort, setSort] = useState<SortKey>("activity");

  const sorted = useMemo<WatchActivity[]>(() => {
    const arr = [...activities];
    switch (sort) {
      case "value":
        return arr.sort((a, b) => (b.totalEur ?? 0) - (a.totalEur ?? 0));
      case "added":
        return arr.sort((a, b) => b.item.addedAt - a.item.addedAt);
      case "name":
        return arr.sort((a, b) => a.item.label.localeCompare(b.item.label));
      case "activity":
      default:
        // New first, then by latest contract date, then by recency added.
        return arr.sort((a, b) => {
          if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
          if (a.latestDate !== b.latestDate)
            return b.latestDate.localeCompare(a.latestDate);
          return b.item.addedAt - a.item.addedAt;
        });
    }
  }, [activities, sort]);

  const newOnes = sorted.filter((a) => a.isNew);

  const markAllSeen = () => {
    const entries: Array<{
      kind: WatchKind;
      id: string;
      sig: WatchSignature;
    }> = [];
    for (const a of activities) {
      if (a.resolved && a.sig)
        entries.push({ kind: a.item.kind, id: a.item.id, sig: a.sig });
    }
    markManySeen(entries);
  };

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
      <ProcurementSectionHeader scopeMode="none" />

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <section aria-label="watchlist" className="my-4 space-y-4">
          {/* Summary + sort */}
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-muted-foreground">
              {t("watchlist_following_count") || "Following"}{" "}
              <strong className="text-foreground tabular-nums">
                {items.length}
              </strong>
              {newCount > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400 font-medium tabular-nums">
                    {newCount} {t("watchlist_with_new") || "with new activity"}
                  </span>
                </>
              ) : null}
            </span>
            <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {t("watchlist_sort") || "Sort"}
              <NativeSelect
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="activity">
                  {t("watchlist_sort_activity") || "New activity"}
                </option>
                <option value="value">
                  {t("watchlist_sort_value") || "Total value"}
                </option>
                <option value="added">
                  {t("watchlist_sort_added") || "Recently added"}
                </option>
                <option value="name">
                  {t("watchlist_sort_name") || "Name"}
                </option>
              </NativeSelect>
            </label>
          </div>

          {/* New-activity banner */}
          {newOnes.length > 0 ? (
            <Card className="border-amber-300/70 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Bell className="h-4 w-4 text-amber-600" />
                  <h2 className="text-sm font-semibold">
                    {t("watchlist_new_activity") || "New since you last looked"}
                  </h2>
                  <button
                    type="button"
                    onClick={markAllSeen}
                    className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Check className="h-3 w-3" />
                    {t("watchlist_mark_all_seen") || "Mark all seen"}
                  </button>
                </div>
                <ul className="flex flex-col gap-1">
                  {newOnes.map((a) => (
                    <li
                      key={`${a.item.kind}:${a.item.id}`}
                      className="text-sm flex items-center gap-2"
                    >
                      <Link
                        to={hrefFor(a.item)}
                        className="hover:underline truncate"
                      >
                        {a.item.label}
                      </Link>
                      <span className="ml-auto shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300 tabular-nums">
                        {a.deltaCount > 0
                          ? `+${a.deltaCount} ${contractsWord(t, a.deltaCount)}`
                          : ""}
                        {a.deltaEur > 1
                          ? `${a.deltaCount > 0 ? " · " : ""}+${formatEurCompact(a.deltaEur)}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* Live cards */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((a) => (
              <WatchCard key={`${a.item.kind}:${a.item.id}`} a={a} />
            ))}
          </div>
        </section>
      )}
    </>
  );
};

const WatchCard: FC<{ a: WatchActivity }> = ({ a }) => {
  const { t, i18n } = useTranslation();
  const Icon = ICON[a.item.kind];
  const total =
    a.totalEur != null
      ? a.totalOther
        ? formatEurWithOther(a.totalEur, a.totalOther, i18n.language)
        : formatEur(a.totalEur, i18n.language)
      : null;

  return (
    <Card
      className={
        a.isNew ? "border-amber-300/70 dark:border-amber-800/60" : undefined
      }
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <Link
              to={hrefFor(a.item)}
              className="text-sm font-medium hover:underline line-clamp-2"
            >
              {a.item.label}
            </Link>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t(`watchlist_kind_${a.item.kind}`) || a.item.kind}
            </div>
          </div>
          {a.isNew ? (
            <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              {t("watchlist_new_badge") || "New"}
            </span>
          ) : null}
          <FollowStar
            kind={a.item.kind}
            id={a.item.id}
            label={a.item.label}
            size="sm"
          />
        </div>

        {a.resolved ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
            {total ? (
              <span className="font-semibold tabular-nums text-foreground">
                {total}
              </span>
            ) : null}
            {a.count != null ? (
              <span className="text-muted-foreground tabular-nums">
                {a.count.toLocaleString("bg-BG")} {contractsWord(t, a.count)}
              </span>
            ) : null}
          </div>
        ) : a.loading ? (
          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        ) : null}

        {(a.latestDate || a.topName) && a.resolved ? (
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {a.latestDate ? (
              <div>
                {t("watchlist_latest") || "Latest contract"}:{" "}
                <span className="tabular-nums">{a.latestDate}</span>
              </div>
            ) : null}
            {a.topName && a.topEik ? (
              <div className="truncate">
                {t("watchlist_top_counterparty") || "Top counterparty"}:{" "}
                <Link
                  to={`/${a.topKind === "awarder" ? "awarder" : "company"}/${a.topEik}`}
                  className="hover:underline text-foreground/80"
                >
                  {a.topName}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

const DISCOVER: Array<{ to: string; key: string; fallback: string }> = [
  {
    to: "/procurement/contractors",
    key: "procurement_index_top_contractors",
    fallback: "Top contractors",
  },
  {
    to: "/procurement/awarders",
    key: "procurement_top_awarders",
    fallback: "Top awarders",
  },
  {
    to: "/procurement/people",
    key: "procurement_people_title",
    fallback: "Public money scanner",
  },
  {
    to: "/procurement/by-settlement",
    key: "procurement_by_settlement_nav",
    fallback: "By place",
  },
  { to: "/procurement/flags", key: "flags_title", fallback: "Risk signals" },
];

const EmptyState: FC = () => {
  const { t } = useTranslation();
  return (
    <section aria-label="watchlist" className="my-4">
      <Card>
        <CardContent className="p-6 md:p-8 text-center">
          <Star className="mx-auto mb-3 h-8 w-8 text-amber-400" />
          <h2 className="text-base font-semibold mb-1">
            {t("watchlist_empty_title") || "Start following the money"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5">
            {t("watchlist_empty") ||
              "Press the star on any company, buyer, politician, place or contract to follow it. They'll appear here with their latest activity."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {DISCOVER.map((d) => (
              <Link
                key={d.to}
                to={d.to}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40"
              >
                {t(d.key) || d.fallback}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
};
