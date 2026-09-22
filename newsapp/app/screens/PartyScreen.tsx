// T4.2 — one party's ARCHIVE. ⚠️ Strictly a filter over the articles that
// mention this party, with the distribution of how those articles present it
// and its denominators — never a comparative bias scoreboard. The party is
// not rated; each ROW is one article's assessment, opening the quoted
// evidence the T4.1 gate located in that article, and linking to it.
//
// A party reaches this page only with a registry-resolved identity: a name
// the registry cannot resolve to one party has no page, because a name is
// not an identity.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useParty } from "../data";
import { isPartyId } from "../partyId";
import {
  articles as articlesLabel,
  assessments as assessmentsLabel,
  formatDate,
  media as mediaLabel,
  TONE_META,
  TONE_META_EN,
} from "../labels";
import { useNewsLocale } from "../i18n";
import { ToneBar } from "../components/ToneBar";

export const PartyScreen = () => {
  const { id } = useParams<{ id: string }>();
  const { language, tr, isEnglish } = useNewsLocale();
  const [page, setPage] = useState(1);
  const party = useParty(id, page);
  const meta = isEnglish ? TONE_META_EN : TONE_META;

  // ⚠️ THE GUARD COMES FIRST. An id the charset refuses makes
  // `partyPayloadPath` return null, and `useData(null)` never loads — so
  // without this the page renders a skeleton for ever instead of saying
  // there is no such party. (`CaseScreen` has the same order.)
  if (!isPartyId(id) || (party.error && !party.data)) {
    return (
      <Card className="p-6">
        <h1 className="font-title text-2xl">
          {tr("Партията не е намерена", "Party not found")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tr(
            "Страница има само партия, която регистърът свързва еднозначно с една самоличност.",
            "Only a party the registry resolves to one identity has a page.",
          )}{" "}
          <Link
            to="/parties"
            className="text-primary underline-offset-4 hover:underline"
          >
            {tr("Към всички партии", "Browse all parties")}
          </Link>
        </p>
      </Card>
    );
  }
  if (!party.data) return <Skeleton className="h-40 rounded-xl" />;
  const p = party.data;
  return (
    <div className="space-y-5">
      <header className="border-b pb-4">
        <p className="app-eyebrow mb-2">
          {tr("Архив по партия", "Party archive")}
        </p>
        <h1 className="app-page-title">{p.name ?? p.party_id}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {assessmentsLabel(p.assessed, language)} {tr("в", "across")}{" "}
          {articlesLabel(p.article_count, language)} {tr("от", "from")}{" "}
          {mediaLabel(p.outlet_count, language)}
          {p.first_published ? (
            <>
              {" · "}
              {formatDate(p.first_published, language)} –{" "}
              {formatDate(p.last_published, language)}
            </>
          ) : null}
          {p.undated
            ? tr(` · ${p.undated} без дата`, ` · ${p.undated} undated`)
            : null}
        </p>
        <ToneBar counts={p.counts} total={p.assessed} />
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {tr(
            "Това е архив на материалите, които споменават партията, и как всеки от тях я представя — не оценка на партията и не класация между партии. Оценява се СТАТИЯТА.",
            "This is an archive of the articles that mention the party and how each presents it — not a rating of the party and not a ranking between parties. What is assessed is the ARTICLE.",
          )}
        </p>
        {p.names_seen.length > 1 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("Изписвания в материалите", "Spellings in the articles")}:{" "}
            {p.names_seen.join(", ")}
          </p>
        ) : null}
      </header>

      <Card className="divide-y p-0">
        {p.articles.map((row) => (
          <article
            key={`${row.domain}/${row.article_id ?? row.url ?? row.title ?? "row"}/${row.published ?? ""}`}
            className="px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span
                className={`text-xs font-medium ${meta[row.tone]?.className}`}
              >
                {meta[row.tone]?.label ?? row.tone}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.domain} · {formatDate(row.published, language)}
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
                      <s>
                        <q lang="bg">{span.quote}</q>
                      </s>
                    ) : (
                      <q lang="bg">{span.quote}</q>
                    )}{" "}
                    <span>
                      {span.voice === "quoted_speaker"
                        ? `${tr("цитиран", "quoted")}${span.speaker ? `: ${span.speaker}` : ""}`
                        : span.voice === "journalist"
                          ? tr("авторски текст", "journalist")
                          : tr("неясен глас", "unclear voice")}
                      {span.located === false
                        ? ` · ${tr("не е намерен в текста", "not found in the text")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {row.story_id ? (
              <Link
                to={`/story/${row.story_id}`}
                className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
              >
                {tr("историята", "the story")} →
              </Link>
            ) : null}
          </article>
        ))}
      </Card>
      {p.total_pages > 1 ? (
        <nav
          className="flex items-center justify-between gap-2 text-sm"
          aria-label={tr("Страници на архива", "Archive pages")}
        >
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 disabled:opacity-50"
            disabled={p.page <= 1}
            onClick={() => setPage((n) => Math.max(1, n - 1))}
          >
            {tr("По-нови", "Newer")}
          </button>
          <span className="text-xs text-muted-foreground">
            {tr(
              `Страница ${p.page} от ${p.total_pages}`,
              `Page ${p.page} of ${p.total_pages}`,
            )}
          </span>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 disabled:opacity-50"
            disabled={p.page >= p.total_pages}
            onClick={() => setPage((n) => Math.min(p.total_pages, n + 1))}
          >
            {tr("По-стари", "Older")}
          </button>
        </nav>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {tr("Рубрика", "Rubric")}: {p.rubric_version} ·{" "}
        {tr("обобщено", "aggregated")} {formatDate(p.generated_at, language)}
      </p>
    </div>
  );
};
