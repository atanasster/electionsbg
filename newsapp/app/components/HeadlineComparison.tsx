import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { StoryMember } from "../data";
import { useNewsLocale } from "../i18n";
import {
  distinctiveHeadlineTerms,
  headlineWordParts,
  normalizeHeadlineWord,
} from "../headlineDifferences";

const HighlightedHeadline = ({
  headline,
  distinctive,
}: {
  headline: string;
  distinctive: Set<string>;
}) => (
  <>
    {headline.split(headlineWordParts).map((part, index) =>
      distinctive.has(normalizeHeadlineWord(part)) ? (
        <mark
          // Repeated words need their position as well as their text.
          key={`${part}-${index}`}
          className="rounded-sm bg-accent/20 px-0.5 text-foreground"
        >
          {part}
        </mark>
      ) : (
        part
      ),
    )}
  </>
);

export const HeadlineComparison = ({
  members,
  outletNames,
}: {
  members: StoryMember[];
  outletNames: Map<string, string>;
}) => {
  const { tr } = useNewsLocale();
  const distinctive = distinctiveHeadlineTerms(
    members.map((member) => member.title),
  );

  return (
    <CardLikeList>
      <p className="border-b px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {tr(
          "Подсветени са до шест думи, които се срещат само в едно заглавие. Това е лексикална разлика, не оценка за пристрастие.",
          "Up to six words found in only one headline are highlighted. This is a lexical difference, not a bias judgment.",
        )}
      </p>
      <ol className="divide-y">
        {members.map((member, index) => {
          const headline = member.title ?? tr("Без заглавие", "Untitled");
          const content = (
            <HighlightedHeadline
              headline={headline}
              distinctive={distinctive[index]}
            />
          );
          return (
            <li
              key={`${member.domain}/${member.article_id ?? member.url}`}
              className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
            >
              <span className="text-xs font-semibold text-muted-foreground sm:text-sm">
                {outletNames.get(member.domain) ?? member.domain}
              </span>
              {member.article_id ? (
                <Link
                  to={`/article/${member.domain}/${member.article_id}`}
                  className="font-medium leading-snug underline-offset-4 hover:text-primary hover:underline"
                >
                  {content}
                </Link>
              ) : member.url ? (
                <a
                  href={member.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium leading-snug underline-offset-4 hover:text-primary hover:underline"
                >
                  {content}
                </a>
              ) : (
                <span className="font-medium leading-snug">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </CardLikeList>
  );
};

const CardLikeList = ({ children }: { children: ReactNode }) => (
  <div className="overflow-hidden rounded-xl border bg-card">{children}</div>
);
