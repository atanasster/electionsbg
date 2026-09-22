// T5.8 — the aligned comparison of two or three selected sources. One data
// model, two layouts: on desktop a table with the sources as sticky column
// heads and one field per row; on a phone a stack per source with a sticky
// source label, so the reader scrolls the same fields in the same order.
// Every value carries a TEXT label beside any colour (the badges already
// do), every link says where it goes, and nothing here republishes an
// article or invents a position: the summary is the build's own cited
// summary, the quotes are the T5.1 spans the gate found in the text, and a
// field the corpus does not carry is said to be missing, not guessed.
//
// ⚠️ Two rows the plan names are deliberately absent: article GENRE (no
// field in the corpus — `ArticleRecord` has section_path, not a genre) and
// the selected PERSON's treatment (T4.1+ has not shipped). Saying so beats
// a column of „unknown".

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type {
  ArticleRecord,
  Outlet,
  StoryMember,
  StorySynthesis,
} from "../data";
import { formatDateTime } from "../labels";
import { useNewsLocale } from "../i18n";
import { publishableOwner } from "../sourceTransparency";
import { citedQuotesFor } from "../storyCompare";
import { LeanBadge, StanceBadge } from "./Badges";
import { OriginalLink } from "./ArticleRow";
import { ScopeMark } from "./ScopeMark";

/** Cited spans shown per source before „+ още N" points at the synthesis. */
const QUOTES_SHOWN = 3;

export interface CompareSource {
  key: string;
  member: StoryMember;
  outlet?: Pick<Outlet, "outlet" | "owner">;
  /** The article page's record, once its outlet bundle has loaded. */
  article?: ArticleRecord | null;
  loading: boolean;
}

interface Field {
  id: string;
  label: string;
  render: (s: CompareSource) => ReactNode;
}

export const StoryCompare = ({
  sources,
  synthesis,
  onReset,
}: {
  sources: CompareSource[];
  synthesis?: StorySynthesis;
  onReset: () => void;
}) => {
  const { language, tr } = useNewsLocale();
  const name = (s: CompareSource) => s.outlet?.outlet ?? s.member.domain;
  const missing = (bg: string, en: string) => (
    <span className="text-muted-foreground">{tr(bg, en)}</span>
  );

  const fields: Field[] = [
    {
      id: "outlet",
      label: tr("Източник", "Source"),
      render: (s) => {
        // `publishableOwner` already requires a safe http(s) source and a
        // valid checked date, so a non-null owner is renderable as is.
        const owner = publishableOwner(s.outlet?.owner ?? null);
        return (
          <div className="space-y-1">
            <Link
              to={`/outlet/${s.member.domain}`}
              className="font-semibold underline-offset-4 hover:underline"
            >
              {name(s)}
            </Link>
            {owner ? (
              <p className="text-xs text-muted-foreground">
                {tr("Вписан собственик", "Registered owner")}: {owner.name} ·{" "}
                <a
                  href={owner.source ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-2"
                >
                  {tr("справка", "registry")} ↗
                </a>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {tr(
                  "Собственост: няма проверена справка.",
                  "Ownership: no checked registry entry.",
                )}
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "time",
      label: tr("Публикувано / обновено", "Published / updated"),
      render: (s) => (
        <div className="space-y-0.5 tabular-nums">
          <p>
            {s.member.published ? (
              <time dateTime={s.member.published}>
                {formatDateTime(s.member.published, language)}
              </time>
            ) : (
              missing("без дата на публикуване", "no publication date")
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {s.article?.updated ? (
              <>
                {tr("обновено", "updated")}{" "}
                <time dateTime={s.article.updated}>
                  {formatDateTime(s.article.updated, language)}
                </time>
              </>
            ) : (
              tr("без обявено обновяване", "no update declared")
            )}
          </p>
        </div>
      ),
    },
    {
      id: "headline",
      label: tr("Заглавие", "Headline"),
      render: (s) => (
        <div className="flex items-start gap-2">
          <Link
            to={`/article/${s.member.domain}/${s.member.article_id}`}
            className="min-w-0 flex-1 font-medium leading-snug underline-offset-4 hover:underline"
          >
            {s.member.title ?? tr("Без заглавие", "Untitled")}
          </Link>
          {s.member.url ? (
            <OriginalLink
              url={s.member.url}
              title={s.member.title}
              outlet={name(s)}
            />
          ) : null}
        </div>
      ),
    },
    {
      id: "summary",
      label: tr("Кратко обобщение", "Brief summary"),
      render: (s) => {
        if (s.loading && s.article === undefined)
          return missing("зарежда се…", "loading…");
        const a = s.article?.analysis;
        const text = a
          ? language === "en"
            ? a.summary_en
            : a.summary_bg
          : null;
        return text ? (
          <p className="text-sm leading-relaxed">{text}</p>
        ) : (
          missing(
            "Материалът още не е оценен — няма обобщение.",
            "Not yet assessed — no summary.",
          )
        );
      },
    },
    {
      id: "quotes",
      label: tr("Цитирани откъси", "Cited spans"),
      render: (s) => {
        const quotes = citedQuotesFor(synthesis, s.member.url);
        const shown = quotes.slice(0, QUOTES_SHOWN);
        return quotes.length ? (
          <ul className="space-y-1 text-sm">
            {shown.map((q) => (
              <li key={q}>
                <q lang={s.article?.language ?? "bg"}>{q}</q>
              </li>
            ))}
            {quotes.length > shown.length ? (
              <li className="text-xs text-muted-foreground">
                {tr(
                  `+ още ${quotes.length - shown.length} в обобщението по-горе`,
                  `+ ${quotes.length - shown.length} more in the synthesis above`,
                )}
              </li>
            ) : null}
          </ul>
        ) : (
          missing(
            "Обобщението на историята не цитира този материал.",
            "The story synthesis cites nothing from this article.",
          )
        );
      },
    },
    {
      id: "leaning",
      label: tr("Политическо рамкиране", "Political framing"),
      render: (s) =>
        s.member.leaning ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <LeanBadge leaning={s.member.leaning} />
            {/* T4.1c — a scoped observation is not comparable at full
                strength with a full read's badge beside it. */}
            <ScopeMark member={s.member} />
          </span>
        ) : (
          missing("не е оценено", "not assessed")
        ),
    },
    {
      id: "russia",
      label: tr("Позиция спрямо Русия", "Stance toward Russia"),
      render: (s) =>
        s.member.russia_stance ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <StanceBadge stance={s.member.russia_stance} />
            <ScopeMark member={s.member} />
          </span>
        ) : (
          missing("не е оценено", "not assessed")
        ),
    },
  ];

  return (
    <section
      aria-labelledby="story-compare-heading"
      className="mt-4 space-y-3"
      data-testid="story-compare"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="story-compare-heading" className="text-sm font-semibold">
          {tr(
            `Сравнение на ${sources.length} източника`,
            `Comparing ${sources.length} sources`,
          )}
        </h3>
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          {tr("Изчисти сравнението", "Clear the comparison")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {tr(
          "Поле по поле, по данни на всеки източник. Жанр и отношение към лица не се показват: корпусът не носи жанр, а оценката на лица още не е пусната.",
          "Field by field, as each source published it. Genre and person treatment are not shown: the corpus carries no genre, and person assessment has not shipped.",
        )}
      </p>

      {/* Desktop: sources across, fields down; the source cells stick to the
          PAGE scroll — no overflow wrapper, which would become the scroll
          container and pin nothing (the table is w-full and wraps). */}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 z-10 w-40 bg-background py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {tr("Поле", "Field")}
              </th>
              {sources.map((s) => (
                <th
                  key={s.key}
                  scope="col"
                  className="sticky top-0 z-10 bg-background py-2 pr-3 text-left font-semibold"
                >
                  {name(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className="border-t align-top">
                <th
                  scope="row"
                  className="py-2 pr-3 text-left text-xs font-medium text-muted-foreground"
                >
                  {f.label}
                </th>
                {sources.map((s) => (
                  <td key={s.key} className="py-2 pr-3">
                    {f.render(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one stack per source, the source label sticks while its
          fields scroll — the same fields in the same order. */}
      <div className="space-y-4 md:hidden" data-testid="story-compare-stack">
        {sources.map((s) => (
          <section key={s.key} aria-label={name(s)}>
            <h4 className="sticky top-0 z-10 border-b bg-background py-1 text-sm font-semibold">
              {name(s)}
            </h4>
            <dl className="mt-2 space-y-2">
              {fields.map((f) => (
                <div key={f.id}>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {f.label}
                  </dt>
                  <dd className="mt-0.5">{f.render(s)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </section>
  );
};
