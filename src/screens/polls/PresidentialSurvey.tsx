import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
  Poll,
  PresidentialPollDetail,
  Runoff,
} from "@/data/polls/pollsTypes";
import { localizeFieldwork } from "@/data/polls/fieldwork";
import { PresidentialPersonName } from "@/screens/presidential/PresidentialPersonName";
import { isNamedCandidateRow } from "@/data/polls/presidentialRow";

export function PresidentialSurvey({
  poll: p,
  details,
  runoffs,
  round,
}: {
  poll: Poll;
  details: PresidentialPollDetail[];
  runoffs: Runoff[];
  round?: 1 | 2;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const rows = details.filter((d) => d.pollId === p.id);
  const pairs = runoffs.filter((r) => r.pollId === p.id);
  // Legacy rows remain visible as an explicitly undocumented question.
  const blocks = p.questions?.length
    ? p.questions.filter((q) => !round || q.round === round || q.round === null)
    : [null];
  return (
    <article
      id={p.id}
      className="rounded-lg border bg-card p-4 space-y-3 min-w-0"
    >
      <header className="flex flex-wrap gap-x-4 gap-y-2 items-baseline">
        <h3 className="font-semibold">
          {p.agencyId} · {localizeFieldwork(p.fieldwork, lang === "bg")}
        </h3>
        {p.cycle && (
          <Link
            className="text-primary underline"
            to={`/presidential/${p.cycle}`}
          >
            {p.cycle.slice(0, 4)}
          </Link>
        )}
        {p.source && (
          <a
            className="text-primary underline"
            href={p.source}
            target="_blank"
            rel="noreferrer"
          >
            {t("polls_source")}
          </a>
        )}
      </header>
      <p className="text-sm text-muted-foreground">
        {p.methodology[lang]} · n={p.respondents ?? "—"} ·{" "}
        {t("pp_history_published")}: {p.publishedAt ?? t("pp_history_unknown")}{" "}
        · {t("pp_history_sponsor")}:{" "}
        {p.sponsor?.[lang] ?? t("pp_history_unknown")}
      </p>
      {blocks.map((q) => (
        <section
          key={q?.id ?? "legacy"}
          className="border-t pt-3 space-y-2"
          aria-label={q?.wording[lang] ?? t("pp_history_undocumented")}
        >
          <h4 className="font-medium">
            {q?.wording[lang] ?? t("pp_history_undocumented")}
          </h4>
          {q && (
            <p className="text-sm text-muted-foreground">
              {t(`pp_measure_${q.measure}`)} · {t(`pp_genre_${q.genre}`)} ·{" "}
              {t("pp_history_round")} {q.round ?? "—"} · {q.base.label[lang]} ·
              n=
              {q.base.respondents ?? t("pp_history_unknown")}
              {" · "}
              {t(
                q.base.includesNone === true
                  ? "pp_history_with_none"
                  : q.base.includesNone === false
                    ? "pp_history_without_none"
                    : "pp_history_none_unknown",
              )}
              {q.scenario && (
                <>
                  {" "}
                  · {t("pp_history_hypothetical")}: {q.scenario}
                </>
              )}
            </p>
          )}
          {q && !q.scoring.eligible && (
            <p className="text-sm">
              {t("pp_history_not_scored")}: {t(`pp_measure_${q.measure}`)} ·{" "}
              {t(`pp_genre_${q.genre}`)} · {q.base.label[lang]}.{" "}
              {t("pp_history_eligibility_hint")}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <caption className="sr-only">
                {q?.wording[lang] ?? t("pp_history_undocumented")}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="p-2">
                    {t("pp_history_candidate")}
                  </th>
                  <th scope="col" className="p-2">
                    {t("pp_history_answer")}
                  </th>
                  <th scope="col" className="p-2 text-right">
                    {t("pp_history_share")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((d) => (q ? d.questionId === q.id : !d.questionId))
                  .map((d) => (
                    <tr
                      key={`${d.questionId}-${d.candidateKey}-${d.answerCode}`}
                      className="border-t"
                    >
                      <td className="p-2">
                        {isNamedCandidateRow(d) ? (
                          <PresidentialPersonName name={d.candidateName_bg} />
                        ) : (
                          d.candidateName_bg
                        )}
                      </td>
                      <td className="p-2">
                        {q?.answerScale.find((a) => a.code === d.answerCode)
                          ?.label[lang] ?? "—"}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {d.support.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {pairs
            .filter((r) => (q ? r.questionId === q.id : !r.questionId))
            .map((r) => (
              <p key={`${r.a}-${r.b}`} className="text-sm">
                {r.aName_bg ??
                  rows.find((d) => d.candidateKey === r.a)?.candidateName_bg ??
                  r.a}
                : {r.supportA.toFixed(1)}% /{" "}
                {r.bName_bg ??
                  rows.find((d) => d.candidateKey === r.b)?.candidateName_bg ??
                  r.b}
                : {r.supportB.toFixed(1)}%
              </p>
            ))}
          {q?.residual && (
            <p className="text-sm text-muted-foreground">
              {(
                ["undecided", "wontVote", "wontSay", "otherNamedMinor"] as const
              )
                .filter((k) => q.residual?.[k] != null)
                .map((k) => `${t(`pp_residual_${k}`)}: ${q.residual![k]}%`)
                .join(" · ")}
            </p>
          )}
          {q && (
            <details className="text-sm">
              <summary className="cursor-pointer">
                {t("pp_history_evidence")}
              </summary>
              <blockquote className="mt-2 whitespace-pre-wrap">
                {q.evidence.quote}
              </blockquote>
              <a className="underline text-primary" href={q.evidence.url}>
                {q.evidence.locator ?? t("polls_source")}
              </a>
              {!q.scoring.eligible && <p>{q.scoring.reason}</p>}
            </details>
          )}
        </section>
      ))}
    </article>
  );
}
