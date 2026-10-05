// The two cards that open „Социологически проучвания" on `/presidential/:cycle` — the same
// shape as the parliamentary dashboard's polling section (`PollsTile` + `AccuracyTrendsTile`):
// a per-agency accuracy leaderboard for the shown round, and accuracy across the presidential
// cycles. The full explorer (`PresidentialHistory`) still renders beneath them.
//
// ⚠⚠ THE GRADE IS THE ANALYZER'S, NEVER RE-DERIVED HERE. `analyze_accuracy.ts` withholds an
// overall MAE unless a question covers every major ticket plus the minor-candidate bucket in a
// comparable base — and on the committed corpus that withholds EVERY one. So the leaderboard has
// three kinds of row, and only the first draws a bar:
//   - a complete comparison  → MAE bar, days before, biggest miss;
//   - a partial comparison   → „непълно", plus the biggest miss among the candidates it DID
//                              publish (a fact about named rows, not a grade);
//   - no comparison at all   → the analyzer's own refusal reasons for the agency's latest poll.
// Averaging a partial comparison into a bar would grade an agency on the candidates it chose to
// publish, which is the exact thing the coverage policy exists to stop.
//
// ⚠ RENDERS NOTHING WHILE LOADING OR ON A FAILED FETCH. `PresidentialHistory` below reads the
// same queries and owns the loading status and the retryable alert; a second copy here would
// put two alerts in one section for one failure.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { History, Target } from "lucide-react";
import {
  usePresidentialPollsAccuracy,
  usePresidentialPollsList,
} from "@/data/presidential/usePresidentialPolls";
import { useAgencies } from "@/data/polls/useAgencies";
import type {
  Agency,
  PresidentialCandidateResultError,
} from "@/data/polls/pollsTypes";
import {
  PRESIDENTIAL_POLLS_DETAIL_ID,
  accuracyRows,
  specificReason,
} from "@/data/presidential/presidentialPollRows";
import { presidentialUrl } from "@/data/elections/presidentialRoutes";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  agencyMaeBarStyle,
  missColorClass,
  missSign,
} from "@/screens/dashboard/agencyMaeBar";
import { Hint } from "@/ux/Hint";
import { Link } from "@/ux/Link";
import { PresidentialPersonName } from "./PresidentialPersonName";

const agencyName = (
  agencies: Agency[] | undefined,
  id: string,
  isBg: boolean,
): string => {
  const a = agencies?.find((x) => x.id === id);
  return a ? (isBg ? a.name_bg : a.name_en) : id;
};

/** A miss on „други" / „не подкрепям никого" is not a person and must never become a link. */
const MissName: FC<{ miss: PresidentialCandidateResultError }> = ({ miss }) =>
  miss.key !== "други" && miss.key !== "none" ? (
    <PresidentialPersonName name={miss.name_bg} />
  ) : (
    <span className="font-medium truncate">{miss.name_bg}</span>
  );

/** The MAE track and fill; an absent `bar` draws the empty track. */
const MaeBar: FC<{ bar: ReturnType<typeof agencyMaeBarStyle> | null }> = ({
  bar,
}) => (
  <div className="relative h-2 rounded-full bg-muted overflow-hidden">
    {bar ? (
      <div
        className="absolute top-0 bottom-0 left-0 rounded-full"
        style={{
          width: `${bar.widthPct}%`,
          backgroundColor: `hsl(${bar.hue} 70% 45%)`,
        }}
      />
    ) : null}
  </div>
);

const HeaderCell: FC<{ hint?: string; right?: boolean; children: string }> = ({
  hint,
  right,
  children,
}) => {
  const cell = (
    <span
      className={`text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${
        right ? "text-right" : ""
      }`}
    >
      {children}
    </span>
  );
  return hint ? (
    <Hint text={hint} underline={false}>
      {cell}
    </Hint>
  ) : (
    cell
  );
};

export const PresidentialPollsTile: FC<{ cycle: string; round: 1 | 2 }> = ({
  cycle,
  round,
}) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const aq = usePresidentialPollsAccuracy();
  const pq = usePresidentialPollsList();
  const { data: agencies } = useAgencies();

  const entry = aq.data?.cycles.find((c) => c.cycle === cycle);
  const rows = useMemo(
    () => (entry ? accuracyRows(entry, round, pq.data ?? []) : []),
    [entry, round, pq.data],
  );

  if (aq.isPending || aq.isError || pq.isPending || pq.isError) return null;

  const complete = rows.filter((r) => r.kind === "complete");
  const maxMae = Math.max(
    0.01,
    ...complete.map((r) => (r.kind === "complete" ? (r.mae ?? 0) : 0)),
  );

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("presidential_polls_tile_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span>{t("polls_title")}</span>
            </div>
          </Hint>
          <a
            href={`#${PRESIDENTIAL_POLLS_DETAIL_ID}`}
            className="text-[10px] normal-case text-primary hover:underline"
          >
            {t("dashboard_see_details")} →
          </a>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm mt-1 text-muted-foreground">
          {t("presidential_polls_unscored")}
        </p>
      ) : (
        <>
          <p className="text-sm leading-relaxed mt-1 text-muted-foreground">
            {t("presidential_polls_tile_summary", {
              agencies: rows.length,
              round: t("election_round", { round }),
              complete: complete.length,
            })}
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(120px,4fr)_auto_auto_minmax(0,1.6fr)] gap-x-3 gap-y-1.5 items-center mt-3 text-sm">
            <HeaderCell>{t("polls_agency")}</HeaderCell>
            <span />
            <HeaderCell hint={t("presidential_polls_mae_hint")} right>
              MAE
            </HeaderCell>
            <HeaderCell hint={t("dashboard_polls_days_before_hint")} right>
              {t("polls_days_before")}
            </HeaderCell>
            <HeaderCell hint={t("presidential_polls_biggest_miss_hint")}>
              {t("polls_biggest_miss")}
            </HeaderCell>
            {rows.map((r) => {
              const bar =
                r.kind === "complete" && r.mae !== null
                  ? agencyMaeBarStyle(r.mae, maxMae)
                  : null;
              return (
                <div className="contents" key={r.agencyId}>
                  <Link
                    to={`/polls/${r.agencyId}/presidential`}
                    className="font-medium truncate hover:underline"
                    underline={false}
                  >
                    {agencyName(agencies, r.agencyId, isBg)}
                  </Link>
                  <MaeBar bar={bar} />
                  <span className="tabular-nums text-xs font-semibold text-right">
                    {r.kind === "complete" && r.mae !== null ? (
                      r.mae.toFixed(2)
                    ) : (
                      <span className="font-normal text-muted-foreground">
                        {r.kind === "partial"
                          ? t("presidential_polls_partial")
                          : "—"}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground text-right">
                    {r.daysBefore !== null ? `${r.daysBefore}d` : "—"}
                  </span>
                  <span className="text-xs flex items-center gap-1.5 min-w-0">
                    {r.kind !== "unscored" && r.miss ? (
                      <>
                        <span className="truncate min-w-0">
                          <MissName miss={r.miss} />
                        </span>
                        <span
                          className={`tabular-nums font-semibold shrink-0 ${missColorClass(r.miss.error)}`}
                        >
                          {missSign(r.miss.error)}
                          {r.miss.error.toFixed(1)}pp
                        </span>
                      </>
                    ) : r.kind === "unscored" ? (
                      <span className="text-muted-foreground truncate">
                        {r.reasons.length
                          ? t(`pp_reason_${specificReason(r.reasons)}`)
                          : t("presidential_polls_not_compared")}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          {complete.length === 0 ? (
            <p className="text-xs mt-3 text-muted-foreground">
              {t("presidential_polls_no_grade_note")}
            </p>
          ) : null}
        </>
      )}
    </StatCard>
  );
};

/** Accuracy across the presidential cycles for one round — the parliamentary trends card's
 *  counterpart. A cycle with no complete comparison says so rather than drawing a zero bar. */
export const PresidentialPollsTrendTile: FC<{
  cycle: string;
  round: 1 | 2;
}> = ({ cycle, round }) => {
  const { t } = useTranslation();
  const aq = usePresidentialPollsAccuracy();
  const pq = usePresidentialPollsList();

  const cycles = useMemo(() => {
    const list = aq.data?.cycles ?? [];
    return [...list]
      .sort((a, b) => a.round1Date.localeCompare(b.round1Date))
      .map((c) => {
        const rows = accuracyRows(c, round, pq.data ?? []);
        const maes = rows.flatMap((r) =>
          r.kind === "complete" && r.mae !== null ? [r.mae] : [],
        );
        return {
          cycle: c.cycle,
          year: c.round1Date.slice(0, 4),
          agencies: rows.length,
          partial: rows.filter((r) => r.kind === "partial").length,
          scored: maes.length,
          meanMae: maes.length
            ? maes.reduce((s, v) => s + v, 0) / maes.length
            : null,
        };
      })
      .filter((c) => c.agencies > 0 || c.cycle === cycle);
  }, [aq.data, pq.data, round, cycle]);

  if (aq.isPending || aq.isError || pq.isPending || pq.isError) return null;
  if (cycles.length === 0) return null;
  const maxMae = Math.max(0.01, ...cycles.map((c) => c.meanMae ?? 0));

  return (
    <StatCard
      label={
        <Hint text={t("presidential_polls_trend_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4" />
            <span>
              {t("presidential_polls_trend_title", {
                round: t("election_round", { round }),
              })}
            </span>
          </div>
        </Hint>
      }
    >
      <div className="grid grid-cols-[auto_minmax(120px,4fr)_auto_minmax(0,2fr)] gap-x-3 gap-y-1.5 items-center mt-2 text-sm">
        <HeaderCell>{t("presidential_polls_trend_cycle")}</HeaderCell>
        <span />
        <HeaderCell hint={t("presidential_polls_trend_mae_hint")} right>
          MAE
        </HeaderCell>
        <HeaderCell>{t("presidential_polls_trend_coverage")}</HeaderCell>
        {cycles.map((c) => {
          const bar =
            c.meanMae !== null ? agencyMaeBarStyle(c.meanMae, maxMae) : null;
          const current = c.cycle === cycle;
          return (
            <div className="contents" key={c.cycle}>
              <Link
                to={{
                  pathname:
                    presidentialUrl(c.cycle, "country") ??
                    `/presidential/${c.cycle}`,
                  search: { pollRound: String(round) },
                }}
                className={`tabular-nums hover:underline ${current ? "font-semibold" : ""}`}
                underline={false}
                aria-current={current ? "page" : undefined}
              >
                {c.year}
              </Link>
              <MaeBar bar={bar} />
              <span className="tabular-nums text-xs font-semibold text-right">
                {c.meanMae !== null ? (
                  c.meanMae.toFixed(2)
                ) : (
                  <span className="font-normal text-muted-foreground">—</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {t("presidential_polls_trend_counts", {
                  agencies: c.agencies,
                  scored: c.scored,
                  partial: c.partial,
                })}
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
