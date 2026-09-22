// Story comparison — the ground.news article page analog: canonical title,
// summary, "who broke it", interactive leaning/russia spectrums (the shared
// src/ux/MixBar doubles as the member filter), per-outlet headline framing,
// and a sidebar with coverage counts, topics, entities and related stories.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MixBar, type MixSegment } from "@/ux/MixBar";
import {
  articles,
  formatDate,
  LEANING_META,
  leaningMeta,
  media,
  relativeTime,
  RUSSIA_META,
  russiaMeta,
} from "../labels";
import {
  storyIsGone,
  useCases,
  useOutlets,
  useRetiredStories,
  useStoryDetail,
  useTaxonomy,
} from "../data";
import {
  StoryTimeline,
  type TimelineOutlet,
} from "../components/StoryTimeline";
import { EntityChips } from "../components/EntityChips";
import { TopicChips } from "../components/TopicChips";
import { SummaryPair } from "../components/SummaryPair";
import { RelatedStories } from "../components/RelatedStories";
import { ReaderActions } from "../components/ReaderActions";
import { ReportIssueLink } from "../components/ReportIssueLink";
import { HeadlineComparison } from "../components/HeadlineComparison";
import { StorySynthesisBlock } from "../components/StorySynthesis";
import { AggregateCompleteness } from "../components/AggregateCompleteness";
import {
  axisCompleteness,
  type AxisCompleteness,
} from "../aggregateCompleteness";
import { emitNewsEvent } from "../analytics";
import { useNewsLocale } from "../i18n";
import { axisDivergence, type AxisDivergence } from "../storyDivergence";
import { articleNoun } from "../plural";

type LeanGroup = "left" | "center" | "right" | "n/a";
type StanceGroup = "pro" | "neutral" | "anti" | "n/a";

const leanGroup = (leaning: string | null | undefined): LeanGroup =>
  leaning === "strong_progressive" || leaning === "progressive"
    ? "left"
    : leaning === "neutral"
      ? "center"
      : leaning === "conservative" || leaning === "strong_conservative"
        ? "right"
        : "n/a";

const stanceGroup = (stance: string | null | undefined): StanceGroup =>
  stance === "strong_pro_russia" || stance === "pro_russia"
    ? "pro"
    : stance === "anti_russia" || stance === "strong_anti_russia"
      ? "anti"
      : stance === "neutral"
        ? "neutral"
        : "n/a";

// Group hues AND labels ride on the canonical META records from labels.ts so
// the bars, badges and card spectrums can never drift apart. T5.6: the BG
// strings used to be typed here while EN read the table — the short forms
// now come from `leaningMeta(…).short` in both languages.
const LEAN_GROUPS: {
  g: Exclude<LeanGroup, "n/a">;
  meta: keyof typeof LEANING_META;
}[] = [
  { g: "left", meta: "progressive" },
  { g: "center", meta: "neutral" },
  { g: "right", meta: "conservative" },
];
const STANCE_GROUPS: {
  g: Exclude<StanceGroup, "n/a">;
  meta: keyof typeof RUSSIA_META;
}[] = [
  { g: "pro", meta: "pro_russia" },
  { g: "neutral", meta: "neutral" },
  { g: "anti", meta: "anti_russia" },
];

// The state sentence beside each axis bar. Matching framing is not
// agreement on facts, and the sentence says so where it applies.
const DivergenceNote = ({
  divergence,
  axis,
}: {
  divergence: AxisDivergence;
  axis: "leaning" | "russia";
}) => {
  const { tr } = useNewsLocale();
  // ⚠️ POSITIONED, not assessed. `not_applicable` IS a verdict, and the
  // completeness line beneath this counts it — so this copy says „позиция"
  // where the rule counts positions, or the two adjacent sentences contradict
  // each other on every story with an out-of-scope verdict.
  const n = divergence.positionedOutlets;
  const text =
    divergence.state === "none"
      ? tr(
          "Нито един материал няма позиция по тази ос (оценката „не заема позиция“ не е позиция).",
          "No article holds a position on this axis (a “takes no position” verdict is not a position).",
        )
      : divergence.state === "single_source"
        ? tr(
            "Само един източник има позиция по тази ос — няма с какво да се сравни.",
            "Only one source holds a position on this axis — there is nothing to compare it with.",
          )
        : divergence.state === "uniform"
          ? axis === "leaning"
            ? tr(
                `${n} източника с позиция рамкират материала еднакво. Еднаквото рамкиране не е съгласие по фактите.`,
                `${n} sources with a position frame it the same way. Matching framing is not agreement on facts.`,
              )
            : tr(
                `${n} източника с позиция заемат една и съща позиция. Еднаквата позиция не е съгласие по фактите.`,
                `${n} sources with a position take the same one. A matching position is not agreement on facts.`,
              )
          : tr(
              `Разпределение между ${n} източника с позиция; сегментите броят материали, не източници.`,
              `A spread across ${n} sources with a position; the segments count articles, not sources.`,
            );
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid={`divergence-${axis}`}
      data-state={divergence.state}
    >
      {text}
    </p>
  );
};

// T5.3 — `not_applicable` is no longer hidden: the bar draws positions
// only, so the articles the model judged OUTSIDE this axis are said, in
// words, immediately beside the bar they are missing from — not in the
// completeness strip, which would repeat the sentence under the axis that
// did NOT collapse. Unassessed articles (no verdict at all) are a different
// absence and stay in the completeness disclosure as „N не е оценен /
// не са оценени" (`axisBreakdown`).
// The lower-case axis names the completeness sentence uses („по политическо
// рамкиране"); the bar titles above the bars are the capitalised long forms.
const AXIS_LABEL: Record<"leaning" | "russia", { bg: string; en: string }> = {
  leaning: { bg: "политическо рамкиране", en: "political framing" },
  russia: { bg: "позиция спрямо Русия", en: "stance toward Russia" },
};

const OutsideAxisNote = ({
  completeness,
  axis,
}: {
  completeness: AxisCompleteness;
  axis: "leaning" | "russia";
}) => {
  const { tr } = useNewsLocale();
  if (completeness.notApplicable === 0) return null;
  const n = completeness.notApplicable;
  const m = completeness.total;
  // Two agreements: the count noun follows M, the verb follows N (the
  // subject is „N of them"). The actor is deliberately unnamed — the served
  // verdict is the EFFECTIVE one, model resolved against editorial
  // adjudication, so „the model judged" would sometimes be false.
  const verb = n === 1 ? "е" : "са";
  const enVerb = n === 1 ? "falls" : "fall";
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid={`outside-axis-${axis}`}
    >
      {tr(
        `${n} от ${m} ${articleNoun(m, "bg")} ${verb} извън тази ос — оценката е, че текстът не заема позиция по нея.`,
        `${n} of ${m} ${articleNoun(m, "en")} ${enVerb} outside this axis — the assessment is that the text takes no position on it.`,
      )}
    </p>
  );
};

export const StoryScreen = () => {
  const { isEnglish, language, tr } = useNewsLocale();
  const { id } = useParams<{ id: string }>();
  const storyDetail = useStoryDetail(id);
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();
  // Fetched only once the detail has 404'd: the registry exists to explain
  // an absence, and every present story would otherwise pay for it.
  const gone = Boolean(
    storyDetail.error && !storyDetail.data && storyIsGone(storyDetail.error),
  );
  const retired = useRetiredStories(gone);
  // The registry is fetched only for a story that belongs to a case — the
  // chip needs the case's NAME, and the id alone is a slug.
  const caseIds = storyDetail.data?.story.case_ids ?? [];
  const cases = useCases(caseIds.length > 0);
  const caseChips = caseIds
    .map((slug) => cases.data?.cases.find((c) => c.slug === slug))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const [leanFilter, setLeanFilter] = useState<LeanGroup | null>(null);
  const [stanceFilter, setStanceFilter] = useState<StanceGroup | null>(null);
  const [completenessOpen, setCompletenessOpen] = useState(false);

  // react-router reuses this element across /story/:id navigations, so a
  // segment selected on one story would silently filter the next one's members.
  useEffect(() => {
    setLeanFilter(null);
    setStanceFilter(null);
    setCompletenessOpen(false);
  }, [id]);

  // ⚠️ ONE STORY, ONE FILE — 1.4 KB against the 1,456 KB corpus this used
  // to `.find()` through. The detail file carries its own resolved related
  // rows, so nothing here needs the other 1,918 stories.
  const story = storyDetail.data?.story ?? null;

  const outletNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of outlets.data?.outlets ?? []) map.set(o.domain, o.outlet);
    return map;
  }, [outlets.data]);
  // `TimelineOutlet` is a Pick so the mark can widen (a credited logo, a short
  // name) without changing this call site; today it carries the name alone.
  const outletMarks = useMemo(() => {
    const map = new Map<string, TimelineOutlet>();
    for (const o of outlets.data?.outlets ?? []) map.set(o.domain, o);
    return map;
  }, [outlets.data]);

  const leanSegments = useMemo<MixSegment<LeanGroup>[]>(() => {
    if (!story) return [];
    const counts: Record<LeanGroup, number> = {
      left: 0,
      center: 0,
      right: 0,
      "n/a": 0,
    };
    for (const m of story.members) counts[leanGroup(m.leaning)] += 1;
    return LEAN_GROUPS.map(({ g, meta }) => ({
      key: g,
      label: leaningMeta(meta, language).short,
      count: counts[g],
      color: LEANING_META[meta].color,
    })).filter((s) => s.count > 0);
  }, [language, story]);

  const stanceSegments = useMemo<MixSegment<StanceGroup>[]>(() => {
    if (!story) return [];
    const counts: Record<StanceGroup, number> = {
      pro: 0,
      neutral: 0,
      anti: 0,
      "n/a": 0,
    };
    for (const m of story.members) counts[stanceGroup(m.russia_stance)] += 1;
    return STANCE_GROUPS.map(({ g, meta }) => ({
      key: g,
      label: russiaMeta(meta, language).label,
      count: counts[g],
      color: RUSSIA_META[meta].color,
    })).filter((s) => s.count > 0);
  }, [language, story]);

  // T5.2 — what the assessed coverage licenses each bar to SAY, by distinct
  // outlets; the bar's segments still count articles, and the sentence
  // beside it says which.
  const leanDivergence = useMemo(
    () => axisDivergence(story?.members ?? [], (member) => member.leaning),
    [story],
  );
  const stanceDivergence = useMemo(
    () =>
      axisDivergence(story?.members ?? [], (member) => member.russia_stance),
    [story],
  );

  const leanCompleteness = useMemo(
    () => axisCompleteness(story?.members ?? [], (member) => member.leaning),
    [story],
  );
  const stanceCompleteness = useMemo(
    () =>
      axisCompleteness(story?.members ?? [], (member) => member.russia_stance),
    [story],
  );

  const chronologicalMembers = useMemo(
    () =>
      (story?.members ?? [])
        .map((member, index) => ({ member, index }))
        .sort((a, b) => {
          const aTime = a.member.published
            ? Date.parse(a.member.published)
            : Number.NaN;
          const bTime = b.member.published
            ? Date.parse(b.member.published)
            : Number.NaN;
          const aKnown = Number.isFinite(aTime);
          const bKnown = Number.isFinite(bTime);
          if (aKnown && bKnown) return aTime - bTime || a.index - b.index;
          if (aKnown) return -1;
          if (bKnown) return 1;
          return a.index - b.index;
        })
        .map(({ member }) => member),
    [story],
  );

  const members = useMemo(() => {
    return chronologicalMembers.filter(
      (m) =>
        (!leanFilter || leanGroup(m.leaning) === leanFilter) &&
        (!stanceFilter || stanceGroup(m.russia_stance) === stanceFilter),
    );
  }, [chronologicalMembers, leanFilter, stanceFilter]);

  const observedLead = useMemo(() => {
    const earliest = story?.members.find(
      (member) =>
        member.scoop_decidable && member.first_here && member.first_seen,
    );
    if (!earliest) return null;
    return {
      member: earliest,
      name: outletNames.get(earliest.domain) ?? earliest.domain,
    };
  }, [story, outletNames]);

  const related = storyDetail.data?.related ?? [];

  const categories = taxonomy.data?.categories ?? null;

  if (storyDetail.loading && !storyDetail.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (gone) {
    const entry = id ? retired.data?.retired[id] : undefined;
    // ⚠️ THREE STATES, NOT ONE. While the registry is in flight the page
    // says nothing about WHY; a registry that could not be read says so;
    // only a read registry may say „never published".
    //
    // ⚠️ „IN FLIGHT" IS THE ABSENCE OF AN ANSWER, NOT `loading`. In the
    // render where `gone` first flips, the hook still reports
    // `loading: false` — the effect that starts the fetch has not run — so
    // keying on `loading` paints „never published" for one real frame on
    // every 404, withdrawn stories included.
    const checking = !retired.data && !retired.error;
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {entry
            ? entry.reason === "merged"
              ? tr("Историята е обединена с друга", "This story was merged")
              : entry.reason === "error"
                ? tr(
                    "Историята е публикувана по грешка",
                    "This story was published in error",
                  )
                : tr("Историята е оттеглена", "This story was withdrawn")
            : checking
              ? tr("Историята не е налична", "Story unavailable")
              : tr("Историята не е намерена", "Story not found")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {entry ? (
            <>
              {entry.note} ({entry.on}).{" "}
              {entry.target ? (
                <Link
                  to={`/story/${entry.target}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {tr("Към обединената история", "Go to the merged story")}
                </Link>
              ) : null}
            </>
          ) : checking ? (
            tr(
              "Проверяваме регистъра на оттеглените истории…",
              "Checking the register of withdrawn stories…",
            )
          ) : retired.error && !retired.data ? (
            tr(
              "Тази история не се сервира и регистърът на оттеглените не можа да бъде прочетен.",
              "This story is not being served and the register of withdrawn stories could not be read.",
            )
          ) : (
            tr(
              "Този адрес не отговаря на публикувана история.",
              "This address does not correspond to a published story.",
            )
          )}{" "}
          <Link
            to="/stories"
            className="text-primary underline-offset-4 hover:underline"
          >
            {tr("Към всички истории", "Browse all stories")}
          </Link>
        </p>
      </Card>
    );
  }

  if (storyDetail.error && !storyDetail.data) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Данните не се заредиха", "Data could not be loaded")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isEnglish ? "Please try again later." : storyDetail.error.message}
        </p>
      </Card>
    );
  }

  if (!story) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Историята не е намерена", "Story not found")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "Възможно е групата материали да е обединена с друга или адресът да е грешен.",
            "The story may have been merged into another group of articles, or the address may be incorrect.",
          )}{" "}
          <Link
            to="/"
            className="text-primary underline-offset-4 hover:underline"
          >
            {tr("Към историите", "Browse stories")}
          </Link>
        </p>
      </Card>
    );
  }

  const primaryTopic = story.topics.find((t) => t.primary) ?? story.topics[0];
  const selectedTitle = language === "bg" ? story.title_bg : story.title_en;
  const pageTitle =
    selectedTitle ?? tr("История без заглавие", "Untitled story");

  return (
    <div className="space-y-6">
      <nav
        className="text-sm text-muted-foreground"
        aria-label={tr("Път", "Breadcrumb")}
      >
        <Link to="/" className="hover:text-primary">
          {tr("Истории", "Stories")}
        </Link>
        <span className="px-1.5">/</span>
        <span className="text-foreground">{pageTitle}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          {/* 1. What happened — the common-facts synthesis and provenance. */}
          <header aria-labelledby="story-title">
            <p className="app-eyebrow mb-2">
              {tr("Какво се случи", "What happened")}
            </p>
            <h1 id="story-title" className="app-story-title">
              {pageTitle}
            </h1>
            <ReaderActions path={`/story/${story.id}`} title={pageTitle} />
            <div className="mt-2">
              <ReportIssueLink path={`/story/${story.id}`} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {observedLead ? (
                <span>
                  {tr("Най-рано засечен източник", "Earliest observed source")}{" "}
                  <Link
                    to={`/outlet/${observedLead.member.domain}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {observedLead.name}
                  </Link>{" "}
                  · {relativeTime(observedLead.member.first_seen, language)}
                </span>
              ) : (
                <span>
                  {tr(
                    "Няма измерим еднозначен първи източник",
                    "No single earliest source could be measured",
                  )}
                </span>
              )}
              <span>
                {media(story.aggregates.outlet_count, language)} ·{" "}
                {articles(story.aggregates.article_count, language)}
              </span>
              <span>
                {tr("обновено", "updated")}{" "}
                {relativeTime(story.last_published, language)}
              </span>
            </div>
            <SummaryPair
              bg={story.summary_bg}
              en={story.summary_en}
              withheld={story.withheld}
              className="mt-4 text-base leading-relaxed"
            />
            <StorySynthesisBlock
              synthesis={storyDetail.data?.synthesis}
              members={chronologicalMembers}
              outletNames={outletNames}
              storyTitle={selectedTitle}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {tr(
                "Обобщението е съставено автоматично от материалите в тази група. Проверете оригиналните източници и хронологията.",
                "The summary is generated automatically from the articles in this group. Check the original sources and chronology.",
              )}{" "}
              <a
                href="#sources-chronology"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {tr("Към източниците", "Go to sources")}
              </a>
              {" · "}
              <a
                href="#coverage-differences-heading"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {tr("Сравни отразяването", "Compare the coverage")}
              </a>
            </p>
          </header>

          {/* 2. Aligned source headlines with bounded lexical differences. */}
          <section aria-labelledby="coverage-differences-heading">
            <h2
              id="coverage-differences-heading"
              className="app-section-title mb-2"
            >
              {tr("Как се различава отразяването", "How coverage differs")}
            </h2>
            <HeadlineComparison
              members={chronologicalMembers}
              outletNames={outletNames}
            />
          </section>

          {/* 3. Interactive analysis — a bar per axis, ONE completeness strip after both (T5.4). */}
          <section className="space-y-3" aria-labelledby="analysis-heading">
            <div>
              <h2 id="analysis-heading" className="app-section-title">
                {tr("Какво показва анализът", "What the analysis says")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {tr(
                  "Изберете сегмент, за да филтрирате хронологията. Празна лента означава, че няма достатъчно публикувани стойности.",
                  "Select a segment to filter the chronology. An empty bar means there are not enough published values.",
                )}
              </p>
            </div>
            <div className="space-y-2">
              <MixBar
                title={tr(
                  "Политическо рамкиране на материалите",
                  "Political framing of the articles",
                )}
                segments={leanSegments}
                selected={leanFilter}
                onSelect={(value) => {
                  emitNewsEvent({
                    name: "story_filter",
                    axis: "leaning",
                    active: value !== null,
                  });
                  setLeanFilter(value);
                }}
              />
              <DivergenceNote divergence={leanDivergence} axis="leaning" />
              <OutsideAxisNote completeness={leanCompleteness} axis="leaning" />
            </div>
            <div className="space-y-2">
              <MixBar
                title={tr("Позиция спрямо Русия", "Stance toward Russia")}
                segments={stanceSegments}
                selected={stanceFilter}
                onSelect={(value) => {
                  emitNewsEvent({
                    name: "story_filter",
                    axis: "russia",
                    active: value !== null,
                  });
                  setStanceFilter(value);
                }}
              />
              <DivergenceNote divergence={stanceDivergence} axis="russia" />
              <OutsideAxisNote
                completeness={stanceCompleteness}
                axis="russia"
              />
            </div>
            {/* T5.4 — ONE completeness strip for both axes; the page owns
                the disclosure so it cannot be open under one bar and closed
                under the other. */}
            <AggregateCompleteness
              axes={[
                {
                  key: "leaning",
                  label: tr(AXIS_LABEL.leaning.bg, AXIS_LABEL.leaning.en),
                  completeness: leanCompleteness,
                },
                {
                  key: "russia",
                  label: tr(AXIS_LABEL.russia.bg, AXIS_LABEL.russia.en),
                  completeness: stanceCompleteness,
                },
              ]}
              generatedAt={storyDetail.data?.generated_at}
              open={completenessOpen}
              onToggle={setCompletenessOpen}
            />
          </section>

          {/* 4. Original links in publication chronology. */}
          <section
            id="sources-chronology"
            className="scroll-mt-20"
            aria-labelledby="sources-chronology-heading"
          >
            <h2
              id="sources-chronology-heading"
              className="app-section-title mb-1"
            >
              {tr("Източници и хронология", "Sources and chronology")} ({" "}
              {members.length} {tr("от", "of")} {story.members.length})
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              {tr(
                "Подредени по време на публикуване; филтрите по-горе променят този списък.",
                "Ordered by publication time; the filters above change this list.",
              )}
            </p>
            <Card className="overflow-hidden p-4">
              <StoryTimeline
                members={members}
                outlets={outletMarks}
                onShowAll={
                  // Only while there is a selection to clear: without it the
                  // empty state describes an empty story, not a filter result.
                  leanFilter || stanceFilter
                    ? () => {
                        // One event, distinct from two per-axis clears, so
                        // „hit an empty intersection and bailed" is countable.
                        emitNewsEvent({
                          name: "story_filter",
                          axis: "both",
                          active: false,
                        });
                        setLeanFilter(null);
                        setStanceFilter(null);
                      }
                    : undefined
                }
              />
            </Card>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {tr("Обхват", "Coverage")}
            </h2>
            <div className="flex justify-between">
              <span>{tr("Източници", "Sources")}</span>
              <span className="font-semibold tabular-nums">
                {story.aggregates.outlet_count}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{tr("Материали", "Articles")}</span>
              <span className="font-semibold tabular-nums">
                {story.aggregates.article_count}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{tr("Най-ранен материал", "Earliest article")}</span>
              <span className="tabular-nums">
                {formatDate(story.first_published, language)}
              </span>
            </div>
          </Card>

          {primaryTopic ? (
            <Card className="p-4">
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tr("Теми", "Topics")}
              </h2>
              <TopicChips categories={categories} topics={story.topics} />
            </Card>
          ) : null}

          {/* ⚠️ A CASE CHIP IS A LINK TO AN EDITORIAL SELECTION, and the
              label says „казус" rather than presenting the affair as a
              topic the analysis found. Rendered only when the registry
              resolved the name; a bare slug is not a chip. */}
          {caseChips.length ? (
            <Card className="p-4">
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tr("Казус", "Case")}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {caseChips.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/case/${c.slug}`}
                    className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-primary hover:underline"
                  >
                    {c.name[language]}
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="space-y-3 p-4">
            <EntityChips
              title={tr("Хора", "People")}
              names={story.entities.people}
              links={story.entity_links}
              candidates={story.entity_candidates}
            />
            <EntityChips
              title={tr("Партии", "Parties")}
              names={story.entities.parties}
              links={story.entity_links}
              candidates={story.entity_candidates}
            />
            <EntityChips
              title={tr("Институции", "Institutions")}
              names={story.entities.institutions}
              links={story.entity_links}
              candidates={story.entity_candidates}
            />
            <EntityChips
              title={tr("Компании", "Companies")}
              names={story.entities.companies}
              links={story.entity_links}
              candidates={story.entity_candidates}
            />
            <EntityChips
              title={tr("Места", "Places")}
              names={story.entities.places}
              links={story.entity_links}
              candidates={story.entity_candidates}
            />
          </Card>

          {Object.keys(story.aggregates.by_domain).length > 0 ? (
            <Card className="p-4">
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tr("Източници", "Sources")}
              </h2>
              <ul className="space-y-1 text-sm">
                {Object.entries(story.aggregates.by_domain)
                  .sort((a, b) => b[1] - a[1])
                  .map(([domain, count]) => (
                    <li key={domain} className="flex justify-between">
                      <Link
                        to={`/outlet/${domain}`}
                        className="hover:text-primary"
                      >
                        {outletNames.get(domain) ?? domain}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}

          <RelatedStories stories={related} />
        </aside>
      </div>
    </div>
  );
};
