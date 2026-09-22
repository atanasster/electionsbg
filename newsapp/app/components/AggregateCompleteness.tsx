// T5.4 — one completeness sentence, ONCE per page, with the granular
// breakdown behind an accessible <details> disclosure. Axis-agnostic: the
// caller passes each axis with its label, and OWNS the disclosure state so a
// single strip serves every axis on the page. The "distinct assessed
// domains" definition (`axisCompleteness`) is unchanged — `outlets` here
// counts any verdict, `not_applicable` included, and is deliberately NOT the
// divergence rule's positioned-outlet count.

import { formatDate } from "../labels";
import { useNewsLocale } from "../i18n";
import type { AxisCompleteness } from "../aggregateCompleteness";
import { articleNoun, assessedVerb } from "../plural";

export const COMPLETENESS_RUBRIC_ID = "news-article-evaluation-v1";

export interface CompletenessAxis {
  key: string;
  /** The axis as the reader sees it beside its bar. */
  label: string;
  completeness: AxisCompleteness;
}

/**
 * The one sentence. Exported so the rule can be tested without a render.
 * ⚠️ `total` is read per axis: every caller today derives its axes from one
 * member list, but the component is axis-agnostic, and a second total must
 * not be printed under the first one's denominator.
 */
export const completenessSentence = (
  axes: CompletenessAxis[],
  tr: <T>(bg: T, en: T) => T,
): string => {
  const total = axes[0]?.completeness.total ?? 0;
  if (axes.length === 0 || total === 0) {
    return tr("Няма оценени материали.", "No article has been assessed.");
  }
  const assessed = axes.map((a) => a.completeness.assessed);
  const sameTotal = axes.every((a) => a.completeness.total === total);
  const allComplete = sameTotal && assessed.every((n) => n === total);
  if (allComplete) {
    return total === 1
      ? tr("Оценен е единственият материал.", "The only article is assessed.")
      : total === 2
        ? tr("Оценени са и двата материала.", "Both articles are assessed.")
        : tr(
            `Оценени са всички ${total} материала.`,
            `All ${total} articles are assessed.`,
          );
  }
  const same = sameTotal && assessed.every((n) => n === assessed[0]);
  if (same) {
    const n = assessed[0];
    if (n === 0) {
      // A zero is said as an absence, not as an affirmative claim about zero.
      return tr(
        `Нито един от ${total} ${articleNoun(total, "bg")} не е оценен.`,
        `None of the ${total} ${articleNoun(total, "en")} is assessed.`,
      );
    }
    return tr(
      `${assessedVerb(n, "bg")} ${n} от ${total} ${articleNoun(total, "bg")}.`,
      `${n} of ${total} ${articleNoun(total, "en")} ${assessedVerb(n, "en")} assessed.`,
    );
  }
  // The axes differ: keep the per-axis counts ADJACENT, in one sentence —
  // „Оценен е 1 от 3 материала по X и 2 от 3 по Y." The verb follows the
  // first figure; each axis carries its own denominator.
  const [first, ...rest] = axes;
  const bg = [
    `${first.completeness.assessed} от ${first.completeness.total} ${articleNoun(first.completeness.total, "bg")} по ${first.label}`,
    ...rest.map(
      (a) =>
        `${a.completeness.assessed} от ${a.completeness.total} по ${a.label}`,
    ),
  ].join(" и ");
  const en = [
    `${first.completeness.assessed} of ${first.completeness.total} ${articleNoun(first.completeness.total, "en")} on ${first.label}`,
    ...rest.map(
      (a) =>
        `${a.completeness.assessed} of ${a.completeness.total} on ${a.label}`,
    ),
  ].join(" and ");
  return tr(
    `${assessedVerb(first.completeness.assessed, "bg")} ${bg}.`,
    `Assessed: ${en}.`,
  );
};

export const AggregateCompleteness = ({
  axes,
  generatedAt,
  open,
  onToggle,
}: {
  axes: CompletenessAxis[];
  generatedAt: string | null | undefined;
  /**
   * Owned by the page — one disclosure for every axis it carries. React
   * writes the `open` attribute only when this prop CHANGES, so the owner
   * can reset it (story change) but cannot veto a native toggle; `onToggle`
   * must always be accepted.
   */
  open: boolean;
  onToggle: (open: boolean) => void;
}) => {
  const { language, tr } = useNewsLocale();
  return (
    <div
      className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground"
      data-testid="aggregate-completeness"
    >
      <p className="font-semibold text-foreground">
        {completenessSentence(axes, tr)}
      </p>
      <details
        open={open}
        onToggle={(event) => onToggle(event.currentTarget.open)}
        className="mt-1"
      >
        <summary className="cursor-pointer underline-offset-4 hover:underline">
          {tr("Подробности за оценката", "Assessment details")}
        </summary>
        <dl className="mt-2 space-y-2">
          {axes.map(({ key, label, completeness }) => (
            <div key={key}>
              <dt className="font-medium text-foreground">{label}</dt>
              <dd className="flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  {tr("оценени", "assessed")} {completeness.assessed}/
                  {completeness.total}
                </span>
                <span>
                  {completeness.outlets} {tr("източника", "outlets")}
                </span>
                <span>
                  {completeness.positioned}{" "}
                  {tr("в спектъра", "on the spectrum")}
                </span>
                <span>
                  {completeness.notApplicable}{" "}
                  {tr("извън обхвата", "not applicable")}
                </span>
                <span>
                  {completeness.unavailable}{" "}
                  {tr("без стойност", "without a value")}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 leading-relaxed">
          {tr("Рубрика", "Rubric")}: {COMPLETENESS_RUBRIC_ID} ·{" "}
          {tr("обобщено", "aggregated")} {formatDate(generatedAt, language)} ·{" "}
          {tr(
            "редакционният статус е достъпен във всяка отделна статия",
            "editorial status is available on each individual article",
          )}
        </p>
      </details>
    </div>
  );
};
