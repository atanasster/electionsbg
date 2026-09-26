import { Link } from "react-router-dom";
import { useEffect, useRef, type ReactNode } from "react";
import type { StoryMember } from "../data";
import { useNewsLocale } from "../i18n";
import {
  distinctiveHeadlineTerms,
  headlineWordParts,
  normalizeHeadlineWord,
} from "../headlineDifferences";
import { emitNewsEvent } from "../analytics";
import { memberKey } from "../storyCompare";

const recordComparisonOpen = () =>
  emitNewsEvent({
    name: "reader_task",
    task: "compare_coverage",
    signal: "completed",
  });

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

/**
 * T5.8 — the selection that makes comparison an action. Keyed by
 * `memberKey`; a member with no article page is not selectable (nothing to
 * align). A fourth pick is refused, and the checkbox says so.
 */
export interface CompareSelection {
  selected: string[];
  max: number;
  onToggle: (key: string) => void;
}

export const HeadlineComparison = ({
  members,
  outletNames,
  selection,
}: {
  members: StoryMember[];
  outletNames: Map<string, string>;
  selection?: CompareSelection;
}) => {
  const { tr } = useNewsLocale();
  const recordedMembers = useRef<StoryMember[] | null>(null);
  const hasComparison = members.length >= 2;
  useEffect(() => {
    if (recordedMembers.current === members) return;
    recordedMembers.current = members;
    emitNewsEvent({
      name: "reader_outcome",
      task: "comparison",
      outcome: hasComparison ? "available" : "unavailable",
    });
  }, [hasComparison, members]);
  const distinctive = distinctiveHeadlineTerms(
    members.map((member) => member.title),
  );
  // An empty highlight set does not prove equality: the word filter omits
  // short words (including negation), numbers and punctuation.
  const headlines = members.map((member) =>
    member.title?.normalize("NFC").replace(/\s+/gu, " ").trim(),
  );
  const complete = headlines.every(Boolean);
  const identical =
    hasComparison &&
    complete &&
    headlines.every((title) => title === headlines[0]);
  const hasHighlights = distinctive.some((terms) => terms.size > 0);
  const explanation = !hasComparison
    ? tr(
        "Няма второ заглавие за сравнение.",
        "There is no second headline to compare.",
      )
    : !complete
      ? tr(
          "Липсват заглавия за част от публикациите. Сравнението на заглавията е непълно.",
          "Some publications have no available headline. The headline comparison is incomplete.",
        )
      : identical
        ? tr(
            "Заглавията са еднакви. Това сравнение обхваща само заглавията.",
            "The headlines are identical. This comparison covers headlines only.",
          )
        : hasHighlights
          ? tr(
              "Във всяко заглавие са откроени до шест думи, които не се срещат в останалите заглавия. Това показва разлики в думите, а не оценка за пристрастност.",
              "Up to six words unique to each headline are highlighted. This shows differences in wording, not a bias assessment.",
            )
          : tr(
              "Заглавията се различават, но няма думи за открояване по използваното правило.",
              "The headlines differ, but no words meet the highlighting rule.",
            );

  return (
    <CardLikeList>
      <p className="border-b px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {explanation}
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
          const key = memberKey(member);
          const checked = Boolean(key && selection?.selected.includes(key));
          const full = Boolean(
            selection && selection.selected.length >= selection.max && !checked,
          );
          return (
            <li
              key={`${member.domain}/${member.article_id ?? member.url}`}
              className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
            >
              {selection && key ? (
                // The visible outlet name IS the label: clicking it toggles,
                // and the cap's reason is printed, not only announced.
                <label
                  className={`flex cursor-pointer items-start gap-2 text-xs font-semibold text-muted-foreground sm:text-sm ${full ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    checked={checked}
                    disabled={full}
                    onChange={() => selection.onToggle(key)}
                  />
                  <span>
                    <span className="sr-only">{tr("Сравни", "Compare")}:</span>{" "}
                    {outletNames.get(member.domain) ?? member.domain}
                    {full ? (
                      <>
                        {" "}
                        <span className="font-normal">
                          (
                          {tr(
                            `най-много ${selection.max}`,
                            `at most ${selection.max}`,
                          )}
                          )
                        </span>
                      </>
                    ) : null}
                  </span>
                </label>
              ) : (
                <span className="text-xs font-semibold text-muted-foreground sm:text-sm">
                  {outletNames.get(member.domain) ?? member.domain}
                </span>
              )}
              {member.article_id ? (
                <Link
                  to={`/article/${member.domain}/${member.article_id}`}
                  onClick={recordComparisonOpen}
                  className="font-medium leading-snug underline-offset-4 hover:text-primary hover:underline"
                >
                  {content}
                </Link>
              ) : member.url ? (
                <a
                  href={member.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={recordComparisonOpen}
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
