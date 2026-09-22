// T4.1c — the mark a SCOPED OBSERVATION carries wherever a member's framing
// badge is shown outside its own page (the timeline rail, the comparison
// table). The story bar excludes such a member; its badge three lines lower
// must not look like a full-strength verdict beside a full read's.

import { isScopedObservation, type StoryMember } from "../data";
import { useNewsLocale } from "../i18n";

export const ScopeMark = ({
  member,
}: {
  member: Pick<StoryMember, "text_scope">;
}) => {
  const { tr } = useNewsLocale();
  if (!isScopedObservation(member)) return null;
  const prefix = member.text_scope === "prefix";
  return (
    <span
      className="rounded-full border border-dashed px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      title={
        prefix
          ? tr(
              "Оценено върху началото на текста, не върху целия материал; не влиза в разпределенията.",
              "Assessed on the start of the text, not the whole article; enters no distribution.",
            )
          : tr(
              "Обхватът на прочетения текст не е записан; не влиза в разпределенията.",
              "The extent of the text read is not recorded; enters no distribution.",
            )
      }
      data-testid="scope-mark"
    >
      {prefix
        ? tr("частично", "partial")
        : tr("незаписан обхват", "unrecorded scope")}
    </span>
  );
};
