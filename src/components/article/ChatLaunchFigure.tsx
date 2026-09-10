import annotations from "./chatLaunchAnnotations.json";

type FigureId = keyof typeof annotations;

// Annotations are HTML outside the unchanged screenshot. A full-size link
// preserves access to the original UI text when the article is read on a phone.
export const ChatLaunchFigure = ({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) => {
  const match = src.match(
    /\/articles\/images\/chat-launch\/(start|budget|followup|limits)-(bg|en)\.(?:png|webp)$/,
  );
  if (!match) return null;
  const id = match[1] as FigureId;
  const lang = match[2] as "bg" | "en";
  const notes = annotations[id][lang];
  return (
    <span role="figure" aria-label={alt} className="my-6 block max-w-[800px]">
      <span className="relative block pl-8">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={
            lang === "bg"
              ? "Отвори снимката в пълен размер"
              : "Open screenshot at full size"
          }
        >
          <img
            src={src}
            alt={alt}
            width={800}
            height={id === "limits" ? 1200 : 1024}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded border"
          />
        </a>
        {notes.map(([y], i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{ top: `${y}%` }}
            className="absolute left-0 flex size-6 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
          >
            {i + 1}
          </span>
        ))}
      </span>
      <span role="list" className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        {notes.map(([, title, description], i) => (
          <span role="listitem" key={i} className="block">
            <strong>
              {i + 1}. {title}
            </strong>
            <span className="block text-muted-foreground">{description}</span>
          </span>
        ))}
      </span>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {lang === "bg" ? "Отвори в пълен размер" : "Open full size"}
      </a>
    </span>
  );
};
