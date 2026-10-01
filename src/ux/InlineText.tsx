import { Fragment, type ReactNode } from "react";
import { parseInline } from "@/lib/inlineMarkup";

const linkClass =
  "text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent transition-colors";

/** The React half of `src/lib/inlineMarkup.ts`: plain text with `[label](href)` links. */
export const InlineText = ({ text }: { text: string }): ReactNode =>
  parseInline(text).map((r, i) =>
    r.href ? (
      <a
        key={i}
        href={r.href}
        className={linkClass}
        {...(r.href.startsWith("http")
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {r.text}
      </a>
    ) : (
      <Fragment key={i}>{r.text}</Fragment>
    ),
  );
