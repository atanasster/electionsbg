import type { Outlet } from "../data";
import { selectStorySources } from "./storySourceSelection";

const publicationLabel = (count: number): string =>
  `${count} ${count === 1 ? "публикация" : "публикации"}`;

const visibleSourceText = (
  visible: Array<{ domain: string; label: string }>,
  remaining: number,
  articleCount: number,
  duplicateCount: boolean,
) => (
  <>
    {visible.map((source, index) => (
      <span key={source.domain}>
        {index ? <span aria-hidden> · </span> : null}
        {source.label}
      </span>
    ))}
    {remaining ? <span aria-hidden> · +{remaining} още</span> : null}
    {duplicateCount ? (
      <span aria-hidden> · {publicationLabel(articleCount)}</span>
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
        )}
      </span>
      <span className="hidden sm:inline" aria-hidden>
        {visibleSourceText(
          preview.visible,
          preview.remaining,
          articleCount,
          duplicateCount,
        )}
      </span>
      <span className="sr-only">
        <span>Източници:</span>{" "}
        {preview.visible.map((source) => source.label).join(", ")}
        {preview.remaining ? (
          <span>, и още {preview.remaining} медии</span>
        ) : null}
        {duplicateCount ? (
          <span>; общо {publicationLabel(articleCount)}</span>
        ) : null}
      </span>
    </p>
  );
};
