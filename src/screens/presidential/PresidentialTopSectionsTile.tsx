// „Топ секции" for a presidential settlement page — `/sections/:ekatte`'s geography tile: the
// settlement's polling stations by votes cast for a pair, with the address, the leading ticket
// and its share, each linking to that station's presidential page.
//
// ⚠ NO NEW REQUEST. The rows are the oblast's section shard (`tur<round>/sections/<oblast>.json`)
// the page's station map already reads, and the address is the parliamentary archive's, joined
// by station code exactly as the map joins its coordinates — so the tile and the map cannot
// place a station differently. A station the archive does not list renders „—", not a guess.
//
// ⚠ THE SHARE IS THE LEADER'S SHARE OF THAT STATION'S TICKET VOTES — the same denominator every
// presidential map uses, so the colour and the number beside it agree.
//
// ⚠ RENDERS NOTHING below two stations, as the parliamentary tile does: a ranking of one row is
// the result table again.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Vote } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useTicketsByNumber } from "@/data/presidential/useTickets";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { roundSearch } from "@/data/presidential/roundParam";
import { formatInt, formatPct } from "@/lib/currency";
import { useTopSections } from "@/data/presidential/useTopSections";

const TOP_N = 15;

export const PresidentialTopSectionsTile: FC<{
  cycle: string;
  round: 1 | 2;
  ekatte: string;
}> = ({ cycle, round, ekatte }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tickets = useTicketsByNumber(cycle);
  const all = useTopSections(cycle, round, ekatte);
  if (all.length < 2) return null;
  const rows = all.slice(0, TOP_N);
  const max = rows[0].total;
  return (
    <StatCard
      label={
        <Hint text={t("presidential_top_sections_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Vote className="h-4 w-4" />
            <span>
              {t(
                all.length <= TOP_N
                  ? "dashboard_settlement_sections"
                  : "dashboard_settlement_top_sections",
              )}
            </span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <div className="mt-1 grid grid-cols-[auto_minmax(0,1.4fr)_auto_minmax(60px,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-sm">
        {(["section", "address", "presidential_col_votes"] as const).map(
          (k, i) => (
            <span
              key={k}
              className={`text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${i === 2 ? "text-right" : ""}`}
            >
              {t(k)}
            </span>
          ),
        )}
        <span aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("winner")}
        </span>
        {rows.map((r) => {
          const ticket = r.leader ? tickets.get(r.leader.number) : undefined;
          const to = presidentialUrl(cycle, "section", r.code);
          const inner = (
            <>
              <span className="font-mono text-xs">{r.code}</span>
              <span className="truncate text-xs" title={r.address}>
                {r.address || "—"}
              </span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {formatInt(r.total, lang)}
              </span>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (r.total / max) * 100)}%`,
                    backgroundColor: ticket?.color ?? "#888",
                  }}
                />
              </div>
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {ticket && r.leader ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: ticket.color ?? "#888" }}
                    />
                    <span className="truncate">{ticket.president}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatPct(r.leader.votes / r.total, lang, 1)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </>
          );
          return to ? (
            <Link
              key={r.code}
              to={to + roundSearch(round)}
              className="contents"
            >
              {inner}
            </Link>
          ) : (
            <div key={r.code} className="contents">
              {inner}
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
