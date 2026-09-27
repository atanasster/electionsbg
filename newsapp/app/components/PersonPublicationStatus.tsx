// The methodology page's statement of the person surfaces' state
// (news-person-sentiment-v1 §8.2, §9): the election windows still ahead, with
// their dates, and whether the accuracy check has passed — including its
// agreement arm, which is published as unmet rather than left out.

import { sofiaDateTime } from "@/lib/sofiaDateTime";
import { usePersonPublication } from "../data";
import { useNewsLocale } from "../i18n";

export const PersonPublicationStatus = () => {
  const { isEnglish, tr } = useNewsLocale();
  const { data } = usePersonPublication();
  if (!data) return null;
  const locale = isEnglish ? "en-GB" : "bg-BG";
  const g = data.gate;
  const gateText = g.passed
    ? tr(
        "Проверката на точността спрямо човешки оценки е преминала.",
        "The accuracy check against human labels has passed.",
      )
    : g.passed_without_agreement
      ? tr(
          "Проверката на точността е преминала без едно условие: съгласието между двама независими оценители още не е достатъчно.",
          "The accuracy check has passed except for one condition: agreement between two independent annotators is not yet sufficient.",
        )
      : tr(
          `Проверката на точността спрямо човешки оценки още не е преминала (${g.test_pairs ?? 0} оценени двойки).`,
          `The accuracy check against human labels has not passed yet (${g.test_pairs ?? 0} labelled pairs).`,
        );
  return (
    <div className="mt-3 space-y-2" data-testid="person-publication-status">
      {data.freezes.length ? (
        <ul className="list-disc pl-5">
          {data.freezes.map((f) => (
            <li key={f.id}>
              {sofiaDateTime(f.from, locale)} – {sofiaDateTime(f.until, locale)}
              {f.status === "estimated"
                ? tr(
                    " (очаквана дата — ще бъде уточнена с указа за изборите)",
                    " (estimated — to be fixed by the election decree)",
                  )
                : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p>{gateText}</p>
    </div>
  );
};
