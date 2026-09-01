import type { Outlet } from "../data";
import { selectStorySources } from "./storySourceSelection";
import type { NewsLanguage } from "../i18n";
import { useNewsLocale } from "../i18n";

const publicationLabel = (count: number, language: NewsLanguage): string =>
  `${count} ${
    language === "en"
      ? count === 1
        ? "publication"
        : "publications"
      : count === 1
        ? "публикация"
        : "публикации"
  }`;

const visibleSourceText = (
  visible: Array<{ domain: string; label: string }>,
  remaining: number,
  articleCount: number,
  duplicateCount: boolean,
  language: NewsLanguage,
) => (
  <>
    {visible.map((source, index) => (
      <span key={source.domain}>
        {index ? <span aria-hidden> · </span> : null}
        {source.label}
      </span>
    ))}
    {remaining ? (
      <span aria-hidden>
        {language === "en" ? ` · +${remaining} more` : ` · +${remaining} още`}
      </span>
    ) : null}
    {duplicateCount ? (
      <span aria-hidden> · {publicationLabel(articleCount, language)}</span>
    ) : null}
  </>
);

export const StorySourcePreview = ({
  byDomain,
  articleCount,
  outlets,
  limit = 2,
  className = "",
}: {
  byDomain: Record<string, number>;
  articleCount: number;
  outlets: readonly Outlet[];
  limit?: number;
  className?: string;
}) => {
  const { language, tr } = useNewsLocale();
  const preview = selectStorySources(byDomain, outlets, limit);
  if (!preview.total) return null;

  const mobilePreview = selectStorySources(byDomain, outlets, 1);
  const duplicateCount = articleCount > preview.total;
  return (
    <p
      className={`min-w-0 max-w-full break-words text-xs font-medium text-muted-foreground [overflow-wrap:anywhere] ${className}`}
    >
      <span className="sm:hidden" aria-hidden>
        {visibleSourceText(
          mobilePreview.visible,
          mobilePreview.remaining,
          articleCount,
          duplicateCount,
          language,
        )}
      </span>
      <span className="hidden sm:inline" aria-hidden>
        {visibleSourceText(
          preview.visible,
          preview.remaining,
          articleCount,
          duplicateCount,
          language,
        )}
      </span>
      <span className="sr-only">
        <span>{tr("Източници:", "Sources:")}</span>{" "}
        {preview.visible.map((source) => source.label).join(", ")}
        {preview.remaining ? (
          <span>
            {tr(
              `, и още ${preview.remaining} медии`,
              `, and ${preview.remaining} more outlets`,
            )}
          </span>
        ) : null}
        {duplicateCount ? (
          <span>
            {tr("; общо", "; total")} {publicationLabel(articleCount, language)}
          </span>
        ) : null}
      </span>
    </p>
  );
};
