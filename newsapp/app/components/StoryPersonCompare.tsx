// „Как всяко издание в тази история представя X" (news-person-sentiment-v1 §7).
// Only when at least two outlets in the story scored the same person — one
// outlet cannot be compared with anything.

import { useState } from "react";
import { Link } from "react-router-dom";
import { PackSelect } from "@/screens/components/procurement/PackSelect";
import { usePersonsIndex, type StoryMember } from "../data";
import { isNewsPersonId } from "../newsPersonId";
import { toneMeta } from "../labels";
import { useNewsLocale } from "../i18n";
import { personReadings, storyPeople } from "../storyPersons";

export const StoryPersonCompare = ({ members }: { members: StoryMember[] }) => {
  const { language, tr } = useNewsLocale();
  const people = storyPeople(members).filter((p) => p.outlets >= 2);
  const [chosen, setChosen] = useState<string | null>(null);
  // A person is LINKED only when they have a page — the rail's rule. The
  // story carries every identified person, published or not.
  const index = usePersonsIndex();
  if (!people.length) return null;
  const id =
    chosen && people.some((p) => p.id === chosen) ? chosen : people[0].id;
  const person = people.find((p) => p.id === id)!;
  const { outlets, state } = personReadings(members, id);
  const verdict =
    state === "distribution"
      ? tr(
          "Изданията го представят различно.",
          "The outlets frame them differently.",
        )
      : state === "uniform"
        ? tr("Изданията го представят сходно.", "The outlets frame them alike.")
        : tr("Само един източник.", "One source only.");
  return (
    <section
      aria-labelledby="story-person"
      data-testid="story-person-compare"
      className="mt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="story-person" className="text-sm font-medium">
          {tr("Как всяко издание представя", "How each outlet frames")}
        </h3>
        <PackSelect
          ariaLabel={tr("Лице", "Person")}
          value={id}
          onChange={setChosen}
          options={people.map((p) => ({ value: p.id, label: p.name }))}
          align="start"
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {verdict}{" "}
        {tr(
          "Оценката е за текста, не за човека; сходното представяне не е съгласие по фактите.",
          "The rating is of the text, not the person; alike framing is not agreement on facts.",
        )}{" "}
        {isNewsPersonId(id) && index.data?.persons.some((p) => p.id === id) ? (
          <Link
            to={`/person/${id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {person.name}
          </Link>
        ) : null}
      </p>
      <ul className="mt-2 divide-y text-sm">
        {outlets.map((o) => (
          <li
            key={o.domain}
            className="flex flex-wrap items-baseline justify-between gap-2 py-1.5"
          >
            <span>{o.domain}</span>
            <span className="flex flex-wrap gap-2">
              {o.rows.map(({ member, bucket }) => (
                <Link
                  key={`${member.article_id}-${member.published}`}
                  to={
                    member.article_id
                      ? `/article/${member.domain}/${member.article_id}`
                      : "#"
                  }
                  className={`text-xs underline-offset-4 hover:underline ${toneMeta(bucket, language).className}`}
                >
                  {toneMeta(bucket, language).label}
                </Link>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
