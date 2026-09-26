import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type {
  Poll,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  Runoff,
} from "@/data/polls/pollsTypes";
import {
  candidateMargins,
  exportCsv,
  matchupObservations,
  pollExport,
  residualObservations,
} from "@/data/presidential/pollInsights";
import { campaignObservations } from "@/data/presidential/pollHistory";
import { usePresidentialCoverage } from "@/data/presidential/usePresidentialPolls";

function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <caption className="text-left font-medium py-2">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th scope="col" key={i} className="p-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className="p-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function TimePoints({
  points,
}: {
  points: { date: string; share: number; series: string; label: string }[];
}) {
  const groups = [...new Set(points.map((p) => p.series))];
  if (!points.length) return null;
  return (
    <div aria-hidden="true" className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin - 86400000", "dataMax + 86400000"]}
            tickFormatter={(v) => new Date(v).toISOString().slice(0, 10)}
          />
          <YAxis dataKey="share" type="number" unit="%" />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="bg-background border rounded p-2 text-sm">
                  {payload[0].payload.label}: {payload[0].payload.share}%
                </div>
              ) : null
            }
          />
          {groups.map((g, i) => (
            <Scatter
              key={g}
              data={points
                .filter((p) => p.series === g)
                .map((p) => ({ ...p, time: Date.parse(p.date) }))}
              fill={`hsl(${(i * 137.5) % 360} 65% 40%)`}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PresidentialInsights({
  polls,
  historyPolls,
  details,
  runoffs,
  accuracy,
  round,
  candidate,
}: {
  polls: Poll[];
  historyPolls: Poll[];
  details: PresidentialPollDetail[];
  runoffs: Runoff[];
  accuracy: PresidentialPollsAccuracy;
  round: 1 | 2;
  candidate: string;
}) {
  const { t, i18n } = useTranslation(),
    lang = i18n.language === "bg" ? "bg" : "en";
  const [params, setParams] = useSearchParams();
  const keys = [
    ...new Map(
      campaignObservations(polls, details, round).map((p) => [
        p.detail.candidateKey,
        p.detail.candidateName_bg,
      ]),
    ).entries(),
  ];
  const rawCompare = params.get("pollCompare") ?? "";
  const compare =
    keys.some(([id]) => id === rawCompare) && rawCompare !== candidate
      ? rawCompare
      : "";
  const margins = candidateMargins(polls, details, round, candidate, compare);
  const residuals = residualObservations(polls, round);
  const pairs = matchupObservations(polls, details, runoffs, accuracy, round);
  const gradeRows = accuracy.cycles.flatMap((c) =>
    (c.rounds ?? [])
      .filter((r) => r.round === round)
      .flatMap((r) =>
        r.comparisons
          .filter((a) => historyPolls.some((p) => p.id === a.pollId))
          .map((a) => ({ cycle: c.cycle, ...a })),
      ),
  );
  const gradeGroups = [...new Set(historyPolls.map((p) => p.agencyId))]
    .sort()
    .flatMap((id) =>
      [true, false].map((includesNone) => ({
        id,
        includesNone,
        rows: gradeRows.filter(
          (r) =>
            r.agencyId === id &&
            r.includesNone === includesNone &&
            r.mae !== null,
        ),
      })),
    )
    .filter((g) => g.rows.length);
  const exportData = pollExport(
    polls,
    details,
    runoffs,
    accuracy,
    round,
    candidate,
  );
  const labelCode = (code: string, q: (typeof residuals)[number]["question"]) =>
    q.answerScale.find((a) => a.code === code)?.label[lang] ??
    t(`pp_residual_${code}`);
  const questionContext = (r: (typeof residuals)[number]) => {
    const pair = pairs.find(
      (p) => p.poll.id === r.poll.id && p.question.id === r.question.id,
    );
    return pair ? pair.a + " / " + pair.b : r.question.wording[lang];
  };
  const source = (p: Poll) => (
    <a className="text-primary underline" href={p.source}>
      {p.agencyId} · {p.fieldwork}
    </a>
  );
  const columns = (items: string[]) =>
    items.map((k) => t(k.startsWith("pp_") ? k : `pp_history_${k}`));
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-semibold">{t("pp_insight_accuracy")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("pp_insight_accuracy_hint")}
        </p>
        {!gradeGroups.length ? (
          <p>{t("pp_insight_no_grades")}</p>
        ) : (
          gradeGroups.map((g) => (
            <div key={g.id + g.includesNone}>
              <p>
                {g.id} ·{" "}
                {t(
                  g.includesNone
                    ? "pp_history_with_none"
                    : "pp_history_without_none",
                )}{" "}
                · {t("pp_insight_scored_count", { count: g.rows.length })}
              </p>
              <DataTable
                caption={t("pp_insight_accuracy")}
                columns={columns([
                  "cycle",
                  "date",
                  "pp_insight_distance",
                  "pp_insight_mae",
                ])}
                rows={g.rows.map((r) => [
                  <Link
                    to={`/presidential/${r.cycle}?pollRound=${round}`}
                    className="underline text-primary"
                  >
                    {r.cycle.slice(0, 4)}
                  </Link>,
                  r.fieldworkEnd,
                  r.daysBefore,
                  r.mae!.toFixed(2),
                ])}
              />
            </div>
          ))
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("pp_insight_matchups")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("pp_insight_matchups_hint")}
        </p>
        {!pairs.length ? (
          <p>{t("pp_insight_no_matchups")}</p>
        ) : (
          <DataTable
            caption={t("pp_insight_matchups")}
            columns={columns([
              "date",
              "pp_insight_kind",
              "candidate",
              "share",
              "pp_insight_margin",
              "base",
              "pp_residual_undecided",
              "pp_residual_wontVote",
              "pp_insight_none",
            ])}
            rows={pairs.map((r) => [
              source(r.poll),
              t(`pp_insight_${r.kind}`),
              r.a + " / " + r.b,
              `${r.pair.supportA.toFixed(1)}% / ${r.pair.supportB.toFixed(1)}%`,
              `${r.margin > 0 ? "+" : ""}${r.margin.toFixed(1)} ${t("pp_history_pp")}`,
              r.question.base.label[lang],
              r.pair.residual?.undecided == null
                ? "—"
                : r.pair.residual.undecided + "%",
              r.pair.residual?.wontVote == null
                ? "—"
                : r.pair.residual.wontVote + "%",
              r.none == null ? "—" : r.none.toFixed(1) + "%",
            ])}
          />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("pp_insight_residuals")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("pp_insight_residual_hint")}
        </p>
        {!residuals.length ? (
          <p>{t("pp_insight_no_residuals")}</p>
        ) : (
          <>
            <TimePoints
              points={residuals.map((r) => ({
                date: r.date,
                share: r.share,
                series: r.series,
                label: `${r.poll.agencyId} · ${r.date} · ${questionContext(r)} · ${labelCode(r.code, r.question)} · ${r.question.base.label[lang]}`,
              }))}
            />
            <DataTable
              caption={t("pp_insight_residuals")}
              columns={columns([
                "date",
                "pp_insight_question",
                "pp_history_answer",
                "share",
                "base",
              ])}
              rows={residuals.map((r) => [
                source(r.poll),
                questionContext(r),
                labelCode(r.code, r.question),
                r.share.toFixed(1) + "%",
                r.question.base.label[lang],
              ])}
            />
          </>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("pp_insight_compare")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("pp_insight_compare_hint")}
        </p>
        <label className="flex flex-col gap-1 text-sm">
          {t("pp_insight_compare_with")}
          <select
            className="rounded border bg-background p-2 max-w-sm"
            value={compare}
            onChange={(e) =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (e.target.value) next.set("pollCompare", e.target.value);
                  else next.delete("pollCompare");
                  return next;
                },
                { replace: true },
              )
            }
          >
            <option value="">{t("pp_insight_choose")}</option>
            {keys
              .filter(([id]) => id !== candidate)
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        {!margins.length ? (
          <p>{t("pp_insight_no_comparison")}</p>
        ) : (
          <DataTable
            caption={t("pp_insight_compare")}
            columns={columns([
              "date",
              "candidate",
              "share",
              "pp_insight_margin",
              "base",
            ])}
            rows={margins.map((r) => [
              source(r.poll),
              r.a.candidateName_bg + " / " + r.b.candidateName_bg,
              `${r.a.support.toFixed(1)}% / ${r.b.support.toFixed(1)}%`,
              `${r.margin > 0 ? "+" : ""}${r.margin.toFixed(1)} ${t("pp_history_pp")}`,
              r.question.base.label[lang],
            ])}
          />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">{t("pp_insight_downloads")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("pp_insight_download_hint")}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            className="rounded border px-3 py-2 hover:bg-muted"
            onClick={() =>
              download(
                "presidential-polls.json",
                JSON.stringify(exportData, null, 2),
                "application/json",
              )
            }
          >
            JSON
          </button>
          <button
            className="rounded border px-3 py-2 hover:bg-muted"
            onClick={() =>
              download(
                "presidential-polls.csv",
                "\uFEFF" + exportCsv(exportData),
                "text/csv;charset=utf-8",
              )
            }
          >
            CSV
          </button>
          <a
            className="underline text-primary py-2"
            href={"?" + params.toString()}
          >
            {t("pp_insight_permalink")}
          </a>
        </div>
      </section>
    </div>
  );
}
export function PresidentialCoveragePanel({
  polls,
  agencyId,
  cycle,
}: {
  polls: Poll[];
  agencyId?: string;
  cycle?: string;
}) {
  const { t, i18n } = useTranslation();
  const query = usePresidentialCoverage();
  if (query.isPending) return <p role="status">{t("pp_history_loading")}</p>;
  if (query.isError)
    return (
      <div role="alert">
        {t("pp_history_load_error")}{" "}
        <button
          onClick={() => {
            void query.refetch();
          }}
          className="underline"
        >
          {t("pp_history_retry")}
        </button>
      </div>
    );
  const coverage = query.data;
  const rows =
    coverage?.agencies.filter((a) => !agencyId || a.agencyId === agencyId) ??
    [];
  const corrected = polls.filter((p) => p.locked?.supersedes);
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer font-semibold">
        {t("pp_insight_coverage")}
      </summary>
      <p className="my-2 text-sm">
        {t("pp_insight_reviewed")}: {coverage?.reviewedAt ?? "—"}.{" "}
        {t("pp_insight_coverage_hint")}
      </p>
      <DataTable
        caption={t("pp_insight_coverage")}
        columns={[
          t("polls_agency"),
          t("pp_insight_checked"),
          t("pp_insight_accepted"),
          t("pp_insight_date_range"),
          t("pp_insight_review_count"),
          t("pp_insight_metadata_gaps"),
          t("pp_insight_status"),
        ]}
        rows={rows.map((a) => [
          a.agencyId,
          a.lastChecked?.slice(0, 10) ?? "—",
          cycle === "unassigned"
            ? polls.filter((p) => p.agencyId === a.agencyId && p.cycle == null)
                .length
            : cycle
              ? (a.cycles.find((c) => String(c.year) === cycle.slice(0, 4))
                  ?.accepted ?? 0)
              : a.accepted,
          a.from ? `${a.from} – ${a.to}` : "—",
          a.reviewedPublications,
          a.missingMetadata,
          t(
            a.unavailable
              ? "pp_insight_unavailable"
              : a.reviewedPublications
                ? "pp_insight_partial"
                : "pp_insight_unreviewed",
          ),
        ])}
      />
      <p className="text-sm mt-2">{t("pp_insight_2001_gap")}</p>
      <h4 className="font-medium mt-4">{t("pp_insight_corrections")}</h4>
      {!corrected.length ? (
        <p className="text-sm">{t("pp_insight_no_corrections")}</p>
      ) : (
        corrected.map((p) => (
          <details key={p.id} className="my-2">
            <summary className="cursor-pointer">
              {p.agencyId} · {p.fieldwork} · {p.locked!.lockedAt}
            </summary>
            <p className="text-sm">{t("pp_insight_correction_hint")}</p>
            <DataTable
              caption={t("pp_insight_previous")}
              columns={[
                t("pp_history_candidate"),
                t("pp_history_answer"),
                t("pp_history_share"),
              ]}
              rows={p.locked!.supersedes!.details.map((d) => [
                "candidateName_bg" in d ? d.candidateName_bg : d.nickName_bg,
                p
                  .locked!.supersedes!.poll.questions?.find(
                    (q) => q.id === d.questionId,
                  )
                  ?.answerScale.find((a) => a.code === d.answerCode)?.label[
                  i18n.language === "bg" ? "bg" : "en"
                ] ?? "—",
                d.support.toFixed(1) + "%",
              ])}
            />
          </details>
        ))
      )}
    </details>
  );
}
