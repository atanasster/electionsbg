import { formatDate } from "../labels";
import { useNewsLocale } from "../i18n";
import type { AxisCompleteness } from "../aggregateCompleteness";

export const AggregateCompleteness = ({
  completeness,
  generatedAt,
}: {
  completeness: AxisCompleteness;
  generatedAt: string | null | undefined;
}) => {
  const { language, tr } = useNewsLocale();
  return (
    <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <strong className="font-semibold text-foreground">
          {tr("Оценени", "Assessed")} {completeness.assessed}/
          {completeness.total}
        </strong>
        <span>
          {completeness.outlets} {tr("източника", "outlets")}
        </span>
        <span>
          {completeness.positioned} {tr("в спектъра", "on the spectrum")}
        </span>
        <span>
          {completeness.notApplicable} {tr("извън обхвата", "not applicable")}
        </span>
        <span>
          {completeness.unavailable} {tr("без стойност", "without a value")}
        </span>
      </div>
      <p className="mt-2 leading-relaxed">
        {tr("Рубрика", "Rubric")}: news-article-evaluation-v1 ·{" "}
        {tr("обобщено", "aggregated")} {formatDate(generatedAt, language)} ·{" "}
        {tr(
          "редакционният статус е достъпен във всяка отделна статия",
          "editorial status is available on each individual article",
        )}
      </p>
    </div>
  );
};
