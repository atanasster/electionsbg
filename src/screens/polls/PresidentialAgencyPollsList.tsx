// „Всички проучвания (N)" for one agency's presidential polls — the parliamentary
// `AgencyPollsList` card, per question: each candidate's published share as a bar, the official
// round result as a marker, and the difference.
//
// ⚠ THE DIFFERENCE IS SHOWN ONLY WHERE THE TWO NUMBERS SHARE A DENOMINATOR. The result is a
// share of valid votes; a question asked of ALL respondents (undecided and non-voters inside the
// base) would show every candidate as a large underestimate that is a base mismatch, not a
// polling miss. Those rows keep the result marker and show „—" for the difference. A scenario
// question (a hypothetical field or matchup) is never compared at all.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ExternalLink, ListOrdered } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import type {
  Poll,
  PollQuestion,
  PresidentialCycleAccuracy,
  PresidentialPollDetail,
  Runoff,
} from "@/data/polls/pollsTypes";
import { localizeFieldwork, sortByFieldworkDesc } from "@/data/polls/fieldwork";
import { isNamedCandidateRow } from "@/data/polls/presidentialRow";
import { localDate } from "@/data/utils";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";

const COMPARABLE_BASES = new Set([
  "decided_voters",
  "valid_votes",
  "likely_voters",
]);

/** The official round result in the question's own base. When the question did NOT offer
 *  „не подкрепям никого", the result is renormalised without it — the analyzer's rule.
 *  ⚠ THE DIFFERENCE IS AGAINST THE PUBLISHED SHARE, as on the parliamentary agency list. The
 *  profile card's grades also redistribute a poll's undecided share, so for a poll that
 *  published one the two can differ by that redistribution. */
const resultsFor = (
  cycle: PresidentialCycleAccuracy | undefined,
  q: PollQuestion | null,
): Map<string, number> | null => {
  if (!cycle || !q || q.scenario) return null;
  if (q.measure !== "vote_intention" && q.measure !== "runoff") return null;
  const round = cycle.rounds?.find((r) => r.round === (q.round ?? 1));
  if (!round) return null;
  const nonePct = round.actualResults.find((r) => r.key === "none")?.pct ?? 0;
  const scale = q.base.includesNone === true ? 1 : 100 / (100 - nonePct);
  return new Map(
    round.actualResults
      .filter((r) => q.base.includesNone === true || r.key !== "none")
      .map((r) => [r.key, r.pct * scale]),
  );
};

const QuestionRows: FC<{
  q: PollQuestion | null;
  rows: PresidentialPollDetail[];
  results: Map<string, number> | null;
}> = ({ q, rows, results }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const comparable = !!q && COMPARABLE_BASES.has(q.base.kind);
  const tiered = (q?.answerScale.length ?? 0) > 1;
  const resolved = rows.map((d) => ({
    d,
    actual: results?.get(d.candidateKey),
  }));
  const max = Math.max(
    0.01,
    ...resolved.map((r) => r.d.support),
    ...resolved.map((r) => r.actual ?? 0),
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:grid-cols-[minmax(0,1fr)_minmax(80px,2fr)_auto_auto_auto] gap-x-3 gap-y-1 items-center text-xs">
      <span />
      <span className="hidden sm:block" />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
        {t("polls_polled_short")}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
        {t("polls_actual_short")}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-right">
        {t("polls_diff_short")}
      </span>
      {resolved.map(({ d, actual }) => {
        const diff =
          comparable && actual !== undefined ? d.support - actual : undefined;
        const diffColor =
          diff === undefined || Math.abs(diff) < 1
            ? "text-muted-foreground"
            : diff > 0
              ? "text-emerald-600"
              : "text-rose-600";
        const answer = tiered
          ? q?.answerScale.find((a) => a.code === d.answerCode)?.label[lang]
          : undefined;
        return (
          <div
            className="contents"
            key={`${d.questionId}-${d.candidateKey}-${d.answerCode}`}
          >
            <span className="text-xs truncate">
              {isNamedCandidateRow(d) ? (
                <PresidentialPersonName name={d.candidateName_bg} />
              ) : (
                d.candidateName_bg
              )}
              {answer ? (
                <span className="text-muted-foreground"> · {answer}</span>
              ) : null}
            </span>
            <div className="hidden sm:block relative h-2 rounded-full bg-muted">
              <div
                className="absolute top-0 bottom-0 left-0 rounded-full bg-primary/70"
                style={{ width: `${Math.max(2, (d.support / max) * 100)}%` }}
              />
              {actual !== undefined ? (
                <div
                  className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-foreground"
                  style={{
                    left: `${Math.min(100, (actual / max) * 100)}%`,
                    boxShadow: "0 0 0 1px hsl(var(--background))",
                  }}
                  title={t("polls_actual_short")}
                />
              ) : null}
            </div>
            <span className="tabular-nums text-xs font-semibold w-12 text-right">
              {d.support.toFixed(1)}%
            </span>
            <span className="tabular-nums text-xs w-12 text-right text-muted-foreground">
              {actual !== undefined ? `${actual.toFixed(1)}%` : "—"}
            </span>
            <span
              className={`tabular-nums text-xs font-semibold w-14 text-right ${diffColor}`}
            >
              {diff !== undefined
                ? `${diff >= 0.05 ? "+" : ""}${(Math.abs(diff) < 0.05 ? 0 : diff).toFixed(1)}pp`
                : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const PresidentialAgencyPollsList: FC<{
  polls: Poll[];
  details: PresidentialPollDetail[];
  runoffs: Runoff[];
  cycles: readonly PresidentialCycleAccuracy[];
}> = ({ polls, details, runoffs, cycles }) => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const lang = isBg ? "bg" : "en";
  const sorted = useMemo(() => sortByFieldworkDesc(polls), [polls]);
  const cycleById = useMemo(
    () => new Map(cycles.map((c) => [c.cycle, c])),
    [cycles],
  );

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          <span>
            {t("polls_all_polls")}
            {sorted.length ? ` (${sorted.length})` : ""}
          </span>
        </div>
      }
    >
      {sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("polls_no_polls_for_agency")}
        </div>
      ) : (
        <>
          <div className="hidden sm:block text-[11px] text-muted-foreground -mt-1 mb-1">
            {t("polls_actual_marker_legend")}
          </div>
          <div className="flex flex-col gap-3 mt-1">
            {sorted.map((p) => {
              const cycle = p.cycle ? cycleById.get(p.cycle) : undefined;
              const methodology = p.methodology[lang];
              const blocks = p.questions?.length ? p.questions : [null];
              return (
                <article
                  key={p.id}
                  id={p.id}
                  className="rounded-lg border bg-background/50 p-3 flex flex-col gap-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span className="font-semibold text-sm">
                      {localizeFieldwork(p.fieldwork, isBg)}
                    </span>
                    {p.cycle ? (
                      <Link
                        to={`/presidential/${p.cycle}`}
                        className="text-muted-foreground hover:underline"
                      >
                        {t("polls_for_election")}:{" "}
                        {cycle
                          ? localDate(cycle.round1Date.replace(/-/g, "_"))
                          : p.cycle.slice(0, 4)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground italic">
                        {t("polls_no_target_election")}
                      </span>
                    )}
                    {p.respondents ? (
                      <span className="text-muted-foreground tabular-nums">
                        n={p.respondents.toLocaleString()}
                      </span>
                    ) : null}
                    {p.source ? (
                      <a
                        href={p.source}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-auto text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("polls_source")}
                      </a>
                    ) : null}
                  </div>
                  {methodology && methodology !== "N/A" ? (
                    <div className="text-[11px] text-muted-foreground italic">
                      {methodology}
                    </div>
                  ) : null}
                  {blocks.map((q) => {
                    const rows = details.filter(
                      (d) =>
                        d.pollId === p.id &&
                        (q ? d.questionId === q.id : !d.questionId),
                    );
                    const pairs = runoffs.filter(
                      (r) =>
                        r.pollId === p.id &&
                        (q ? r.questionId === q.id : !r.questionId),
                    );
                    if (!rows.length && !pairs.length) return null;
                    return (
                      <section
                        key={q?.id ?? "legacy"}
                        aria-label={
                          q?.wording[lang] ?? t("pp_history_undocumented")
                        }
                        className="flex flex-col gap-1 pt-1"
                      >
                        <div className="text-xs font-medium">
                          {q?.wording[lang] ?? t("pp_history_undocumented")}
                        </div>
                        {q ? (
                          <div className="text-[11px] text-muted-foreground">
                            {t("pp_history_round")} {q.round ?? "—"} ·{" "}
                            {q.base.label[lang]}
                            {q.scenario
                              ? ` · ${t("pp_history_hypothetical")}`
                              : ""}
                          </div>
                        ) : null}
                        {rows.length ? (
                          <QuestionRows
                            q={q}
                            rows={rows}
                            results={resultsFor(cycle, q)}
                          />
                        ) : null}
                        {pairs.map((r) => (
                          <p key={`${r.a}-${r.b}`} className="text-xs">
                            {r.aName_bg ?? r.a}: {r.supportA.toFixed(1)}% /{" "}
                            {r.bName_bg ?? r.b}: {r.supportB.toFixed(1)}%
                          </p>
                        ))}
                      </section>
                    );
                  })}
                </article>
              );
            })}
          </div>
        </>
      )}
    </StatCard>
  );
};
