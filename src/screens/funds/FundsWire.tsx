// Band 0 — the /funds wire, and band 2 — the news rail. Both from `/api/db/funds-wire` (144).
//
// WHY /funds NEEDED THIS. Every other number on the page is all-time and static, so the page
// reads as an archive: nothing on it can tell a returning reader whether anything happened.
//
// „НОВИ В ИСУН", NEVER „НОВИ ДОГОВОРИ". `fund_projects` has no date columns — ИСУН's export
// publishes no signing, start or end date — so every figure here is when WE first saw a row, not
// when it was signed. The plan's rule „event date, not ingest date" assumes the procurement
// corpus, which has `contracts.date`; on this one there is nothing to prefer, and the labels
// carry the distinction instead of implying the lag is zero.
//
// A BACKFILL IS NOT NEWS, and it is not hidden either. The server excludes backfill days from the
// itemised figures (the `summarised` rule, shared with /data/updates) and returns their size
// separately, so the wire can say „плюс 82 011 при първоначално зареждане" rather than leave a
// reader wondering why a freshly loaded corpus reports nothing new.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Coins, MapPin, Newspaper, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/ux/Card";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { formatEur } from "@/lib/currency";
import { OBLAST_NAME } from "@/lib/regionalOblast";
import {
  useFundsWire,
  type FundsNewsRow,
  type FundsWireResponse,
} from "@/data/funds/useFundsWire";

const numFmt = new Intl.NumberFormat("bg-BG");

/** A plain calendar day, formatted without a time — the column is a Postgres `date`, so adding
 *  one would invent a precision it does not have.
 *
 *  THE INPUT IS NOT ALWAYS A BARE DAY. node-postgres turns a PG `date` into a JS `Date`, which
 *  JSON-serialises to a full ISO instant — so this arrives as „2026-08-09T04:00:00.000Z" over
 *  HTTP and as a bare „2026-08-09" from anything that hands the value through unserialised.
 *  Concatenating „T12:00:00Z" onto the first form yields `Invalid Date`, which is how this shipped
 *  broken the first time. Take the leading date part and anchor at midday, which no timezone
 *  shift can push into an adjacent day.
 *
 *  UTC, not Europe/Sofia: a PG `date` has no timezone, so converting it into one would be
 *  inventing an instant and could shift the day. */
const day = (iso: string, lang: string): string => {
  const d = /^\d{4}-\d{2}-\d{2}/.exec(iso)?.[0];
  if (!d) return iso;
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${d}T12:00:00Z`));
};

// ── Band 0 ─────────────────────────────────────────────────────────────────────────────────

export const FundsWireLine: FC<{ className?: string }> = ({ className }) => {
  const { t, i18n } = useTranslation();
  const { data, isError } = useFundsWire();
  const w = data?.wire;
  // Nothing rather than a half-line: a wire is a claim that the page is current, and a failed
  // fetch must not make it.
  if (isError || !w || !w.checkedOn) return null;

  const bits: string[] = [
    t("wire_checked", { when: day(w.checkedOn, i18n.language) }),
  ];
  if (w.newProjects > 0)
    bits.push(
      t("wire_new", {
        count: w.newProjects,
        n: numFmt.format(w.newProjects),
        days: data!.windowDays,
        eur: formatEur(w.newEur, i18n.language),
      }),
    );
  // NAMED, not silently folded away. A corpus that was bulk-loaded inside the window reports no
  // itemised news, and without this the reader cannot tell that from a stalled pipeline.
  if (w.backfillRows > 0)
    bits.push(
      t("wire_backfill", {
        count: w.backfillRows,
        n: numFmt.format(w.backfillRows),
      }),
    );
  if (w.newProjects === 0 && w.backfillRows === 0)
    bits.push(t("wire_quiet", { days: data!.windowDays }));
  if (w.openCalls > 0) bits.push(t("wire_open", { count: w.openCalls }));

  return (
    <p className={className}>
      <span className="text-[11px] text-muted-foreground/80">
        {bits.join(" · ")}{" "}
        <Link to="/data/updates" className="text-primary hover:underline">
          {t("wire_all_updates")}
        </Link>
      </span>
    </p>
  );
};

// ── Band 2 ─────────────────────────────────────────────────────────────────────────────────

/** A leading „~" from the server means the label is one PROJECT's title standing in for a
 *  procedure that publishes no name of its own — 110 of the 119 procedures the disbursement card
 *  can draw from. Stripped for display and disclosed below the row, because presenting a single
 *  contract's title as the name of the scheme misattributes a criticism about the scheme. */
const isBorrowed = (r: FundsNewsRow) => r.label.startsWith("~");
const display = (
  r: FundsNewsRow,
  labelOf?: (r: FundsNewsRow) => string,
): string =>
  labelOf ? labelOf(r) : isBorrowed(r) ? r.label.slice(1) : r.label;

const RailCard: FC<{
  title: string;
  hint: string;
  icon: typeof Coins;
  rows: FundsNewsRow[];
  /** How to render the figure at the end of each row. */
  render: (r: FundsNewsRow) => string;
  emptyLabel: string;
  /** Oblast rows carry a CODE; everything else is already a display string. */
  labelOf?: (r: FundsNewsRow) => string;
}> = ({ title, hint, icon: Icon, rows, render, emptyLabel, labelOf }) => {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="p-3 text-sm md:p-4">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </div>
        <p className="mb-2 text-[11px] text-muted-foreground/80">{hint}</p>
        {rows.length === 0 ? (
          // A NAMED empty state. On a freshly backfilled corpus these cards are legitimately
          // empty, and a blank card reads as a broken tile rather than as a quiet month.
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((r) => (
              <li
                key={`${r.card}:${r.rank}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                {r.href ? (
                  <Link to={r.href} className="min-w-0 flex-1 hover:underline">
                    {display(r, labelOf)}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1">{display(r, labelOf)}</span>
                )}
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {render(r)}
                </span>
                {isBorrowed(r) && !labelOf ? (
                  <span className="w-full text-[11px] text-muted-foreground/80">
                    {t("news_example_title")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export const FundsNewsRail: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data, isError } = useFundsWire();
  if (isError || !data) return null;
  const { newContracts, byPlace, lowestPaid } = data.news;
  // Every card empty means the corpus has had no itemised activity AND the closed-period card
  // found nothing — there is no rail to show, and an all-empty band is worse than no band.
  if (!newContracts.length && !byPlace.length && !lowestPaid.length)
    return null;

  const eur = (r: FundsNewsRow) =>
    r.amountEur !== null ? formatEur(r.amountEur, i18n.language) : "—";

  return (
    <DashboardSection
      id="funds"
      title={t("news_band_title")}
      subtitle={t("news_band_sub", { days: data.newsWindowDays })}
      icon={Newspaper}
    >
      {/* THE RAIL'S OWN WINDOW. A backfill inside it is excluded from every card above, and
          saying so is the difference between „a quiet two months" and „we hid 81,616 rows". The
          wire has a separate figure over its own, shorter window — which is exactly why this one
          has to exist. */}
      {data.newsBackfill?.backfillRows > 0 ? (
        <p className="text-[11px] text-muted-foreground/80">
          {t("news_backfill", {
            count: data.newsBackfill.backfillRows,
            // i18next's `count` drives pluralisation but is interpolated RAW, so a bare
            // „81616" reaches the page. The formatted form travels as its own placeholder.
            n: numFmt.format(data.newsBackfill.backfillRows),
            days: data.newsWindowDays,
          })}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <RailCard
          title={t("news_new_title")}
          // „Появили се", not „подписани" — see the file header.
          hint={t("news_new_hint", { days: data.newsWindowDays })}
          icon={Coins}
          rows={newContracts}
          render={eur}
          emptyLabel={t("news_new_empty")}
        />
        <RailCard
          title={t("news_place_title")}
          hint={t("news_place_hint", { days: data.newsWindowDays })}
          icon={MapPin}
          rows={byPlace}
          // The oblast arrives as a CODE. `sublabel` carries the project count.
          labelOf={(r) => OBLAST_NAME[r.label]?.[lang] ?? r.label}
          render={(r) =>
            `${eur(r)}${r.sublabel ? ` · ${t("news_place_n", { count: Number(r.sublabel) })}` : ""}`
          }
          emptyLabel={t("news_place_empty")}
        />
        <RailCard
          title={t("news_paid_title")}
          // THE CAVEAT IS THE HINT. Restricted to the closed 2014-2020 period precisely so a
          // low figure cannot just mean „signed recently" — and the card says so, because a
          // percentage on a public register reads as a verdict unless it is framed.
          hint={t("news_paid_hint")}
          icon={TrendingDown}
          rows={lowestPaid}
          render={(r) =>
            r.pct !== null
              ? `${numFmt.format(Math.round(r.pct))}% · ${eur(r)}`
              : eur(r)
          }
          emptyLabel={t("news_paid_empty")}
        />
      </div>
    </DashboardSection>
  );
};

export type { FundsWireResponse };
