// A statutory figure shown WITH its provenance: the value, the date it took
// effect, and the Държавен вестник issue that set it.
//
// This is the site's differentiator on this material. minfin and НОИ publish
// the numbers; nobody publishes them with a per-value citation, and the numbers
// on their own are indistinguishable from a figure someone typed in two years
// ago and never revisited — which is exactly what several of them were before
// the 2026 package landed.
//
// Two shapes, one component:
//   • a single value      → "€620.20 · from 01.08.2026 · ДВ бр. 68/2026"
//   • a stepped schedule  → the same, plus the window it replaced, so a reader
//     can see that a mid-year step happened rather than inferring it from a
//     number that matches no month.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { fmtDate } from "./statutoryStep";

const DV_BASE = "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=";

export interface StatutoryValueProps {
  /** Preformatted value, e.g. "€620,20" — formatting is the caller's job. */
  value: string;
  /** ISO date the value took effect. Omit for a whole-year figure. */
  from?: string;
  /** Display label for the citation, e.g. "ДВ бр. 68 от 28.07.2026". */
  dvIssue?: string;
  /** Държавен вестник idMat, for the link. */
  idMat?: string;
  /** The article that sets it, e.g. "чл. 9". */
  article?: string;
  /** When the value is one step of a schedule, the step it replaced. */
  previous?: { value: string; from?: string };
  className?: string;
}

/** `timeZone: "UTC"` is load-bearing, not decoration. Without it Intl renders
 *  the UTC instant in the viewer's own zone, so 2026-07-01 displays as
 *  30.06.2026 anywhere west of Greenwich — and an in-force date that is a day
 *  early is a factual error about a statute, not a cosmetic one. */
export const StatutoryValue: FC<StatutoryValueProps> = ({
  value,
  from,
  dvIssue,
  idMat,
  article,
  previous,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "bg-BG";

  const parts: string[] = [];
  if (from)
    parts.push(t("statutory_in_force_from", { date: fmtDate(from, locale) }));
  if (article) parts.push(article);

  return (
    <span className={className}>
      <span className="tabular-nums font-medium">{value}</span>
      {parts.length > 0 || dvIssue || previous ? (
        <span className="ml-1.5 text-[11px] text-muted-foreground">
          {parts.length > 0 ? <>· {parts.join(" · ")}</> : null}
          {previous ? (
            <>
              {" "}
              ·{" "}
              {t("statutory_previously", {
                value: previous.value,
                ...(previous.from
                  ? { date: fmtDate(previous.from, locale) }
                  : {}),
              })}
            </>
          ) : null}
          {dvIssue ? (
            <>
              {" · "}
              {idMat ? (
                <a
                  href={`${DV_BASE}${idMat}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted hover:text-foreground"
                >
                  {dvIssue}
                </a>
              ) : (
                dvIssue
              )}
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
};
