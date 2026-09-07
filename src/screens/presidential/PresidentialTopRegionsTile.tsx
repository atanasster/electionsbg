// „Къде бяха гласовете" — the oblasts that cast the most, and who led each.
//
// ⚠ NO NEW REQUEST. It reads the SAME region roll-up the country map is filled from, which the
// round panel has already fetched — the whole reason this tile is at oblast grain and not
// finer: the municipality roll-up is 974.6 KB and the settlement one 14.4 MB.
//
// ⚠ IT IS NOT `PresidentialRegionsList`, AND THE TWO ANSWER DIFFERENT QUESTIONS. That table is
// the map's text equivalent: every oblast, sorted BY NAME, so a reader can find their own. This
// is the top of a ranking — where the country's votes actually are — which is the question
// `/parliamentary`'s own „Топ региони" tile answers and the one a reader asks after seeing a
// national result.
//
// ⚠⚠ THE SHARE IS OF THE TICKET VOTES IN THE ROLL-UP, AND THE CAPTION SAYS SO. The roll-up
// carries per-ticket votes and no protocol, so „voted" here is votes CAST FOR A PAIR — not
// turnout, and not valid votes, which also include „не подкрепям никого". A tile that called
// this figure turnout would be off by the abstention line and by every invalid ballot, and the
// two are not small: 2021 round 1 has 56,720 „никого" votes alone.
//
// ⚠ NO CHANGE COLUMN. The parliamentary tile prints a delta against the prior election; the
// prior PRESIDENTIAL cycle is five years back and its roll-up is a second 113.9 KB fetch, so
// a delta here would cost a request for a comparison across a different electorate and a
// different field of candidates. Left out rather than approximated.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { useRegions } from "@/data/regions/useRegions";
import { regionDisplayName } from "@/data/presidential/regionName";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { formatInt, formatPct } from "@/lib/currency";
import {
  foldPlace,
  type RoundRollup,
} from "@/data/presidential/useRoundRollup";
import type { PresidentialTicket } from "@/data/presidential/useTickets";

const TOP_N = 10;
const PCT_DIGITS = 1;

type Row = {
  code: string;
  name: string;
  votes: number;
  share: number;
  barPct: number;
  leader?: { name: string; color?: string };
};

export const PresidentialTopRegionsTile: FC<{
  cycle: string;
  rollup: RoundRollup;
  tickets: Map<number, PresidentialTicket>;
}> = ({ cycle, rollup, tickets }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isBg = lang?.startsWith("bg") ?? true;
  const { findRegion } = useRegions();

  const { rows, total } = useMemo(() => {
    // ⚠ THE SHARED FOLD, NOT A COPY OF IT. „The lower ballot number breaks a tie" is the rule
    // the MAP colours by; a second copy here would let the two name different leaders for the
    // same oblast on the same page — which the comment used to assert could not happen while
    // nothing enforced it.
    const counted = rollup.entries.map(foldPlace);
    const sum = counted.reduce((a, r) => a + r.total, 0);
    const top = counted
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_N);
    const max = top[0]?.total ?? 1;
    return {
      total: sum,
      rows: top.map<Row>((r) => {
        // ⚠ A PLACE THAT CAST NOTHING HAS NO LEADER — `leadersByPlace`'s rule, and these rows
        // are filtered to `votes > 0` for the same reason: colouring an empty oblast would put
        // a named pair's colour on a place nobody voted in.
        const lead =
          r.best && r.best.totalVotes > 0
            ? tickets.get(r.best.partyNum)
            : undefined;
        return {
          code: r.key,
          name: regionDisplayName(findRegion(r.key), isBg, r.key),
          votes: r.total,
          share: sum > 0 ? r.total / sum : 0,
          barPct: (r.total / max) * 100,
          leader: lead
            ? { name: lead.president, color: lead.color }
            : undefined,
        };
      }),
    };
  }, [rollup, tickets, findRegion, isBg]);

  if (rows.length === 0 || total === 0) return null;

  return (
    <StatCard
      label={
        <Hint text={t("presidential_top_regions_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span>{t("presidential_top_regions_title")}</span>
          </div>
        </Hint>
      }
      className="overflow-hidden"
    >
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_minmax(60px,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("region")}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_winner")}
        </span>
        <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("presidential_col_votes")}
        </span>
        {/* ⚠ THE BAR COLUMN IS UNLABELLED, and „Сега" IS GONE. Both headers were copied from
            the parliamentary tile, where „Дял" heads the bar and „Сега" heads the percentage
            beside a „Промяна" column. This tile drops the change column deliberately, which
            leaves a TEMPORAL word („now") over a share with nothing to be „now" as opposed to
            — and „Дял" over the bar, whose width is `votes / max`, a proportion of the LARGEST
            oblast rather than the share. The share label now heads the share. */}
        <span aria-hidden="true" />
        <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("dashboard_share")}
        </span>
        {rows.map((r) => {
          const to = presidentialUrl(cycle, "region", r.code);
          const inner = (
            <>
              <span className="truncate font-medium">{r.name}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {r.leader ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: r.leader.color ?? "#888" }}
                    />
                    <span className="truncate">{r.leader.name}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {formatInt(r.votes, lang)}
              </span>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, r.barPct)}%`,
                    backgroundColor: r.leader?.color ?? "#888",
                  }}
                />
              </div>
              <span className="text-right text-xs font-semibold tabular-nums">
                {formatPct(r.share, lang, PCT_DIGITS)}
              </span>
            </>
          );
          // ⚠ A ROW IS A LINK ONLY WHERE THE ROUTE EXISTS. `presidentialUrl` returns null for a
          // cycle the catalogue does not carry, and a `<Link to={null}>` is a runtime error.
          return to ? (
            <Link key={r.code} to={to} className="contents">
              {inner}
            </Link>
          ) : (
            <div key={r.code} className="contents">
              {inner}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_top_regions_note")}
      </p>
    </StatCard>
  );
};
