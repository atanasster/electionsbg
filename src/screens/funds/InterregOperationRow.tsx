// One row in an Interreg "operations reaching this place/programme" list —
// shared by MyAreaInterregTile (a place's own breakdown) and
// FundsInterregProgrammeScreen (a programme's own breakdown), which both read
// the identical InterregListedOperation shape (`interreg_by_place()`,
// migration 138; `interreg_programme()`, migration 194).
//
// The `myarea_interreg_*` i18n keys stay as-is here rather than being renamed
// to something programme-neutral: they were named for the tile this row was
// first built in, but their CONTENT ("no published budget", "(in English)",
// "whole project: €X") is generic to any Interreg operation row, and renaming
// them would touch both locale files and the i18n key-usage gate for no
// behavioural change.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatEur } from "@/lib/currency";
import type { InterregListedOperation } from "@/data/funds/types";

export const InterregOperationRow: FC<{
  operation: InterregListedOperation;
  bg: boolean;
  lang: "bg" | "en";
}> = ({ operation: o, bg, lang }) => {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link
          to={`/funds/interreg/${o.keepId}`}
          className="min-w-0 flex-1 font-medium underline"
        >
          {/* keep.eu publishes titles in English only — 107 of 107 sampled
              projects have no `bg` translation. Rendering the English one
              with a marker is honest; inventing a Bulgarian title would not
              be. */}
          {o.titleBg ?? o.titleEn}
          {bg && !o.titleBg ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              {t("myarea_interreg_in_english")}
            </span>
          ) : null}
        </Link>
        <span className="shrink-0 tabular-nums font-semibold">
          {o.localBudgetEur != null
            ? formatEur(o.localBudgetEur, lang)
            : t("myarea_interreg_no_budget")}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
        <span>{(bg ? o.programmeBg : o.programmeEn) ?? "—"}</span>
        <span>·</span>
        <span>{o.period}</span>
        {o.operationTotalEur != null ? (
          <>
            <span>·</span>
            <span>
              {t("myarea_interreg_whole_project", {
                eur: formatEur(o.operationTotalEur, lang),
              })}
            </span>
          </>
        ) : null}
        {o.countries && o.countries.length > 0 ? (
          <>
            <span>·</span>
            <span>{o.countries.join(", ")}</span>
          </>
        ) : null}
      </div>
    </li>
  );
};
