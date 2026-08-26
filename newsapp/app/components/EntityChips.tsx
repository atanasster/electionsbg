// Entity chips, with a link where the name earned one.
//
// ⚠️ A CHIP IS A LINK ONLY WHEN THE GAZETTEER RESOLVED IT OUTRIGHT. The
// `entity_links` sidecar carries a name only when it produced a
// `gazetteer_exact` match against a route the main site actually serves —
// everything else stays plain text. A chip that looked like a link and went
// nowhere would be worse than no link at all.
//
// ⚠️ THE CANONICAL NAME IS SHOWN, and that is not decoration. All eight
// people this resolves today matched on a TWO-PART form („Иван Христанов" →
// Иван Маркос Христанов), which is how newsrooms write them and is unique
// among public figures — but the reader is the last check, and they can only
// perform it if they can see who we think it is. It rides in the `title`,
// and for a person it is also announced to a screen reader.
//
// ⚠️ CROSS-ORIGIN, deliberately: the news app is news.electionsbg.com and
// these pages are on electionsbg.com, so the hrefs are absolute and these
// are plain <a> elements — react-router's <Link> would try to route them
// inside this app. `rel="noreferrer"` and not `target="_blank"`: a reader
// following a person is continuing the same task, not opening a side quest.

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import type { EntityLink } from "../data";

const ENTITY_CHIP_LIMIT = 8;

const KIND_LABEL: Record<EntityLink["kind"], string> = {
  person: "профил",
  party: "партия",
  institution: "възложител",
  place: "населено място",
};

export const EntityChips = ({
  title,
  names,
  links,
  inline = false,
}: {
  title: string;
  names: string[];
  links?: Record<string, EntityLink>;
  /** No heading and no cap — the article page groups them by its own label. */
  inline?: boolean;
}) => {
  if (!names.length) return null;
  const shown = inline ? names : names.slice(0, ENTITY_CHIP_LIMIT);
  const Wrapper = inline ? Fragment : "div";
  return (
    <Wrapper {...(inline ? {} : {})}>
      {inline ? null : (
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      )}
      <div className={inline ? "contents" : "flex flex-wrap gap-1.5"}>
        {shown.map((name) => {
          const link = links?.[name];
          if (!link) {
            return (
              <Badge key={name} variant="secondary" className="font-normal">
                {name}
              </Badge>
            );
          }
          const differs = link.canonical && link.canonical !== name;
          return (
            <a
              key={name}
              href={link.href}
              rel="noreferrer"
              title={
                differs
                  ? `${link.canonical} — ${KIND_LABEL[link.kind]} в electionsbg.com`
                  : `${KIND_LABEL[link.kind]} в electionsbg.com`
              }
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Badge
                variant="secondary"
                className="font-normal underline decoration-dotted underline-offset-2 hover:bg-primary/10 hover:text-primary"
              >
                {name}
                {/* ⚠️ The registry's own spelling, for a screen reader and
                    for anyone who cannot hover. A silent link to „Иван
                    Маркос Христанов" under the text „Иван Христанов" is a
                    claim the reader cannot check. */}
                {differs ? (
                  <span className="sr-only"> — {link.canonical}</span>
                ) : null}
              </Badge>
            </a>
          );
        })}
        {!inline && names.length > ENTITY_CHIP_LIMIT ? (
          <Badge variant="outline" className="text-muted-foreground">
            +{names.length - ENTITY_CHIP_LIMIT}
          </Badge>
        ) : null}
      </div>
    </Wrapper>
  );
};
