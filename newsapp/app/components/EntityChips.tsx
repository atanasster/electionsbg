// Entity chips, with a link where the name earned one.
//
// ⚠️ A CHIP IS A LINK ONLY WHEN THE GAZETTEER RESOLVED IT OUTRIGHT OR A
// hand-verified entity override resolved it after the model classified its
// bucket. The `entity_links` sidecar carries only names whose main-site route
// is actually served; everything else stays plain text. A chip that looked
// like a link and went nowhere would be worse than no link at all.
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
import { useNewsLocale } from "../i18n";

const ENTITY_CHIP_LIMIT = 8;

const KIND_LABEL: Record<EntityLink["kind"], string> = {
  person: "профил",
  party: "партия",
  institution: "институция",
  company: "фирма",
  place: "населено място",
};
const KIND_LABEL_EN: Record<EntityLink["kind"], string> = {
  person: "profile",
  party: "party",
  institution: "institution",
  company: "company",
  place: "place",
};

const localizedMainHref = (href: string, isEnglish: boolean): string => {
  if (!isEnglish) return href;
  try {
    const url = new URL(href);
    if (
      url.hostname !== "electionsbg.com" ||
      /^\/en(?:\/|$)/.test(url.pathname)
    )
      return href;
    url.pathname = `/en${url.pathname === "/" ? "" : url.pathname}`;
    return url.toString();
  } catch {
    return href;
  }
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
  const { isEnglish, tr } = useNewsLocale();
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
              href={localizedMainHref(link.href, isEnglish)}
              rel="noreferrer"
              title={
                differs
                  ? `${link.canonical} — ${(isEnglish ? KIND_LABEL_EN : KIND_LABEL)[link.kind]} ${tr("в", "on")} electionsbg.com`
                  : `${(isEnglish ? KIND_LABEL_EN : KIND_LABEL)[link.kind]} ${tr("в", "on")} electionsbg.com`
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
