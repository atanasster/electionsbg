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
  LEANING_META,
  QUALITY_META,
  RUSSIA_META,
  formatDateTime,
  relativeTime,
  topicLabel,
} from "../labels";
import {
  useOutletArticles,
  useOutlets,
  useStories,
  useTaxonomy,
  type AnalysisBlock,
  type ArticleRecord,
  type Outlet,
} from "../data";
import { ArticleImage } from "../components/ArticleImage";
import { SummaryPair } from "../components/SummaryPair";
import { StoryMemberRow } from "../components/ArticleRow";

/**
 * One axis: its label, its verdict, its confidence, and the sentence the
 * rubric quoted.
 *
 * ⚠️ Renders even when `evidence` is empty — with the absence stated. A
 * verdict whose evidence silently vanishes is exactly the unsupported claim
 * this page exists to avoid making.
 */
const AxisCard = ({
  title,
  verdict,
  color,
  confidence,
  evidence,
}: {
  title: string;
  verdict: string;
  color: string;
  confidence: number | null | undefined;
  evidence: string | null | undefined;
}) => (
  <Card className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {typeof confidence === "number" ? (
        <span className="text-xs text-muted-foreground">
          увереност {confidence.toFixed(1)}
        </span>
      ) : null}
    </div>
    <div className="mt-2 flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block size-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="font-title text-lg">{verdict}</span>
    </div>
    {evidence ? (
      <blockquote className="mt-3 border-l-2 border-primary pl-3 text-sm text-foreground/90">
        „{evidence}"
      </blockquote>
    ) : (
      <p className="mt-3 text-sm text-muted-foreground">
        Моделът не е цитирал изречение за тази оценка.
      </p>
    )}
  </Card>
);

/**
 * A scale label and colour, tolerating a value the app has never seen.
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
): { verdict: string; color: string } => {
  const hit = meta[key ?? ""] ?? meta.not_applicable;
  return hit
    ? { verdict: hit.label, color: hit.color }
    : { verdict: key ?? "—", color: "#71717a" };
};

/** A label from a META record, or null when the app has never seen the key. */
const labelOf = (
  meta: Record<string, { label: string }>,
  key: string | null | undefined,
): string | null => (key ? (meta[key]?.label ?? null) : null);

const NotFound = ({ domain }: { domain: string }) => (
  <section className="py-8">
    <h1 className="font-title text-3xl">Статията не е намерена</h1>
    <p className="mt-2 text-muted-foreground">
      Няма такъв материал в корпуса.{" "}
      <Link
        to={`/outlet/${domain}`}
        className="text-primary underline-offset-4 hover:underline"
      >
        Към страницата на изданието
      </Link>
      .
    </p>
  </section>
);

export const ArticleScreen = () => {
  const { domain = "", id = "" } = useParams();
  const bundle = useOutletArticles(domain || null);
  const outlets = useOutlets();
  const stories = useStories();
  const taxonomy = useTaxonomy();

  if (bundle.error) {
    return (
      <section className="py-8">
        <h1 className="font-title text-3xl">Статия</h1>
        <Card className="mt-4 p-4 text-sm text-destructive">
          Материалът не се зареди: {bundle.error.message}
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

  return (
    <article className="py-6">
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
            оттеглен източник
          </Badge>
        ) : null}
        <span className="text-muted-foreground">·</span>
        <time
          className="text-muted-foreground"
          dateTime={article.published ?? undefined}
        >
          {article.published ? formatDateTime(article.published) : "без дата"}
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
            редактирана {relativeTime(article.updated)}
          </Badge>
        ) : null}
      </div>

      <h1 className="mt-3 max-w-4xl font-title text-3xl leading-tight">
        {article.title ?? "(без заглавие)"}
      </h1>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div>
          <ArticleImage
            image={article.image}
            imageAlt={article.image_alt}
            title={article.title}
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
                Резюме
              </div>
              <SummaryPair
                bg={analysis.summary_bg}
                en={analysis.summary_en}
                className="mt-2"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Генерирано резюме, не цитат от материала.
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
              className="flex items-center gap-3 rounded-md border border-primary p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="size-4 shrink-0 text-primary" />
              <span className="text-sm">
                <span className="font-semibold">Прочети в {outletName}</span>
                <span className="block text-muted-foreground">
                  Пълният текст остава при източника. Тук е само прочитът.
                </span>
              </span>
            </a>
          ) : null}
        </div>
      </div>

      {analysis ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <AxisCard
              title="Политическа ос"
              {...scaleOf(LEANING_META, analysis.leaning?.label)}
              confidence={analysis.leaning?.confidence}
              evidence={analysis.leaning?.evidence}
            />
            <AxisCard
              title="Отношение към Русия"
              {...scaleOf(RUSSIA_META, analysis.russia_stance?.label)}
              confidence={analysis.russia_stance?.confidence}
              evidence={analysis.russia_stance?.evidence}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* ⚠️ Guarded lookups. The bundle passes rubric labels through
                VERBATIM, so an unrecognised one is a JSON value away — and a
                bare META[label].label throws, which in a component with no
                error boundary white-screens the whole app. Badges.tsx already
                guards every one of these. */}
            {labelOf(AI_META, analysis.ai_generated?.verdict) ? (
              <Badge variant="outline" className="font-normal">
                {labelOf(AI_META, analysis.ai_generated?.verdict)}
              </Badge>
            ) : null}
            {analysis.quality?.verdict !== "ok" &&
            labelOf(QUALITY_META, analysis.quality?.verdict) ? (
              <Badge variant="outline" className="font-normal">
                {labelOf(QUALITY_META, analysis.quality?.verdict)}
              </Badge>
            ) : null}
            {(analysis.topics ?? []).map((t) => (
              <Badge
                key={`${t.category}/${t.subcategory ?? ""}`}
                variant="secondary"
                className="font-normal"
              >
                {topicLabel(categories, t.category, t.subcategory)}
              </Badge>
            ))}
          </div>

          {(analysis.ai_generated?.signals ?? []).length > 0 ? (
            <Card className="mt-3 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Сигнали за ИИ-генериран текст
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {analysis.ai_generated!.signals.map((sig) => (
                  <li key={sig}>{sig}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <MentionsBlock entities={analysis.entities} />
        </>
      ) : (
        // ⚠️ NO badges. At 8.4% analysed this is the common state, and it must
        // read as "not yet judged" — never as "judged neutral", which is what
        // an empty badge row would say.
        <Card className="mt-6 p-4">
          <div className="font-semibold">Тази статия още не е анализирана</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Събрана е в корпуса, но още няма оценка по нито една ос. Липсата на
            етикети тук не означава „неутрална" — означава, че моделът още не я
            е чел.
          </p>
        </Card>
      )}

      {story ? (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-title text-xl">Как я отразиха останалите</h2>
            <Link
              to={`/story/${story.id}`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Цялата история · {story.aggregates.outlet_count} медии
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
              Засега само това издание е отразило тази история.
            </p>
          )}
        </section>
      ) : null}

      {/* ⚠️ A judgment with no attribution is not checkable, and the model
          will change. */}
      {analysis ? (
        <p className="mt-8 text-xs text-muted-foreground">
          Анализирано{" "}
          {analysis.analyzed_at ? formatDateTime(analysis.analyzed_at) : "—"}
          {analysis.model ? ` от ${analysis.model}` : ""} ·{" "}
          <Link
            to="/methodology"
            className="text-primary underline-offset-4 hover:underline"
          >
            как се правят тези оценки
          </Link>
        </p>
      ) : null}
    </article>
  );
};

/**
 * Named entities, as the analysis layer currently holds them.
 *
 * ⚠️ THESE ARE BARE STRINGS AND THEY ARE NOT LINKS. The corpus stores a name
 * and nothing else — no person slug, no EIK, no EKATTE — and the identity
 * layer keys on three-part Bulgarian names while newsrooms write two. Every
 * one of seventeen corpus names tested against it matched ambiguously:
 * „Радев" is 15 different people. Linking on a name would name the wrong
 * individual, which is the harm the refusal exists to prevent (T2 in
 * docs/plans/news-site-v1.md builds the resolver that can link safely).
 *
 * So they render as plain chips, and the caption says why there is no link —
 * an unexplained chip invites the reader to assume we checked.
 */
const MentionsBlock = ({
  entities,
}: {
  entities: AnalysisBlock["entities"];
}) => {
  const groups: [string, string[]][] = [
    ["Хора", entities?.people ?? []],
    ["Партии", entities?.parties ?? []],
    ["Институции", entities?.institutions ?? []],
    ["Компании", entities?.companies ?? []],
    ["Места", entities?.places ?? []],
  ];
  const present = groups.filter(([, names]) => names.length > 0);
  if (present.length === 0) return null;
  return (
    <Card className="mt-3 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Споменати
      </div>
      <div className="mt-2 space-y-2">
        {present.map(([label, names]) => (
          <div key={label} className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{label}:</span>
            {names.map((n) => (
              <Badge key={n} variant="secondary" className="font-normal">
                {n}
              </Badge>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Имената не водят към профили. Българските имена са три части, а медиите
        пишат две, така че само фамилия съвпада с десетки различни хора в
        регистъра — а грешната връзка е по-лоша от липсващата.
      </p>
    </Card>
  );
};
