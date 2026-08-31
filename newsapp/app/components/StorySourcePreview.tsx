import type { Outlet } from "../data";
import { selectStorySources } from "./storySourceSelection";

const publicationLabel = (count: number): string =>
  `${count} ${count === 1 ? "публикация" : "публикации"}`;

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

  const visibleNames = preview.visible.map((source) => source.label);
  const duplicateCount = articleCount > preview.total;
  return (
    <p
      className={`min-w-0 max-w-full break-words text-xs font-medium text-muted-foreground [overflow-wrap:anywhere] ${className}`}
    >
      <span className="sr-only">Източници: </span>
      {visibleNames.map((name, index) => (
        <span key={preview.visible[index]?.domain}>
          {index ? (
            <>
              <span aria-hidden> · </span>
              <span className="sr-only">, </span>
            </>
          ) : null}
          {name}
        </span>
      ))}
      {preview.remaining ? (
        <>
          <span aria-hidden>
            <span> · </span>
            <span>+{preview.remaining} още</span>
          </span>
          <span className="sr-only">, и още {preview.remaining} медии</span>
        </>
      ) : null}
      {duplicateCount ? (
        <>
          <span aria-hidden>
            <span> · </span>
            <span>{publicationLabel(articleCount)}</span>
          </span>
          <span className="sr-only">
            ; общо {publicationLabel(articleCount)}
          </span>
        </>
      ) : null}
    </p>
  );
};
