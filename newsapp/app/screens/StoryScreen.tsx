// Story comparison — the ground.news article page analog: canonical title,
// summary, "who broke it", interactive leaning/russia spectrums (the shared
// src/ux/MixBar doubles as the member filter), per-outlet headline framing,
// and a sidebar with coverage counts, topics, entities and related stories.

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MixBar, type MixSegment } from "@/ux/MixBar";
import { formatDate, LEANING_META, relativeTime, RUSSIA_META } from "../labels";
import { useOutlets, useStories, useTaxonomy } from "../data";
import { StoryMemberRow } from "../components/ArticleRow";
import { EntityChips } from "../components/EntityChips";
import { TopicChips } from "../components/TopicChips";
import { SummaryPair } from "../components/SummaryPair";
import { RelatedStories } from "../components/RelatedStories";
import { ReaderActions } from "../components/ReaderActions";
import { emitNewsEvent } from "../analytics";
import { resolveRelatedStories } from "./relatedStories";

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

// Group hues/labels ride on the canonical META records from labels.ts so the
// bars, badges and card spectrums can never drift apart.
const LEAN_GROUPS: {
  g: Exclude<LeanGroup, "n/a">;
  label: string;
  meta: keyof typeof LEANING_META;
}[] = [
  { g: "left", label: "Прогресивно", meta: "progressive" },
  { g: "center", label: "Без ясно рамкиране", meta: "neutral" },
  { g: "right", label: "Консервативно", meta: "conservative" },
];
const STANCE_GROUPS: {
  g: Exclude<StanceGroup, "n/a">;
  meta: keyof typeof RUSSIA_META;
}[] = [
  { g: "pro", meta: "pro_russia" },
  { g: "neutral", meta: "neutral" },
  { g: "anti", meta: "anti_russia" },
];

export const StoryScreen = () => {
  const { id } = useParams<{ id: string }>();
  const stories = useStories();
  const taxonomy = useTaxonomy();
  const outlets = useOutlets();

  const [leanFilter, setLeanFilter] = useState<LeanGroup | null>(null);
  const [stanceFilter, setStanceFilter] = useState<StanceGroup | null>(null);

  // react-router reuses this element across /story/:id navigations, so a
  // segment selected on one story would silently filter the next one's members.
  useEffect(() => {
    setLeanFilter(null);
    setStanceFilter(null);
  }, [id]);

  const story = useMemo(
    () => (stories.data?.stories ?? []).find((s) => s.id === id) ?? null,
    [stories.data, id],
  );

  const outletNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of outlets.data?.outlets ?? []) map.set(o.domain, o.outlet);
    return map;
  }, [outlets.data]);

  // Grouped lean counts + the n/a tally for the bar note, computed together.
  const lean = useMemo(() => {
    if (!story) return { segments: [] as MixSegment<LeanGroup>[], naCount: 0 };
    const counts: Record<LeanGroup, number> = {
      left: 0,
      center: 0,
      right: 0,
      "n/a": 0,
    };
    for (const m of story.members) counts[leanGroup(m.leaning)] += 1;
    return {
      segments: LEAN_GROUPS.map(({ g, label, meta }) => ({
        key: g,
        label,
        count: counts[g],
        color: LEANING_META[meta].color,
      })).filter((s) => s.count > 0),
      naCount: counts["n/a"],
    };
  }, [story]);

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
      label: RUSSIA_META[meta].label,
      count: counts[g],
      color: RUSSIA_META[meta].color,
    })).filter((s) => s.count > 0);
  }, [story]);

  const members = useMemo(() => {
    if (!story) return [];
    return (
      story.members
        .filter(
          (m) =>
            (!leanFilter || leanGroup(m.leaning) === leanFilter) &&
            (!stanceFilter || stanceGroup(m.russia_stance) === stanceFilter),
        )
        // Oldest first — the spread of coverage over time reads top→bottom.
        .slice()
        .sort((a, b) => (a.published ?? "").localeCompare(b.published ?? ""))
    );
  }, [story, leanFilter, stanceFilter]);

  const firstWithOutlet = useMemo(() => {
    if (!story || !story.members.length) return null;
    // Prefer dated members — an undated one must not be credited as "first".
    const dated = story.members.filter((m) => m.published);
    const pool = dated.length ? dated : story.members;
    const earliest = pool.reduce((min, m) =>
      (m.published ?? "") < (min.published ?? "") ? m : min,
    );
    return {
      member: earliest,
      name: outletNames.get(earliest.domain) ?? earliest.domain,
    };
  }, [story, outletNames]);

  const related = useMemo(() => {
    if (!story) return [];
    return resolveRelatedStories(story, stories.data?.stories ?? []);
  }, [story, stories.data]);

  const categories = taxonomy.data?.categories ?? null;

  if (stories.loading && !stories.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (stories.error && !stories.data) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">Данните не се заредиха</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {stories.error.message}
        </p>
      </Card>
    );
  }

  if (!story) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">Историята не е намерена</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Възможно е клъстерът да е обединен с друг или адресът да е грешен.{" "}
          <Link
            to="/"
            className="text-primary underline-offset-4 hover:underline"
          >
            Към историите
          </Link>
        </p>
      </Card>
    );
  }

  const primaryTopic = story.topics.find((t) => t.primary) ?? story.topics[0];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted-foreground" aria-label="Път">
        <Link to="/" className="hover:text-primary">
          Истории
        </Link>
        <span className="px-1.5">/</span>
        <span className="text-foreground">
          {story.title_bg ?? story.title_en}
        </span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <header>
            <h1 className="font-title text-3xl leading-tight">
              {story.title_bg ?? story.title_en ?? "(без заглавие)"}
            </h1>
            <ReaderActions
              path={`/story/${story.id}`}
              title={story.title_bg ?? story.title_en ?? "Наясно новини"}
            />
            {story.title_en && story.title_bg ? (
              <p className="mt-1 text-sm italic text-muted-foreground">
                {story.title_en}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {firstWithOutlet ? (
                <span>
                  Първи съобщи{" "}
                  <Link
                    to={`/outlet/${firstWithOutlet.member.domain}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {firstWithOutlet.name}
                  </Link>{" "}
                  · {relativeTime(firstWithOutlet.member.published)}
                </span>
              ) : null}
              <span>
                {story.aggregates.outlet_count} медии ·{" "}
                {story.aggregates.article_count} статии
              </span>
              <span>обновено {relativeTime(story.last_published)}</span>
            </div>
            <SummaryPair
              bg={story.summary_bg}
              en={story.summary_en}
              withheld={story.withheld}
              className="mt-3"
            />
          </header>

          {/* Interactive spectrums — clicking a group filters the member list. */}
          <div className="space-y-3">
            <MixBar
              title="Политическо рамкиране на материалите"
              segments={lean.segments}
              selected={leanFilter}
              onSelect={(value) => {
                emitNewsEvent({
                  name: "story_filter",
                  axis: "leaning",
                  active: value !== null,
                });
                setLeanFilter(value);
              }}
              note={
                lean.naCount > 0
                  ? `${lean.naCount} от материалите са извън политическата ос и не участват в лентата.`
                  : undefined
              }
            />
            <MixBar
              title="Позиция спрямо Русия"
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
          </div>

          {/* Coverage: same story, each outlet's own headline. */}
          <section aria-labelledby="coverage-heading">
            <h2
              id="coverage-heading"
              className="mb-1 text-sm font-semibold uppercase tracking-wide"
            >
              Отразяване ({members.length} от {story.members.length})
            </h2>
            <Card className="px-4 py-1">
              {members.map((m) => (
                <StoryMemberRow
                  key={`${m.domain}/${m.article_id ?? m.url}`}
                  member={m}
                  outletName={outletNames.get(m.domain)}
                />
              ))}
              {members.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  Няма източници в избрания сегмент.
                </p>
              ) : null}
            </Card>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <Card className="space-y-2 p-4 text-sm">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Обхват
            </h2>
            <div className="flex justify-between">
              <span>Източници</span>
              <span className="font-semibold tabular-nums">
                {story.aggregates.outlet_count}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Статии</span>
              <span className="font-semibold tabular-nums">
                {story.aggregates.article_count}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Първо съобщаване</span>
              <span className="tabular-nums">
                {formatDate(story.first_published)}
              </span>
            </div>
          </Card>

          {primaryTopic ? (
            <Card className="p-4">
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Теми
              </h2>
              <TopicChips categories={categories} topics={story.topics} />
            </Card>
          ) : null}

          <Card className="space-y-3 p-4">
            <EntityChips
              title="Хора"
              names={story.entities.people}
              links={story.entity_links}
            />
            <EntityChips
              title="Партии"
              names={story.entities.parties}
              links={story.entity_links}
            />
            <EntityChips
              title="Институции"
              names={story.entities.institutions}
              links={story.entity_links}
            />
            <EntityChips
              title="Компании"
              names={story.entities.companies}
              links={story.entity_links}
            />
            <EntityChips
              title="Места"
              names={story.entities.places}
              links={story.entity_links}
            />
          </Card>

          {Object.keys(story.aggregates.by_domain).length > 0 ? (
            <Card className="p-4">
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Източници
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
