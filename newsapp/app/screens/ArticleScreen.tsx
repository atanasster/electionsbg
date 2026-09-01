// One article's reading — the most consequential screen in the app.
//
// ⚠️ THIS PAGE PUBLISHES A JUDGMENT ABOUT A NAMED OUTLET'S SPECIFIC PIECE OF
// WORK. Four rules follow from that, and each is load-bearing rather than
// stylistic:
//
//   1. EVIDENCE SITS BESIDE THE LABEL, never behind a tooltip or a
//      disclosure. Each axis renders the quoted Bulgarian sentence the rubric
//      cited and the confidence it carried. This is the one thing no
//      competitor does — Ground News, AllSides and Improve The News all rate
//      the OUTLET and attribute that rating to every article it publishes —
//      and hiding it would waste the only thing that makes an article-level
//      claim checkable in ten seconds.
//   2. THE OUTBOUND LINK IS A CARD, not a footnote. We publish a reading; the
//      outlet publishes the article. Making that traffic obvious is both the
//      ethical position and what keeps outlets tolerant of being measured.
//   3. THE MODEL AND THE DATE ARE PRINTED. A judgment with no attribution is
//      not checkable, and the model will change.
//   4. THE UNANALYSED STATE MATTERS MORE THAN THE ANALYSED ONE. 8.4% of the
//      corpus is analysed, so "not yet judged" is the common case — and it
//      must never read as "judged neutral". That is why an unanalysed article
//      renders NO badges at all rather than empty ones.

import { Link, useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AI_META,
  AI_META_EN,
  LEANING_META,
  LEANING_META_EN,
  QUALITY_META,
  QUALITY_META_EN,
  RUSSIA_META,
  RUSSIA_META_EN,
  formatDateTime,
  media,
  relativeTime,
} from "../labels";
import {
  useOutletArticles,
  useOutlets,
  useStories,
  useTaxonomy,
  type AnalysisBlock,
  type ArticleRecord,
  type Outlet,
  type EntityLink,
  isPublicHumanReview,
} from "../data";
import { ArticleImage } from "../components/ArticleImage";
import { EntityChips } from "../components/EntityChips";
import { TopicChips } from "../components/TopicChips";
import { SummaryPair } from "../components/SummaryPair";
import { StoryMemberRow } from "../components/ArticleRow";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ReaderActions } from "../components/ReaderActions";
import { ReportIssueLink } from "../components/ReportIssueLink";
import { ArticleContributionCard } from "../components/ArticleContributionCard";
import { emitNewsEvent } from "../analytics";
import { evalTaskPath, useEvalQueue } from "../evals";
import { useNewsLocale } from "../i18n";

/**
 * One axis: its label, its verdict, its confidence, and the evidence text the
 * rubric returned (which may be a quote OR a concrete paraphrase).
 *
 * ⚠️ Renders even when `evidence` is empty — with the absence stated. A
 * verdict whose justification silently vanishes is exactly the unsupported
 * claim this page exists to avoid making.
 */
const AxisCard = ({
  title,
  verdict,
  color,
  confidence,
  evidence,
  source = "model",
}: {
  title: string;
  verdict: string;
  color: string;
  confidence: number | null | undefined;
  evidence: string | null | undefined;
  source?: "model" | "editorial";
}) => {
  const { isEnglish, tr } = useNewsLocale();
  const confidencePct =
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
      ? Math.round(confidence * 100)
      : null;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {confidencePct !== null ? (
          <span
            className="text-xs text-muted-foreground"
            aria-label={tr(
              `Увереност на модела: ${confidencePct} процента`,
              `Model confidence: ${confidencePct} percent`,
            )}
          >
            {tr("увереност", "confidence")} {confidencePct}%
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-2.5 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <p className="font-title text-lg">{verdict}</p>
      </div>
      {evidence && !isEnglish ? (
        <div className="mt-3 border-l-2 border-primary pl-3 text-sm text-foreground/90">
          <p>{evidence}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {source === "editorial"
              ? "Обосновка от редакционната проверка — може да е цитат или перифраза"
              : "Обосновка, посочена от модела — може да е цитат или перифраза"}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {isEnglish && evidence
            ? "The supporting evidence is currently available only in Bulgarian and is not mixed into the English page."
            : source === "editorial"
              ? tr(
                  "Редакционната проверка не е публикувала обосновка за тази оценка.",
                  "The editorial review did not publish a rationale for this rating.",
                )
              : tr(
                  "Моделът не е посочил обосновка за тази оценка.",
                  "The model did not provide a rationale for this rating.",
                )}
        </p>
      )}
    </Card>
  );
};

/**
 * A scale label and colour, tolerating a missing/value the app has never seen.
 *
 * ⚠️ The bundle passes rubric labels through VERBATIM, so an unrecognised one
 * is a JSON value away — and a bare `META[label].label` on an unknown key
 * throws, which in a component with no error boundary is a WHITE SCREEN for
 * the whole app. Badges.tsx already guards every one of these; this page did
 * not.
 */
const scaleOf = (
  meta: Record<string, { label: string; color: string }>,
  key: string | null | undefined,
  fallback = "Оценката не е налична",
): { verdict: string; color: string } => {
  const hit = key ? meta[key] : null;
  return hit
    ? { verdict: hit.label, color: hit.color }
    : { verdict: fallback, color: "#71717a" };
};

/** A label from a META record, or null when the app has never seen the key. */
const labelOf = (
  meta: Record<string, { label: string }>,
  key: string | null | undefined,
): string | null => (key ? (meta[key]?.label ?? null) : null);

const NotFound = ({ domain }: { domain: string }) => {
  const { tr } = useNewsLocale();
  return (
    <section className="py-8">
      <h1 className="font-title text-3xl">
        {tr("Статията не е намерена", "Article not found")}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {tr(
          "Няма такъв материал в корпуса.",
          "This article is not in the corpus.",
        )}{" "}
        <Link
          to={`/outlet/${domain}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {tr("Към страницата на изданието", "Go to the outlet page")}
        </Link>
        .
      </p>
    </section>
  );
};

export const ArticleScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const { domain = "", id = "" } = useParams();
  const bundle = useOutletArticles(domain || null);
  const outlets = useOutlets();
  const stories = useStories();
  const taxonomy = useTaxonomy();
  const evalQueue = useEvalQueue();

  if (bundle.error && !bundle.data) {
    return (
      <section className="py-8">
        <h1 className="font-title text-3xl">{tr("Статия", "Article")}</h1>
        <Card className="mt-4 p-4 text-sm text-destructive">
          {isEnglish
            ? "The article could not be loaded."
            : `Материалът не се зареди: ${bundle.error.message}`}
        </Card>
      </section>
    );
  }
  if (!bundle.data) {
    return (
      <section className="py-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-4 h-48" />
      </section>
    );
  }

  const article: ArticleRecord | undefined = bundle.data.articles.find(
    (a) => a.id === id,
  );
  if (!article) return <NotFound domain={domain} />;

  const outlet: Outlet | undefined = (outlets.data?.outlets ?? []).find(
    (o) => o.domain === domain,
  );
  const outletName = outlet?.outlet ?? bundle.data.outlet ?? domain;
  const analysis: AnalysisBlock | undefined = article.analysis;
  const story = (stories.data?.stories ?? []).find(
    (s) => s.id === article.story_id,
  );
  const siblings = (story?.members ?? []).filter(
    (m) => m.article_id !== article.id,
  );
  const categories = taxonomy.data?.categories ?? null;
  const hasAnalysisProvenance = Boolean(
    analysis?.model?.trim() && analysis.analyzed_at,
  );
  // The strict queue projection is the sole eligibility list. If it is
  // absent, loading, or invalid, the ordinary article page remains unchanged.
  const evalTask =
    !evalQueue.loading && !evalQueue.error
      ? evalQueue.data?.tasks.find(
          (task) => task.domain === domain && task.article_id === article.id,
        )
      : undefined;
  const reviewCandidate = analysis?.human_review;
  const humanReview =
    analysis &&
    reviewCandidate &&
    isPublicHumanReview(reviewCandidate, analysis)
      ? reviewCandidate
      : undefined;
  const acceptedReview = humanReview?.status === "accepted";
  const staleReview = humanReview?.status === "needs_revalidation";
  const leaningSource =
    acceptedReview && humanReview.fields.leaning !== "unable_to_judge"
      ? "editorial"
      : "model";
  const russiaSource =
    acceptedReview && humanReview.fields.russia_stance !== "unable_to_judge"
      ? "editorial"
      : "model";

  return (
    <article className="py-6">
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: tr("Източници", "Sources"), to: "/outlets" },
            { label: outletName, to: `/outlet/${domain}` },
            { label: tr("Материал", "Article") },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link
          to={`/outlet/${domain}`}
          className="font-semibold hover:text-primary"
        >
          {outletName}
        </Link>
        {outlet?.retired ? (
          <Badge
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            {tr("оттеглен източник", "retired source")}
          </Badge>
        ) : null}
        <span className="text-muted-foreground">·</span>
        <time
          className="text-muted-foreground"
          dateTime={article.published ?? undefined}
        >
          {article.published
            ? formatDateTime(article.published, language)
            : tr("без дата", "undated")}
        </time>
        {article.author ? (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{article.author}</span>
          </>
        ) : null}
        {/* A silent edit after publication is a fact about the material. */}
        {article.updated && article.updated !== article.published ? (
          <Badge
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            {tr("редактирана", "edited")}{" "}
            {relativeTime(article.updated, language)}
          </Badge>
        ) : null}
      </div>

      <h1 className="mt-3 max-w-4xl font-title text-3xl leading-tight">
        {article.title ?? tr("(без заглавие)", "(untitled)")}
      </h1>
      <ReaderActions
        path={`/article/${domain}/${article.id}`}
        title={article.title ?? tr("Наясно новини", "Naiasno News")}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ReportIssueLink path={`/article/${domain}/${id}`} />
        {evalTask ? (
          <Link
            to={evalTaskPath(evalTask)}
            aria-label={tr(
              "Помогнете да подобрим анализа — експериментално",
              "Help improve the analysis — experimental",
            )}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {tr("Помогнете да подобрим анализа", "Help improve the analysis")}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {tr("— експериментално", "— experimental")}
            </span>
          </Link>
        ) : (
          <Link
            to={`/evals/article/${encodeURIComponent(domain)}/${encodeURIComponent(id)}?mode=feedback`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {tr(
              "Допълнете анализа или връзките",
              "Suggest analysis or link improvements",
            )}
          </Link>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div>
          <ArticleImage
            image={article.image}
            imageAlt={article.image_alt}
            rights={article.image_rights}
            articleUrl={article.url}
            outlet={
              outlet ?? {
                domain,
                outlet: outletName,
                logo: null,
                hotlink_ok: null,
              }
            }
          />
        </div>
        <div className="space-y-3">
          {analysis ? (
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tr("Резюме", "Summary")}
              </div>
              <SummaryPair
                bg={analysis.summary_bg}
                en={analysis.summary_en}
                withheld={analysis.withheld}
                className="mt-2"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {tr(
                  "Генерирано резюме, не цитат от материала.",
                  "Generated summary, not a quotation from the article.",
                )}
              </p>
            </Card>
          ) : article.excerpt ? (
            <p className="text-foreground/90">{article.excerpt}</p>
          ) : null}

          {/* ⚠️ A CARD, not a footnote. We publish a reading; the outlet
              publishes the article. */}
          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                emitNewsEvent({ name: "source_open", surface: "article" })
              }
              className="flex items-center gap-3 rounded-md border border-primary p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="size-4 shrink-0 text-primary" />
              <span className="text-sm">
                <span className="font-semibold">
                  {tr("Прочети в", "Read at")} {outletName}
                </span>
                <span className="block text-muted-foreground">
                  {tr(
                    "Пълният текст остава при източника. Тук е само прочитът.",
                    "The full text remains with the publisher. This page contains only our analysis.",
                  )}
                </span>
              </span>
            </a>
          ) : null}
        </div>
      </div>

      {analysis ? (
        <section className="mt-8" aria-labelledby="article-analysis-heading">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--editorial-kicker))]">
                {hasAnalysisProvenance
                  ? tr("Проверима оценка", "Verifiable rating")
                  : tr(
                      "Непълна следа на анализа",
                      "Incomplete analysis record",
                    )}
              </p>
              <h2
                id="article-analysis-heading"
                className="mt-1 font-title text-2xl"
              >
                {tr("Нашият анализ", "Our analysis")}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {tr("Анализирано", "Analyzed")}{" "}
              {analysis.analyzed_at
                ? formatDateTime(analysis.analyzed_at, language)
                : tr("без дата", "undated")}
              {analysis.model
                ? ` · ${tr("модел", "model")} ${analysis.model}`
                : tr(" · моделът не е записан", " · model not recorded")}{" "}
              ·{" "}
              <Link
                to="/methodology"
                className="font-medium text-primary underline underline-offset-4"
              >
                {tr("методология", "methodology")}
              </Link>
            </p>
          </div>

          {acceptedReview ? (
            <Card
              className="mt-4 border-primary/40 bg-primary/5 p-4"
              role="status"
            >
              <p className="font-semibold">
                {tr(
                  "Проверено от редакционния екип",
                  "Reviewed by the editorial team",
                )}
              </p>
              <p className="mt-1 text-sm text-foreground/90">
                {tr("Приетата проверка е от", "The accepted review is dated")}{" "}
                {formatDateTime(humanReview.adjudicated_at, language)}.
                {humanReview.public_explanation && !isEnglish
                  ? ` ${humanReview.public_explanation}`
                  : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {tr(
                  "Човешки проверените полета нямат увереност на модела. Вижте",
                  "Human-reviewed fields do not carry model confidence. See the",
                )}{" "}
                <Link
                  className="rounded-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  to="/methodology"
                >
                  {tr("методологията", "methodology")}
                </Link>{" "}
                {tr("и", "and the")}{" "}
                <Link
                  className="rounded-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  to="/corrections"
                >
                  {tr("регистъра на поправките", "corrections register")}
                </Link>
                .
              </p>
            </Card>
          ) : staleReview ? (
            <Card
              className="mt-4 border-[hsl(var(--editorial-kicker)/0.5)] bg-[hsl(var(--editorial-kicker)/0.08)] p-4"
              role="status"
            >
              <p className="font-semibold">
                {tr(
                  "Оценката е в повторна проверка",
                  "The rating is under review again",
                )}
              </p>
              <p className="mt-1 text-sm text-foreground/90">
                {tr(
                  "Оригиналният материал е променен след редакционната проверка от",
                  "The original article changed after the editorial review dated",
                )}{" "}
                {formatDateTime(humanReview.adjudicated_at, language)}.{" "}
                {tr(
                  "Предишното решение е изключено; показани са текущите моделни оценки.",
                  "The previous decision has been excluded; current model ratings are shown.",
                )}
              </p>
            </Card>
          ) : evalTask ? (
            <Card className="mt-4 border-border bg-muted/40 p-4" role="status">
              <p className="font-semibold">
                {tr(
                  "Анализът е включен в обществена проверка",
                  "The analysis is included in public review",
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {tr(
                  "Това е експериментално събиране на оценки. Отделен отговор не променя публикувания анализ без редакционно приемане.",
                  "This is an experimental collection of ratings. An individual response does not change the published analysis without editorial acceptance.",
                )}
              </p>
            </Card>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <AxisCard
              title={tr(
                "Политическо рамкиране на материала",
                "Political framing of the article",
              )}
              {...scaleOf(
                isEnglish ? LEANING_META_EN : LEANING_META,
                analysis.leaning?.label,
                tr("Оценката не е налична", "Rating unavailable"),
              )}
              confidence={
                leaningSource === "editorial"
                  ? null
                  : analysis.leaning?.confidence
              }
              evidence={analysis.leaning?.evidence}
              source={leaningSource}
            />
            <AxisCard
              title={tr("Отношение към Русия", "Stance toward Russia")}
              {...scaleOf(
                isEnglish ? RUSSIA_META_EN : RUSSIA_META,
                analysis.russia_stance?.label,
                tr("Оценката не е налична", "Rating unavailable"),
              )}
              confidence={
                russiaSource === "editorial"
                  ? null
                  : analysis.russia_stance?.confidence
              }
              evidence={analysis.russia_stance?.evidence}
              source={russiaSource}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* ⚠️ Guarded lookups. The bundle passes rubric labels through
                VERBATIM, so an unrecognised one is a JSON value away — and a
                bare META[label].label throws, which in a component with no
                error boundary white-screens the whole app. Badges.tsx already
                guards every one of these. */}
            {labelOf(
              isEnglish ? AI_META_EN : AI_META,
              analysis.ai_generated?.verdict,
            ) ? (
              <Badge variant="outline" className="font-normal">
                {labelOf(
                  isEnglish ? AI_META_EN : AI_META,
                  analysis.ai_generated?.verdict,
                )}
              </Badge>
            ) : null}
            {analysis.quality?.verdict !== "ok" &&
            labelOf(
              isEnglish ? QUALITY_META_EN : QUALITY_META,
              analysis.quality?.verdict,
            ) ? (
              <Badge variant="outline" className="font-normal">
                {labelOf(
                  isEnglish ? QUALITY_META_EN : QUALITY_META,
                  analysis.quality?.verdict,
                )}
              </Badge>
            ) : null}
            <TopicChips
              categories={categories}
              topics={analysis.topics ?? []}
              inline
            />
          </div>

          {(analysis.ai_generated?.signals ?? []).length > 0 && !isEnglish ? (
            <Card className="mt-3 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Сигнали за възможна употреба на ИИ
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {analysis.ai_generated!.signals.map((sig) => (
                  <li key={sig}>{sig}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <MentionsBlock
            entities={analysis.entities}
            links={analysis.entity_links}
          />
        </section>
      ) : (
        // ⚠️ NO badges. At 8.4% analysed this is the common state, and it must
        // read as "not yet judged" — never as "judged neutral", which is what
        // an empty badge row would say.
        <Card className="mt-6 p-4">
          <div className="font-semibold">
            {tr(
              "Тази статия още не е анализирана",
              "This article has not yet been analyzed",
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr(
              'Събрана е в корпуса, но още няма оценка по нито една ос. Липсата на етикети тук не означава „неутрална" — означава, че моделът още не я е чел.',
              "It is in the corpus but has not been rated on any axis. Missing labels do not mean neutral; they mean the model has not yet read it.",
            )}
          </p>
        </Card>
      )}

      <ArticleContributionCard
        articlePath={`/article/${domain}/${id}`}
        evaluationPath={evalTask ? evalTaskPath(evalTask) : null}
        feedbackPath={`/evals/article/${encodeURIComponent(domain)}/${encodeURIComponent(id)}?mode=feedback`}
        hasAnalysis={Boolean(analysis)}
      />

      {story ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-title text-xl">
              {tr("Как я отразиха останалите", "How other outlets covered it")}
            </h2>
            <Link
              to={`/story/${story.id}`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {tr("Цялата история", "Full story")} ·{" "}
              {media(story.aggregates.outlet_count, language)}
            </Link>
          </div>
          {siblings.length > 0 ? (
            <Card className="mt-3 px-4 py-1">
              {siblings.map((m) => (
                <StoryMemberRow
                  key={`${m.domain}/${m.article_id ?? m.url}`}
                  member={m}
                  outletName={
                    (outlets.data?.outlets ?? []).find(
                      (o) => o.domain === m.domain,
                    )?.outlet
                  }
                />
              ))}
            </Card>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {tr(
                "Засега само това издание е отразило тази история.",
                "So far, only this outlet has covered the story.",
              )}
            </p>
          )}
        </section>
      ) : null}
    </article>
  );
};

/**
 * Named entities — linked where the name earned a link.
 *
 * ⚠️ MOST OF THEM ARE NOT LINKS, AND THE CAPTION SAYS SO. The identity layer
 * keys on three-part Bulgarian names while newsrooms write two, so a name is
 * linked only when it matches exactly ONE public figure. Measured over the
 * original 365-analysis rollout: 8 of 138 distinct people, 54 of 138 places,
 * 3 of 7 parties, 9 of 121 institutions and 0 of 30 companies. Curated,
 * hand-verified institution and company links have since been added without
 * weakening the default identity rule.
 *
 * ⚠️ The institution figure is low for a reason no threshold can fix, and it
 * is worth knowing before someone tries to loosen the match: a Bulgarian
 * article writes „МВР", while the registry holds „Министерство на
 * вътрешните работи". None of the abbreviations exists as a surface at all.
 * Those names need a reviewed crosswalk; unresolved ones remain plain text.
 *
 * The caption is NARROWED rather than removed: an unexplained plain chip
 * beside a linked one invites the reader to assume the plain one is
 * unimportant, when what it means is that we could not tell who it was.
 */
const MentionsBlock = ({
  entities,
  links,
}: {
  entities: AnalysisBlock["entities"];
  links?: Record<string, EntityLink>;
}) => {
  const { tr } = useNewsLocale();
  const groups: [string, string[]][] = [
    [tr("Хора", "People"), entities?.people ?? []],
    [tr("Партии", "Parties"), entities?.parties ?? []],
    [tr("Институции", "Institutions"), entities?.institutions ?? []],
    [tr("Компании", "Companies"), entities?.companies ?? []],
    [tr("Места", "Places"), entities?.places ?? []],
  ];
  const present = groups.filter(([, names]) => names.length > 0);
  if (present.length === 0) return null;
  const all = present.flatMap(([, names]) => names);
  const unlinked = all.filter((n) => !links?.[n]).length;
  return (
    <Card className="mt-3 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {tr("Споменати", "Mentioned")}
      </div>
      <div className="mt-2 space-y-2">
        {present.map(([label, names]) => (
          <div key={label} className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{label}:</span>
            <EntityChips title="" names={names} links={links} inline />
          </div>
        ))}
      </div>
      {unlinked > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {tr(
            `${
              unlinked === all.length
                ? "Нито едно от имената не води към профил."
                : unlinked === 1
                  ? "Едно от имената не води към профил."
                  : `${unlinked} от имената не водят към профил.`
            } Българските имена са три части, а медиите пишат две — свързваме само когато името съвпада с точно един публичен профил, защото грешната връзка е по-лоша от липсващата.`,
            `${unlinked === 1 ? "One name does not link to a profile." : `${unlinked} names do not link to a profile.`} Bulgarian names have three parts while media often use two. We link only when a name matches exactly one public profile, because a wrong link is worse than a missing one.`,
          )}
        </p>
      ) : null}
    </Card>
  );
};
