// T4.4 — one identity's page on the NEWS origin (`/person/:newsPersonId`),
// separate from naiasno.bg's `/person/:slug`.
//
// ⚠️ THE ACCOUNTING IS THE PAGE. Every figure states its basis: N assessed
// of M eligible target/article pairs, the mutually exclusive unassessed
// categories beside it, the incidental mentions OUTSIDE M, the distinct
// outlets, the date window and the rubric. A reader can add the numbers up;
// no percentage is offered in place of them.
//
// ⚠️ This is not a profile of a person. It is an archive of how articles
// present them. The policy (`docs/policies/news-person-pages.md`, version
// `news-person-policy-v1`) governs who gets a page at all and how one is
// removed, and the footer LINKS it — a reader on the page a policy governs
// can reach that policy in one click.

import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNewsPerson, useNewsPersons } from "../data";
import { isNewsPersonId } from "../newsPersonId";
import { formatDate, media as mediaLabel, toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { ToneBar } from "../components/ToneBar";
import { correctionIssueUrl } from "../corrections";
import { mainSiteUrl } from "../site";

/** The main site's own slug charset. A slug is a human-typed registry field
 * that reaches a URL path, so one that fails this takes the „no verified
 * link" branch — that is the safe reading of „we cannot serve this". */
const MAIN_SITE_SLUG_SAFE = /^[a-z0-9-]{1,120}$/;

export const POLICY_HREF = "/methodology#person-pages";

export const NEWS_PERSON_POLICY_VERSION = "news-person-policy-v1";

export const NewsPersonScreen = () => {
  const { newsPersonId: personId } = useParams<{ newsPersonId: string }>();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const { language, tr } = useNewsLocale();
  const person = useNewsPerson(personId, page);
  // A merged identity keeps its old URL working: the index carries the
  // retirement map, which is what policy §5 promises.
  const index = useNewsPersons();
  const missing = !isNewsPersonId(personId) || (person.error && !person.data);
  const redirect =
    missing && personId ? index.data?.retired_ids?.[personId] : undefined;
  if (redirect && isNewsPersonId(redirect))
    return <Navigate replace to={`/person/${redirect}`} />;

  if (missing && !(index.loading && personId)) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Лицето не е намерено", "Person not found")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "Страница има само самоличност, която човек е прегледал и е отбелязал като активна. Споменаването не създава страница.",
            "Only an identity a human has reviewed and marked active has a page. A mention does not create one.",
          )}
        </p>
      </Card>
    );
  }
  if (!person.data) return <Skeleton className="h-40 rounded-xl" />;
  const p = person.data;
  const name = (language === "en" ? p.name_en : p.name_bg) ?? p.news_person_id;
  const disambiguation =
    language === "en" ? p.disambiguation_en : p.disambiguation_bg;
  const eligible = p.eligible;
  return (
    <div className="space-y-5">
      <header className="border-b pb-4">
        <p className="app-eyebrow mb-2">
          {tr("Как медиите го представят", "How the media present them")}
        </p>
        <h1 className="app-page-title">{name}</h1>
        {disambiguation ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {disambiguation}
          </p>
        ) : null}
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {tr(
            "Това е архив на материалите, които го споменават, и на това как всеки от тях го представя. Оценява се ТЕКСТЪТ на изданието — не човекът, неговото поведение или вина. Фактическото съобщаване за обвинение или разследване е неутрално.",
            "This is an archive of the articles that mention them and of how each presents them. What is assessed is the OUTLET'S TEXT — not the person, their conduct or their guilt. Factual reporting of an accusation or an investigation is neutral.",
          )}
        </p>
      </header>

      <Card className="p-4" data-testid="person-accounting">
        <h2 className="sr-only">{tr("Отчет", "The accounting")}</h2>
        <ToneBar counts={p.counts} total={p.assessed} />
        <p className="mt-2 text-sm">
          {tr(
            `Оценени ${p.assessed} от ${eligible} двойки (лице, материал)`,
            `${p.assessed} assessed of ${eligible} (person, article) pairs`,
          )}
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {p.partial_scope > 0 ? (
            <li>
              {tr(
                `${p.partial_scope} без преценка, защото материалът не е прочетен изцяло`,
                `${p.partial_scope} with no judgement because the article was not read in full`,
              )}
            </li>
          ) : null}
          {p.insufficient_text - p.partial_scope > 0 ? (
            <li>
              {tr(
                `${p.insufficient_text - p.partial_scope} без преценка, защото в текста няма достатъчно за оценка`,
                `${p.insufficient_text - p.partial_scope} with no judgement because the text carries too little to assess`,
              )}
            </li>
          ) : null}
          <li>
            {tr(
              `${p.pending} още не са оценявани`,
              `${p.pending} not yet assessed`,
            )}
          </li>
          <li>
            {tr(
              `${p.refused} без достатъчно доказателство в текста`,
              `${p.refused} without sufficient evidence in the text`,
            )}
          </li>
          <li>
            {tr(
              `${p.incidental} споменавания мимоходом — извън знаменателя`,
              `${p.incidental} incidental mentions — outside the denominator`,
            )}
          </li>
          {p.unreadable_role > 0 ? (
            <li>
              {tr(
                `${p.unreadable_role} записа с непрочетена роля — извън знаменателя`,
                `${p.unreadable_role} records with an unreadable role — outside the denominator`,
              )}
            </li>
          ) : null}
          <li>
            {mediaLabel(p.outlet_count, language)}
            {" · "}
            {tr(
              `${p.story_count} събития`,
              `${p.story_count} ${p.story_count === 1 ? "event" : "events"}`,
            )}
            {" · "}
            {p.first_published
              ? `${formatDate(p.first_published, language)} – ${formatDate(p.last_published, language)}`
              : tr("без дати", "no dates")}
          </li>
          {p.undated > 0 ? (
            <li data-testid="person-undated">
              {tr(
                `${p.undated} материала без дата — извън прозореца по-горе.`,
                `${p.undated} articles carry no date — outside the window above.`,
              )}
            </li>
          ) : null}
          {p.same_headline_copies > 0 ? (
            <li data-testid="person-dedup">
              {tr(
                `${p.same_headline_copies} от тях са същото заглавие в друга медия; без тях знаменателят е ${p.eligible_deduplicated}.`,
                `${p.same_headline_copies} of them are the same headline in another outlet; without them the denominator is ${p.eligible_deduplicated}.`,
              )}
            </li>
          ) : null}
        </ul>
      </Card>

      {p.per_outlet.length > 1 ? (
        <Card className="p-4" data-testid="person-per-outlet">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tr("По издание", "By outlet")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "Всяко издание със собственото си разпределение — не един приписан тон на медия.",
              "Each outlet with its own distribution — never one inferred tone per outlet.",
            )}
          </p>
          <ul className="mt-2 space-y-2">
            {p.per_outlet.map((o) => (
              <li key={o.domain}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <Link
                    to={`/outlet/${o.domain}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {o.domain}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {tr(
                      `${o.assessed} оценени от ${o.eligible}`,
                      `${o.assessed} assessed of ${o.eligible}`,
                    )}
                  </span>
                </div>
                <ToneBar counts={o.counts} total={o.assessed} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="divide-y p-0">
        <h2 className="sr-only">{tr("Материали", "Articles")}</h2>
        {p.articles.map((row) => {
          // ⚠️ Status and tone are ONE decision. A tone arriving beside any
          // other status, or on a row outside M, is a claim the accounting
          // never counted — the producer drops it, and this side refuses it
          // again rather than depending on the producer having done so.
          const meta =
            row.eligible && row.assessment_status === "assessed" && row.tone
              ? toneMeta(row.tone, language)
              : null;
          return (
            <article
              key={`${row.domain}/${row.article_id ?? row.url ?? row.title}`}
              className="px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className={meta?.className ?? "text-muted-foreground"}>
                  {meta
                    ? tr(
                        `представяне в материала: ${meta.label}`,
                        `presentation in the article: ${meta.label}`,
                      )
                    : row.eligible
                      ? row.assessment_status === "insufficient_text"
                        ? tr(
                            "материалът не е прочетен изцяло — няма преценка",
                            "the article was not read in full — no judgement",
                          )
                        : row.assessment_status === "pending"
                          ? tr("още не е оценяван", "not yet assessed")
                          : tr("няма преценка", "no judgement")
                      : tr(
                          "само споменаване — без наложена оценка",
                          "mentioned in passing — no forced sentiment",
                        )}
                </span>
                <span className="text-muted-foreground">
                  {row.subject_role === "primary"
                    ? tr("основен участник", "main participant")
                    : row.subject_role === "secondary"
                      ? tr("споменат участник", "named participant")
                      : null}
                  {row.subject_role === "primary" ||
                  row.subject_role === "secondary"
                    ? " · "
                    : ""}
                  {row.domain} ·{" "}
                  {row.published
                    ? formatDate(row.published, language)
                    : tr("без дата", "no date")}
                </span>
              </div>
              {row.article_id ? (
                <Link
                  to={`/article/${row.domain}/${row.article_id}`}
                  className="mt-0.5 block font-medium leading-snug underline-offset-4 hover:underline"
                >
                  {row.title ?? tr("Без заглавие", "Untitled")}
                </Link>
              ) : (
                <p className="mt-0.5 font-medium leading-snug">
                  {row.title ?? tr("Без заглавие", "Untitled")}
                </p>
              )}
              {row.rationale ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.rationale}
                </p>
              ) : null}
              {row.evidence_spans.length ? (
                <ul className="mt-1 space-y-0.5">
                  {row.evidence_spans.map((span, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {span.located === false ? (
                        <>
                          <s>
                            <q lang="bg">{span.quote}</q>
                          </s>{" "}
                          (
                          {tr("не е намерен в текста", "not found in the text")}
                          )
                        </>
                      ) : (
                        <q lang="bg">{span.quote}</q>
                      )}{" "}
                      {span.voice === "quoted_speaker"
                        ? `(${tr("цитиран", "quoted")}${span.speaker ? `: ${span.speaker}` : ""})`
                        : span.voice === "journalist"
                          ? `(${tr("авторски текст", "journalist")})`
                          : `(${tr("неясен глас", "unclear voice")})`}
                    </li>
                  ))}
                </ul>
              ) : null}
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
                >
                  {tr("оригиналът", "the original")} ↗
                </a>
              ) : null}
            </article>
          );
        })}
      </Card>

      {p.total_pages > 1 ? (
        <nav
          className="flex items-center justify-between text-sm"
          data-testid="person-pages"
          aria-label={tr("Страници", "Pages")}
        >
          <button
            type="button"
            className="underline-offset-4 hover:underline disabled:opacity-40"
            disabled={p.page <= 1}
            onClick={() => setParams({ page: String(p.page - 1) })}
          >
            {tr("По-нови", "Newer")}
          </button>
          <span className="text-xs text-muted-foreground">
            {tr(
              `Страница ${p.page} от ${p.total_pages} · всички ${eligible} двойки са в отчета по-горе`,
              `Page ${p.page} of ${p.total_pages} · all ${eligible} pairs are in the accounting above`,
            )}
          </span>
          <button
            type="button"
            className="underline-offset-4 hover:underline disabled:opacity-40"
            disabled={p.page >= p.total_pages}
            onClick={() => setParams({ page: String(p.page + 1) })}
          >
            {tr("По-стари", "Older")}
          </button>
        </nav>
      ) : null}

      <Card className="p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          {tr("Рубрика", "Rubric")}: {p.rubric_version}
          {p.identity_version
            ? ` · ${tr("самоличност", "identity")}: ${p.identity_version}`
            : ""}
          {p.reviewed_by
            ? ` · ${tr("прегледал", "reviewed by")}: ${p.reviewed_by}`
            : ""}
          {p.reviewed_at ? ` (${formatDate(p.reviewed_at, language)})` : ""} ·{" "}
          {tr("политика", "policy")}:{" "}
          <Link to={POLICY_HREF} className="underline underline-offset-4">
            {NEWS_PERSON_POLICY_VERSION}
          </Link>
        </p>
        <p className="mt-1">
          <a
            href={correctionIssueUrl(`/person/${p.news_person_id}`)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-4"
          >
            {tr(
              "Сигнал за поправка за това лице",
              "Report a correction for this person",
            )}{" "}
            ↗
          </a>{" "}
          {tr(
            "— носи идентификатора на самоличността и версията на рубриката.",
            "— carries the identity id and the rubric version.",
          )}
        </p>
        {MAIN_SITE_SLUG_SAFE.test(p.verified_main_site_slug ?? "") ? (
          <p className="mt-1">
            <a
              href={mainSiteUrl(
                `https://naiasno.bg/person/${p.verified_main_site_slug}`,
                language === "en",
              )}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-4"
            >
              {tr("Профил в Наясно", "Profile on Naiasno")} ↗
            </a>
          </p>
        ) : (
          <p className="mt-1">
            {tr(
              "Няма проверена връзка към профил в основния сайт — затова не показваме такава.",
              "There is no verified link to a main-site profile, so none is shown.",
            )}
          </p>
        )}
      </Card>
    </div>
  );
};
