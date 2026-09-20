// Entity chips, with a link where the name earned one.
//
// ⚠️ A CHIP HAS THREE STATES, not two: resolved (a link), OFFERED (a menu of
// the entries the name might mean), and plain text. The middle one is not a
// weaker link — it is the refusal made useful. „Аспарухово" is a район of
// Варна and four villages; we still will not pick, but a reader who has just
// read the story can, and the menu says so in words.
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
// these pages are on naiasno.bg, so the hrefs are absolute and these are
// plain <a> elements — react-router's <Link> would try to route them inside
// this app. `rel="noreferrer"` and not `target="_blank"`: a reader following
// a person is continuing the same task, not opening a side quest.
//
// ⚠️ THE HREF GOES THROUGH `mainSiteUrl`, never used raw. A release published
// before the rebrand is immutable and still served, and carries the retired
// host; rewriting on the way out is what spares every such release a
// republish — and what keeps both vintages on one domain.

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EntityCandidate, EntityLink } from "../data";
import { useNewsLocale } from "../i18n";
import { MAIN_SITE_LABEL, mainSiteUrl } from "../site";

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

/**
 * A name we refused to resolve, rendered as the CHOICE we would not make.
 *
 * ⚠️⚠️ THE COPY MAY NOT ASSERT, and this is the whole risk of the feature.
 * „Виж профила" over a list we did not verify turns a refusal into a claim by
 * wording alone. The trigger says „възможни съвпадения" and the menu header
 * says in words that the article's own name was not resolved — so a reader
 * who picks wrong knows it was their pick.
 *
 * ⚠️ NOT the resolved affordance. A dotted underline means „this is who this
 * is" everywhere else in this component; reusing it here would make an offer
 * look like a resolution at a glance, which is the only glance most readers
 * give it.
 *
 * ⚠️ `modal={false}` — a modal Radix menu locks body scroll, which strands a
 * reader mid-article on touch.
 */
const EntityCandidateChip = ({
  name,
  candidates,
  isEnglish,
  tr,
}: {
  name: string;
  candidates: EntityCandidate[];
  isEnglish: boolean;
  tr: (bg: string, en: string) => string;
}) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={tr(
          `${candidates.length} възможни съвпадения — изберете кое имате предвид`,
          `${candidates.length} possible matches — choose which one you mean`,
        )}
      >
        <Badge
          variant="outline"
          className="font-normal border-dashed hover:bg-primary/10 hover:text-primary"
        >
          {name}
          <span aria-hidden className="pl-1 text-muted-foreground">
            ·{candidates.length}
          </span>
          <span className="sr-only">
            {" "}
            — {tr("възможни съвпадения", "possible matches")}
          </span>
        </Badge>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-w-[20rem]">
      <DropdownMenuLabel className="whitespace-normal text-xs font-normal text-muted-foreground">
        {tr(
          `Името „${name}" съвпада с ${candidates.length} записа. Не избираме вместо вас — изберете кой имате предвид.`,
          `The name „${name}" matches ${candidates.length} entries. We do not pick for you — choose the one you mean.`,
        )}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {candidates.map((candidate) => (
        <DropdownMenuItem key={candidate.id} asChild>
          {/* Cross-origin, like a resolved chip — a plain <a>, never a
              router <Link>. */}
          <a
            href={mainSiteUrl(candidate.href, isEnglish)}
            rel="noreferrer"
            className="flex-col items-start gap-0"
          >
            <span>{candidate.canonical}</span>
            {candidate.detail ? (
              <span className="text-xs text-muted-foreground">
                {candidate.detail}
              </span>
            ) : null}
          </a>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export const EntityChips = ({
  title,
  names,
  links,
  candidates,
  inline = false,
}: {
  title: string;
  names: string[];
  links?: Record<string, EntityLink>;
  /**
   * name → the entries it MIGHT mean. Disjoint from `links` by construction
   * server-side; a name present in both is rendered as the LINK, because a
   * resolution outranks an offer.
   */
  candidates?: Record<string, EntityCandidate[]>;
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
          const offered = link ? undefined : candidates?.[name];
          if (!link && offered?.length) {
            return (
              <EntityCandidateChip
                key={name}
                name={name}
                candidates={offered}
                isEnglish={isEnglish}
                tr={tr}
              />
            );
          }
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
              href={mainSiteUrl(link.href, isEnglish)}
              rel="noreferrer"
              title={
                differs
                  ? `${link.canonical} — ${(isEnglish ? KIND_LABEL_EN : KIND_LABEL)[link.kind]} ${tr("в", "on")} ${MAIN_SITE_LABEL}`
                  : `${(isEnglish ? KIND_LABEL_EN : KIND_LABEL)[link.kind]} ${tr("в", "on")} ${MAIN_SITE_LABEL}`
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
