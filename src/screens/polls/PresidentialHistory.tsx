import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  usePresidentialPollsList,
  usePresidentialPollDetails,
  usePresidentialRunoffs,
  usePresidentialPollsAccuracy,
} from "@/data/presidential/usePresidentialPolls";
import { campaignObservations } from "@/data/presidential/pollHistory";
import type { Poll, PresidentialCycleAccuracy } from "@/data/polls/pollsTypes";
import { AgencyPresidentialPollsList } from "./AgencyPresidentialPollsList";
import {
  PresidentialInsights,
  PresidentialCoveragePanel,
} from "./PresidentialInsights";

export function PresidentialResultComparisons({
  accuracy,
  polls,
  round,
  agencyId,
}: {
  accuracy: PresidentialCycleAccuracy;
  polls: Poll[];
  round: number;
  agencyId?: string;
}) {
  const { t } = useTranslation();
  const comparisons =
    accuracy.rounds
      ?.find((r) => r.round === round)
      ?.comparisons.filter((c) => !agencyId || c.agencyId === agencyId) ?? [];
  const diagnostics =
    accuracy.diagnostics?.filter(
      (d) => d.round === round && (!agencyId || d.agencyId === agencyId),
    ) ?? [];
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{t("pp_history_result")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("pp_history_accuracy_policy")}
      </p>
      {!comparisons.length && <p>{t("presidential_polls_unscored")}</p>}
      {comparisons.map((c) => (
        <article
          key={c.pollId + c.questionId}
          className="rounded-lg border p-3 space-y-2"
        >
          <div className="flex flex-wrap gap-3">
            <Link
              className="underline text-primary"
              to={`/polls/${c.agencyId}/presidential`}
            >
              {c.agencyId}
            </Link>
            <span>
              {c.fieldworkEnd} · n={c.respondents ?? "—"} · {c.daysBefore}{" "}
              {t("polls_days_before")}
            </span>
            <span>
              {t(
                c.includesNone
                  ? "pp_history_with_none"
                  : "pp_history_without_none",
              )}
            </span>
            <a
              className="underline text-primary"
              href={polls.find((p) => p.id === c.pollId)?.source}
            >
              {t("polls_source")}
            </a>
          </div>
          <p>
            MAE:{" "}
            {c.mae === null
              ? t("pp_history_incomplete")
              : c.mae.toFixed(2) + " " + t("pp_history_pp")}{" "}
            · RMSE:{" "}
            {c.rmse === null
              ? "—"
              : c.rmse.toFixed(2) + " " + t("pp_history_pp")}
          </p>
          {!c.coverage.complete && (
            <p className="text-sm">
              {t("pp_history_missing")}:{" "}
              {[
                ...c.coverage.missingKeys.map(
                  (key) =>
                    accuracy.rounds
                      ?.find((r) => r.round === round)
                      ?.actualResults.find((r) => r.key === key)?.name_bg ??
                    key,
                ),
                ...c.coverage.unresolvedNames,
              ].join(", ") || t("pp_history_distribution")}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">
                {t("pp_history_result")} · {c.agencyId}
              </caption>
              <thead>
                <tr>
                  {["candidate", "polled", "actual", "error"].map((k) => (
                    <th scope="col" key={k} className="p-2">
                      {t(`pp_history_${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.errors.map((e) => (
                  <tr key={e.key} className="border-t">
                    <th scope="row" className="p-2 font-normal">
                      {e.name_bg}
                    </th>
                    <td className="p-2">{e.polled.toFixed(1)}%</td>
                    <td className="p-2">{e.actual.toFixed(1)}%</td>
                    <td className="p-2">
                      {e.error > 0 ? "+" : ""}
                      {e.error.toFixed(2)} {t("pp_history_pp")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
      {diagnostics.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            {t("pp_history_eligibility")}
          </summary>
          <ul className="space-y-2 mt-2 text-sm">
            {diagnostics.map((d) => (
              <li key={d.pollId + d.questionId}>
                {d.agencyId} ·{" "}
                {polls.find((p) => p.id === d.pollId)?.fieldwork ?? d.pollId} ·{" "}
                {d.questionId}:{" "}
                {d.reasons.length
                  ? d.reasons.map((r) => t(`pp_reason_${r}`)).join("; ")
                  : t(
                      d.selected ? "pp_history_selected" : "pp_history_earlier",
                    )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function PresidentialHistory({
  cycle,
  agencyId,
  round: controlledRound,
}: {
  cycle?: string;
  agencyId?: string;
  round?: 1 | 2;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const pq = usePresidentialPollsList(),
    dq = usePresidentialPollDetails(),
    rq = usePresidentialRunoffs(),
    aq = usePresidentialPollsAccuracy();
  const [params, setParams] = useSearchParams();
  const chosenCycle = params.get("pollCycle") ?? "";
  const chosenAgency = params.get("pollAgency") ?? "";
  const candidate = params.get("pollCandidate") ?? "";
  const setFilter = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const setCycle = (v: string) => setFilter("pollCycle", v);
  const setAgency = (v: string) => setFilter("pollAgency", v);
  const setCandidate = (v: string) => setFilter("pollCandidate", v);
  const setRound = (v: 1 | 2) => setFilter("pollRound", String(v));
  const round = controlledRound ?? (params.get("pollRound") === "2" ? 2 : 1);
  const queries = [pq, dq, rq, aq];
  if (queries.some((q) => q.isError))
    return (
      <div role="alert" className="p-4 border rounded-lg">
        <p>{t("pp_history_load_error")}</p>
        <button
          className="underline text-primary p-2"
          onClick={() => {
            queries.forEach((q) => {
              void q.refetch();
            });
          }}
        >
          {t("pp_history_retry")}
        </button>
      </div>
    );
  if (queries.some((q) => q.isPending))
    return (
      <p role="status" aria-busy="true">
        {t("pp_history_loading")}
      </p>
    );
  const allPolls = (pq.data ?? []).filter(
    (p) => !agencyId || p.agencyId === agencyId,
  );
  const validCycle = allPolls.some(
    (p) => (p.cycle ?? "unassigned") === chosenCycle,
  )
    ? chosenCycle
    : "";
  const cycleValue = cycle ?? validCycle;
  const cyclePolls = allPolls.filter(
    (p) => !cycleValue || (p.cycle ?? "unassigned") === cycleValue,
  );
  const validAgency = cyclePolls.some((p) => p.agencyId === chosenAgency)
    ? chosenAgency
    : "";
  const polls = cyclePolls.filter(
    (p) => !validAgency || p.agencyId === validAgency,
  );
  const points = campaignObservations(polls, dq.data ?? [], round);
  const candidates = [
    ...new Map(
      points.map((p) => [p.detail.candidateKey, p.detail.candidateName_bg]),
    ).entries(),
  ];
  const validCandidate = candidates.some(([id]) => id === candidate)
    ? candidate
    : "";
  const shown = points.filter(
    (p) => !validCandidate || p.detail.candidateKey === validCandidate,
  );
  const series = [...new Set(shown.map((p) => p.series))];
  const cycles = [...new Set(allPolls.map((p) => p.cycle ?? "unassigned"))]
    .sort()
    .reverse();
  const comparisons =
    aq.data?.cycles.filter(
      (c) =>
        (!cycleValue || c.cycle === cycleValue) &&
        polls.some((p) => p.cycle === c.cycle),
    ) ?? [];
  const label = (
    key: string,
    value: string,
    change: (value: string) => void,
    options: [string, string][],
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {t(key)}
      <select
        aria-label={t(key)}
        className="rounded border bg-background p-2 max-w-full"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">{t("pp_history_all")}</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-6 min-w-0">
      {!cycle && (
        <h2 className="text-lg font-semibold">
          {t("polls_presidential_polls")}
        </h2>
      )}
      <div className="flex flex-wrap gap-3">
        {!cycle &&
          label(
            "pp_history_cycle",
            validCycle,
            setCycle,
            cycles.map((c) => [
              c,
              c === "unassigned" ? t("pp_history_unassigned") : c.slice(0, 4),
            ]),
          )}
        {!agencyId &&
          label(
            "polls_agency",
            validAgency,
            setAgency,
            [...new Set(cyclePolls.map((p) => p.agencyId))].map((id) => [
              id,
              id,
            ]),
          )}
        {controlledRound === undefined && (
          <label className="flex flex-col gap-1 text-sm">
            {t("pp_history_round")}
            <select
              aria-label={t("pp_history_round")}
              className="rounded border bg-background p-2"
              value={round}
              onChange={(e) => setRound(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
        )}
        {label(
          "pp_history_candidate",
          validCandidate,
          setCandidate,
          candidates,
        )}
      </div>
      {!cyclePolls.length ? (
        <p>{t("pp_history_no_coverage")}</p>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="font-semibold">{t("pp_history_campaign")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("pp_history_chart_hint")}
            </p>
            {!shown.length ? (
              <p>{t("pp_history_no_observations")}</p>
            ) : (
              <>
                <div className="h-72" aria-hidden="true">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart
                      margin={{ top: 12, right: 20, bottom: 12, left: 0 }}
                    >
                      <CartesianGrid stroke="hsl(var(--border))" />
                      <XAxis
                        tick={{ fill: "hsl(var(--foreground))" }}
                        type="number"
                        dataKey="time"
                        domain={["dataMin - 86400000", "dataMax + 86400000"]}
                        tickFormatter={(v) =>
                          new Date(v).toISOString().slice(0, 10)
                        }
                        name={t("pp_history_date")}
                      />
                      <YAxis
                        tick={{ fill: "hsl(var(--foreground))" }}
                        type="number"
                        dataKey="support"
                        domain={[0, 100]}
                        unit="%"
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          const point = payload?.[0]?.payload as
                            | ((typeof shown)[number] & { support: number })
                            | undefined;
                          return active && point ? (
                            <div className="rounded border bg-background p-3 max-w-xs text-sm shadow">
                              <p>
                                {point.detail.candidateName_bg}:{" "}
                                {point.detail.support}%
                              </p>
                              <p>
                                {point.poll.agencyId} · {point.poll.fieldwork}
                              </p>
                              <p>
                                {t("pp_history_published")}:{" "}
                                {point.poll.publishedAt ?? "—"}
                              </p>
                              <p>
                                n=
                                {point.question.base.respondents ??
                                  t("pp_history_unknown")}{" "}
                                · {point.poll.methodology[lang]}
                              </p>
                              <p>{point.question.base.label[lang]}</p>
                              <p className="break-all">{point.poll.source}</p>
                            </div>
                          ) : null;
                        }}
                      />
                      {series.map((s, index) => (
                        <Scatter
                          key={s}
                          name={s}
                          data={shown
                            .filter((p) => p.series === s)
                            .map((p) => ({ ...p, support: p.detail.support }))}
                          fill={`hsl(var(--${["primary", "positive", "negative", "popover-foreground"][index % 4]}))`}
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <caption className="text-left pb-2">
                      {t("pp_history_table")}
                    </caption>
                    <thead>
                      <tr>
                        {[
                          "date",
                          "candidate",
                          "share",
                          "base",
                          "published",
                        ].map((k) => (
                          <th scope="col" key={k} className="p-2">
                            {t(`pp_history_${k}`)}
                          </th>
                        ))}
                        <th scope="col" className="p-2">
                          {t("polls_agency")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((p) => (
                        <tr
                          key={
                            p.poll.id +
                            p.question.id +
                            p.detail.candidateKey +
                            p.detail.answerCode
                          }
                          className="border-t"
                        >
                          <td className="p-2 whitespace-nowrap">{p.date}</td>
                          <th scope="row" className="p-2 font-normal">
                            {p.detail.candidateName_bg}
                          </th>
                          <td className="p-2">
                            {p.detail.support.toFixed(1)}%
                          </td>
                          <td className="p-2">{p.question.base.label[lang]}</td>
                          <td className="p-2">
                            {p.poll.publishedAt ?? t("pp_history_unknown")}
                          </td>
                          <td className="p-2">
                            <a
                              className="underline text-primary"
                              href={p.poll.source}
                            >
                              {p.poll.agencyId}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
          {comparisons.map((c) => (
            <div key={c.cycle} className="space-y-2">
              <h3 className="font-semibold">
                {c.cycle.slice(0, 4)} · {t("pp_history_round")} {round}
              </h3>
              <PresidentialResultComparisons
                accuracy={c}
                polls={polls}
                round={round}
                agencyId={agencyId ?? (validAgency || undefined)}
              />
            </div>
          ))}
          <PresidentialInsights
            polls={polls}
            historyPolls={allPolls.filter(
              (p) => !validAgency || p.agencyId === validAgency,
            )}
            details={dq.data ?? []}
            runoffs={rq.data ?? []}
            accuracy={aq.data ?? { generatedAt: "", cycles: [] }}
            round={round}
            candidate={validCandidate}
          />
          <details open={!!agencyId}>
            <summary className="cursor-pointer font-semibold">
              {t("pp_history_surveys")} (
              {
                polls.filter((p) =>
                  p.questions?.some(
                    (q) => q.round === round || q.round === null,
                  ),
                ).length
              }
              )
            </summary>
            <div className="mt-3">
              <AgencyPresidentialPollsList
                round={round}
                polls={polls.filter(
                  (p) =>
                    !p.questions ||
                    p.questions.some(
                      (q) => q.round === round || q.round === null,
                    ),
                )}
                details={dq.data ?? []}
                runoffs={rq.data ?? []}
              />
            </div>
          </details>
        </>
      )}
      <PresidentialCoveragePanel
        polls={allPolls.filter(
          (p) => !validAgency || p.agencyId === validAgency,
        )}
        agencyId={agencyId ?? (validAgency || undefined)}
        cycle={cycleValue || undefined}
      />
    </div>
  );
}
